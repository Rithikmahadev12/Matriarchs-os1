import { createServer } from "node:http";
import { fileURLToPath } from "url";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";

const publicPath  = fileURLToPath(new URL("../public/",   import.meta.url));
const scramjetDir = fileURLToPath(new URL("../node_modules/@mercuryworkshop/scramjet/dist/", import.meta.url));
const bareMuxDir  = fileURLToPath(new URL("../node_modules/@mercuryworkshop/bare-mux/dist/", import.meta.url));
const wispDir     = fileURLToPath(new URL("../node_modules/@mercuryworkshop/wisp-js/dist/",  import.meta.url));

// ── Wisp WebSocket server ─────────────────────────────────────────────────────

let wispServer = null;
try {
  let mod;
  try { mod = await import("@mercuryworkshop/wisp-js/server"); }
  catch { mod = await import("@mercuryworkshop/wisp-js"); }
  const WispServer = mod.WispServer || mod.default?.WispServer;
  if (WispServer) {
    wispServer = new WispServer({ logLevel: 0 });
    console.log("[wisp] WispServer ready");
  } else {
    console.warn("[wisp] WispServer not found in module exports");
  }
} catch (e) {
  console.warn("[wisp] Could not load wisp-js:", e.message);
}

// ── Fastify ───────────────────────────────────────────────────────────────────

const fastify = Fastify({
  serverFactory: (handler) => {
    const server = createServer((req, res) => {
      const url = req.url || "";

      const isProxy = url.startsWith("/proxy/") || url.startsWith("/scramjet/")
                   || url.startsWith("/baremux/") || url.startsWith("/wisp-js/");
      if (!isProxy) {
        res.setHeader("Cross-Origin-Opener-Policy",  "same-origin");
        res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
      }
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

// ── Static files ──────────────────────────────────────────────────────────────

fastify.register(fastifyStatic, {
  root: publicPath,
  decorateReply: true,
  setHeaders: (res) => { res.setHeader("Cross-Origin-Resource-Policy", "cross-origin"); },
});

fastify.register(fastifyStatic, {
  root: scramjetDir,
  prefix: "/scramjet/",
  decorateReply: false,
  setHeaders: (res) => { res.setHeader("Cross-Origin-Resource-Policy", "cross-origin"); },
});

fastify.register(fastifyStatic, {
  root: bareMuxDir,
  prefix: "/baremux/",
  decorateReply: false,
  setHeaders: (res) => { res.setHeader("Cross-Origin-Resource-Policy", "cross-origin"); },
});

fastify.register(fastifyStatic, {
  root: wispDir,
  prefix: "/wisp-js/",
  decorateReply: false,
  setHeaders: (res) => { res.setHeader("Cross-Origin-Resource-Policy", "cross-origin"); },
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const BLOCKED = new Set(["localhost","127.0.0.1","0.0.0.0","::1","169.254.169.254"]);
function isBlocked(h) {
  return BLOCKED.has(h) || h.endsWith(".internal") || h.endsWith(".local");
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const STRIP_RES = new Set([
  "content-encoding", "transfer-encoding",
  "x-frame-options", "content-security-policy",
  "cross-origin-opener-policy", "cross-origin-embedder-policy",
  "cross-origin-resource-policy",
]);

async function upstreamFetch(targetUrl, extraHeaders = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    return await fetch(targetUrl, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "User-Agent": UA,
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": new URL(targetUrl).origin + "/",
        ...extraHeaders,
      },
    });
  } finally {
    clearTimeout(t);
  }
}

function proxyHeaders(reply) {
  reply.header("access-control-allow-origin", "*");
  reply.header("access-control-allow-headers", "*");
  reply.header("cross-origin-resource-policy", "cross-origin");
}

// ── rewrite + proxy logic ─────────────────────────────────────────────────────

function rewriteBody(html, base) {
  html = html.replace(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*\/?>/gi, "");

  html = html.replace(/\bsrc\s*=\s*(["'])((?!data:|blob:|javascript:)[^"']+)\1/gi,
    (m, q, url) => `src=${q}${rewriteUrl(url, base, "fetch")}${q}`);

  html = html.replace(/\bhref\s*=\s*(["'])((?!#|javascript:|mailto:|data:|blob:)[^"']+)\1/gi,
    (m, q, url) => `href=${q}${rewriteUrl(url, base, "page")}${q}`);

  html = html.replace(/\baction\s*=\s*(["'])((?!javascript:)[^"']+)\1/gi,
    (m, q, url) => `action=${q}${rewriteUrl(url, base, "page")}${q}`);

  return html;
}

function rewriteUrl(url, base, mode) {
  try {
    const abs = new URL(url, base).toString();
    return mode === "page"
      ? "/proxy/?url=" + encodeURIComponent(abs)
      : "/proxy/fetch?url=" + encodeURIComponent(abs);
  } catch {
    return url;
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

fastify.get("/proxy/", async (req, reply) => {
  const target = req.query.url;
  if (!target) return reply.code(400).send("Missing url");

  try {
    const upstream = await upstreamFetch(target);
    let html = await upstream.text();
    html = rewriteBody(html, target);

    proxyHeaders(reply);
    reply.type("text/html").send(html);
  } catch (err) {
    reply.code(500).send("Proxy error");
  }
});

fastify.get("/proxy/fetch", async (req, reply) => {
  const target = req.query.url;
  if (!target) return reply.code(400).send("Missing url");

  const upstream = await upstreamFetch(target);
  proxyHeaders(reply);
  reply.send(Buffer.from(await upstream.arrayBuffer()));
});

fastify.get("/api/search", async (req, reply) => {
  const q = req.query.q;
  if (!q) return reply.code(400).send({ error: "Missing q" });

  const res = await fetch(
    `https://search.brave.com/api/suggest?q=${encodeURIComponent(q)}&rich=true`
  );
  const data = await res.json();

  reply.send({ results: data[1] || [] });
});

// ── Start ─────────────────────────────────────────────────────────────────────

const port = parseInt(process.env.PORT || "") || 8080;
fastify.listen({ port, host: "0.0.0.0" });
