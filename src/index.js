import { createServer } from "node:http";
import { fileURLToPath } from "url";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";

const publicPath  = fileURLToPath(new URL("../public/",   import.meta.url));
const scramjetDir = fileURLToPath(new URL("../node_modules/@mercuryworkshop/scramjet/dist/", import.meta.url));
const bareMuxDir  = fileURLToPath(new URL("../node_modules/@mercuryworkshop/bare-mux/dist/", import.meta.url));
const wispDir     = fileURLToPath(new URL("../node_modules/@mercuryworkshop/wisp-js/dist/",  import.meta.url));

// ── Wisp WebSocket server ─────────────────────────────────────────────────────
// Wisp tunnels the actual TCP traffic for Scramjet.

let wispServer = null;
try {
  // wisp-js exports a server helper — try a few known paths
  let mod;
  try { mod = await import("@mercuryworkshop/wisp-js/server"); }
  catch { mod = await import("@mercuryworkshop/wisp-js"); }
  const WispServer = mod.WispServer || mod.default?.WispServer;
  if (WispServer) {
    wispServer = new WispServer({ logLevel: 0 });
    console.log("[wisp] WispServer ready");
  } else {
    console.warn("[wisp] WispServer constructor not found in module");
  }
} catch (e) {
  console.warn("[wisp] Could not load wisp-js server:", e.message);
}

// ── Fastify ───────────────────────────────────────────────────────────────────

const fastify = Fastify({
  serverFactory: (handler) => {
    const server = createServer((req, res) => {
      const url = req.url || "";

      // COEP/COOP only on our own pages — NOT on proxy responses.
      // Sending require-corp on proxied assets causes ERR_BLOCKED_BY_RESPONSE
      // for third-party resources that don't send CORP headers themselves.
      const isOurPage = !url.startsWith("/proxy/") && !url.startsWith("/scramjet/");
      if (isOurPage) {
        res.setHeader("Cross-Origin-Opener-Policy",  "same-origin");
        res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
      }
      // Everything needs CORP so it can be loaded cross-origin inside iframes
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      handler(req, res);
    });

    server.on("upgrade", (req, socket, head) => {
      if (wispServer && req.url.startsWith("/wisp/")) {
        wispServer.routeRequest(req, socket, head);
      } else {
        socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
      }
    });

    return server;
  },
});

// ── Static: public files ──────────────────────────────────────────────────────
fastify.register(fastifyStatic, {
  root: publicPath,
  decorateReply: true,
  setHeaders: (res) => {
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  },
});

// ── Static: Scramjet dist ─────────────────────────────────────────────────────
fastify.register(fastifyStatic, {
  root: scramjetDir,
  prefix: "/scramjet/",
  decorateReply: false,
  setHeaders: (res) => {
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  },
});

// ── Static: bare-mux dist ─────────────────────────────────────────────────────
fastify.register(fastifyStatic, {
  root: bareMuxDir,
  prefix: "/baremux/",
  decorateReply: false,
  setHeaders: (res) => {
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  },
});

// ── Static: wisp-js dist ──────────────────────────────────────────────────────
fastify.register(fastifyStatic, {
  root: wispDir,
  prefix: "/wisp-js/",
  decorateReply: false,
  setHeaders: (res) => {
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  },
});

// ── /scramjet.config.js — runtime config for the SW ──────────────────────────
fastify.get("/scramjet.config.js", async (req, reply) => {
  reply.header("content-type", "application/javascript");
  reply.header("cross-origin-resource-policy", "cross-origin");
  return reply.send(`
self.__scramjet$config = {
  prefix:     "/scramjet/",
  codec:      "/scramjet/scramjet.codecs.js",
  wasm:       "/scramjet/scramjet.wasm.js",
  shared:     "/scramjet/scramjet.shared.js",
  worker:     "/scramjet/scramjet.worker.js",
  // Wisp server running on the same origin
  bare:       { type: "wisp", url: (location.protocol === "https:" ? "wss" : "ws") + "://" + location.host + "/wisp/" },
};
  `.trim());
});

// ── Shared helpers ────────────────────────────────────────────────────────────

const BLOCKED = new Set(["localhost","127.0.0.1","0.0.0.0","::1","169.254.169.254"]);
function isBlocked(h) {
  return BLOCKED.has(h) || h.endsWith(".internal") || h.endsWith(".local");
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Headers we must strip from upstream responses to avoid breaking the proxy
const STRIP_RES = new Set([
  "content-encoding",        // we decode the body ourselves
  "transfer-encoding",
  "x-frame-options",         // allow embedding
  "content-security-policy", // allow inline scripts / mixed content
  "cross-origin-opener-policy",
  "cross-origin-embedder-policy",
  "cross-origin-resource-policy",
]);

async function upstreamFetch(targetUrl, acceptHeader) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    return await fetch(targetUrl, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "User-Agent": UA,
        "Accept": acceptHeader || "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": new URL(targetUrl).origin + "/",
      },
    });
  } finally {
    clearTimeout(t);
  }
}

// ── /proxy/fetch — asset pass-through ────────────────────────────────────────
// Used as a fallback when Scramjet SW isn't active yet, and by the legacy
// browser code path.

fastify.get("/proxy/fetch", async (req, reply) => {
  const target = req.query.url;
  if (!target) return reply.code(400).send("Missing ?url=");
  let targetUrl;
  try { targetUrl = new URL(target).toString(); }
  catch { return reply.code(400).send("Invalid URL"); }
  if (isBlocked(new URL(targetUrl).hostname)) return reply.code(403).send("Blocked");

  try {
    const upstream = await upstreamFetch(targetUrl, req.headers["accept"]);

    for (const [k, v] of upstream.headers.entries()) {
      if (!STRIP_RES.has(k.toLowerCase())) reply.header(k, v);
    }
    // Inject the headers that let the response load inside our COEP context
    reply.header("access-control-allow-origin",  "*");
    reply.header("access-control-allow-headers", "*");
    reply.header("cross-origin-resource-policy", "cross-origin");

    return reply.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    console.error("[proxy/fetch]", err.message);
    return reply.code(502).send("Proxy error: " + err.message);
  }
});

// ── /api/search ───────────────────────────────────────────────────────────────
fastify.get("/api/search", async (req, reply) => {
  const q = req.query.q;
  if (!q) return reply.code(400).send({ error: "Missing q" });
  try {
    const res = await fetch(
      `https://search.brave.com/api/suggest?q=${encodeURIComponent(q)}&rich=true`,
      { headers: { "User-Agent": UA, "Accept": "application/json" } }
    );
    const data = await res.json();
    // Brave's suggest returns [query, [suggestions], ...] or rich objects
    const results = (Array.isArray(data) ? data[1] || [] : []).map((s) =>
      typeof s === "string"
        ? { title: s, url: `https://search.brave.com/search?q=${encodeURIComponent(s)}`, snippet: "" }
        : { title: s.phrase || s, url: s.url || `https://search.brave.com/search?q=${encodeURIComponent(s.phrase||s)}`, snippet: s.desc || "" }
    );
    return reply.send({ results });
  } catch (err) {
    return reply.code(502).send({ error: err.message });
  }
});

// ── 404 ───────────────────────────────────────────────────────────────────────
fastify.setNotFoundHandler((req, reply) => {
  return reply.code(404).type("text/html").sendFile("404.html");
});

// ── Start ─────────────────────────────────────────────────────────────────────
fastify.server.on("listening", () => {
  const a = fastify.server.address();
  console.log(`✦ Matriarchs OS listening on http://localhost:${a.port}`);
  console.log(`  Scramjet: /scramjet/`);
  console.log(`  Wisp:     ws://localhost:${a.port}/wisp/`);
});

process.on("SIGINT",  () => { fastify.close(); process.exit(0); });
process.on("SIGTERM", () => { fastify.close(); process.exit(0); });

const port = parseInt(process.env.PORT || "") || 8080;
fastify.listen({ port, host: "0.0.0.0" });
