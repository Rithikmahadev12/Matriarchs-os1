import { createServer } from "node:http";
import { fileURLToPath } from "url";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";

const publicPath  = fileURLToPath(new URL("../public/",   import.meta.url));
const scramjetDir = fileURLToPath(new URL("../node_modules/@mercuryworkshop/scramjet/dist/", import.meta.url));
const bareMuxDir  = fileURLToPath(new URL("../node_modules/@mercuryworkshop/bare-mux/dist/", import.meta.url));
const wispDir     = fileURLToPath(new URL("../node_modules/@mercuryworkshop/wisp-js/dist/",  import.meta.url));

// ── Wisp WebSocket server ─────────────────────────────────────────────────────

let wispHandler = null;

async function loadWisp() {
  // wisp-js v0.4.x ships a server export — try every known path
  const attempts = [
    () => import("@mercuryworkshop/wisp-js/server"),
    () => import("@mercuryworkshop/wisp-js"),
  ];

  for (const attempt of attempts) {
    try {
      const mod = await attempt();
      console.log("[wisp] module keys:", Object.keys(mod));

      // v0.4.x: routeRequest is a bare function export
      if (typeof mod.routeRequest === "function") {
        wispHandler = mod.routeRequest;
        console.log("[wisp] Using routeRequest function export");
        return;
      }

      // class-based: WispServer
      const WispServer = mod.WispServer ?? mod.default?.WispServer;
      if (WispServer) {
        const srv = new WispServer({ logLevel: 0 });
        wispHandler = srv.routeRequest.bind(srv);
        console.log("[wisp] Using WispServer class");
        return;
      }

      // default export that is itself a handler function
      if (typeof mod.default === "function") {
        wispHandler = mod.default;
        console.log("[wisp] Using default function export");
        return;
      }
    } catch (e) {
      console.warn("[wisp] attempt failed:", e.message);
    }
  }

  console.error("[wisp] Could not load wisp-js — WebSocket proxy will not work");
}

await loadWisp();

// ── Fastify ───────────────────────────────────────────────────────────────────

const fastify = Fastify({
  serverFactory: (handler) => {
    const server = createServer((req, res) => {
      const url = req.url || "";

      // COEP/COOP only on our own app shell, not on proxied content.
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
      if (wispHandler && req.url.startsWith("/wisp/")) {
        try {
          wispHandler(req, socket, head);
        } catch (e) {
          console.error("[wisp] routeRequest threw:", e.message);
          socket.end("HTTP/1.1 500 Internal Server Error\r\n\r\n");
        }
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

// Scramjet v1.x dist files at /scramjet/
fastify.register(fastifyStatic, {
  root: scramjetDir,
  prefix: "/scramjet/",
  decorateReply: false,
  setHeaders: (res) => { res.setHeader("Cross-Origin-Resource-Policy", "cross-origin"); },
});

// BareMux dist files at /baremux/
fastify.register(fastifyStatic, {
  root: bareMuxDir,
  prefix: "/baremux/",
  decorateReply: false,
  setHeaders: (res) => { res.setHeader("Cross-Origin-Resource-Policy", "cross-origin"); },
});

// Wisp-js dist files at /wisp-js/
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

// ── /proxy/ — full HTML page proxy ────────────────────────────────────────────

function rewriteBody(html, base) {
  html = html.replace(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*\/?>/gi, "");

  html = html.replace(/\bsrc\s*=\s*(["'])((?!data:|blob:|javascript:)[^"']+)\1/gi,
    (m, q, url) => `src=${q}${rewriteUrl(url, base, "fetch")}${q}`);

  html = html.replace(/\bhref\s*=\s*(["'])((?!#|javascript:|mailto:|data:|blob:)[^"']+)\1/gi,
    (m, q, url) => `href=${q}${rewriteUrl(url, base, "page")}${q}`);

  html = html.replace(/\baction\s*=\s*(["'])((?!javascript:)[^"']+)\1/gi,
    (m, q, url) => `action=${q}${rewriteUrl(url, base, "page")}${q}`);

  html = html.replace(/\bsrcset\s*=\s*(["'])(.*?)\1/gi, (m, q, srcset) => {
    const rw = srcset.split(",").map(part => {
      const p = part.trim(), sp = p.search(/\s/);
      const u = sp === -1 ? p : p.slice(0, sp);
      const d = sp === -1 ? "" : p.slice(sp);
      return rewriteUrl(u, base, "fetch") + d;
    }).join(", ");
    return `srcset=${q}${rw}${q}`;
  });

  html = html.replace(/url\(\s*(["']?)((?!data:|blob:)[^"')]+)\1\s*\)/gi,
    (m, q, url) => `url(${q}${rewriteUrl(url, base, "fetch")}${q})`);

  const inject = `<script>
(function(){
  var _b=${JSON.stringify(base)},_o=location.origin;
  var _f=window.fetch;
  window.fetch=function(input,init){
    try{
      var url=typeof input==="string"?input:(input instanceof Request?input.url:String(input));
      if(url&&!url.startsWith("data:")&&!url.startsWith("blob:")){
        var abs=new URL(url,_b).toString();
        if(!abs.startsWith(_o))return _f("/proxy/fetch?url="+encodeURIComponent(abs),init);
      }
    }catch(e){}
    return _f(input,init);
  };
  var _xo=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(m,url){
    try{
      if(url&&!String(url).startsWith("data:")&&!String(url).startsWith("blob:")){
        var abs=new URL(String(url),_b).toString();
        if(!abs.startsWith(_o))arguments[1]="/proxy/fetch?url="+encodeURIComponent(abs);
      }
    }catch(e){}
    return _xo.apply(this,arguments);
  };
  var _ps=history.pushState.bind(history);
  history.pushState=function(s,t,u){
    _ps(s,t,u);
    try{top.postMessage({type:"mos-nav",url:new URL(u,_b).toString()},"*");}catch(e){}
  };
  document.addEventListener("click",function(e){
    var el=e.target;
    while(el&&el.tagName!=="A")el=el.parentElement;
    if(!el||!el.href)return;
    var href=el.href;
    if(!href||href.startsWith("#")||href.startsWith("javascript:")||href.startsWith("mailto:")||href.indexOf("/proxy/")!==-1)return;
    try{
      var u=new URL(href);
      if(u.origin===_o)return;
      e.preventDefault();e.stopPropagation();
      top.location.href="/proxy/?url="+encodeURIComponent(u.toString());
    }catch(err){}
  },true);
  document.addEventListener("submit",function(e){
    var form=e.target;
    if(!form||!form.action)return;
    try{
      var u=new URL(form.action,_b);
      if(u.origin===_o)return;
      e.preventDefault();
      var data=new FormData(form);
      var q=new URLSearchParams(data).toString();
      var target=u.toString()+(q?"?"+q:"");
      top.location.href="/proxy/?url="+encodeURIComponent(target);
    }catch(err){}
  },true);
})();
</script>`;

  if (/<head[\s>]/i.test(html)) {
    html = html.replace(/<head(\s[^>]*)?>/i, m => m + inject);
  } else {
    html = inject + html;
  }

  return html;
}

function rewriteUrl(url, base, mode) {
  if (!url) return url;
  const u = url.trim();
  if (!u || u.startsWith("/proxy/") || u.startsWith("data:") || u.startsWith("blob:")) return u;
  try {
    const abs = new URL(u, base).toString();
    return mode === "page"
      ? "/proxy/?url=" + encodeURIComponent(abs)
      : "/proxy/fetch?url=" + encodeURIComponent(abs);
  } catch { return url; }
}

fastify.get("/proxy/", async (req, reply) => {
  const target = req.query.url;
  if (!target) return reply.code(400).type("text/html").send("<h2>Missing ?url=</h2>");

  let targetUrl;
  try { targetUrl = new URL(target).toString(); }
  catch { return reply.code(400).type("text/html").send("<h2>Invalid URL</h2>"); }

  const hostname = new URL(targetUrl).hostname;
  if (isBlocked(hostname)) return reply.code(403).type("text/html").send("<h2>Blocked</h2>");

  const reqHost = (req.headers["host"] || "").split(":")[0];
  if (hostname === reqHost) {
    return reply.code(400).type("text/html").send("<h2>Cannot proxy this origin</h2>");
  }

  try {
    const upstream = await upstreamFetch(targetUrl, {
      "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
      "Upgrade-Insecure-Requests": "1",
    });

    const ct = upstream.headers.get("content-type") || "";

    if (!ct.includes("text/html") && !ct.includes("xhtml")) {
      return reply.redirect("/proxy/fetch?url=" + encodeURIComponent(targetUrl));
    }

    let html = await upstream.text();
    html = rewriteBody(html, targetUrl);

    proxyHeaders(reply);
    reply.header("content-type", "text/html; charset=utf-8");
    return reply.send(html);
  } catch (err) {
    console.error("[proxy/]", err.message);
    return reply.code(502).type("text/html").send(
      `<h2 style="font-family:monospace;padding:40px;color:#ff6b6b">Proxy error: ${err.message}</h2>`
    );
  }
});

fastify.get("/proxy/fetch", async (req, reply) => {
  const target = req.query.url;
  if (!target) return reply.code(400).send("Missing ?url=");

  let targetUrl;
  try { targetUrl = new URL(target).toString(); }
  catch { return reply.code(400).send("Invalid URL"); }

  if (isBlocked(new URL(targetUrl).hostname)) return reply.code(403).send("Blocked");

  const reqHost = (req.headers["host"] || "").split(":")[0];
  if (new URL(targetUrl).hostname === reqHost) {
    return reply.code(400).send("Cannot proxy this origin");
  }

  try {
    const upstream = await upstreamFetch(targetUrl, {
      "Accept": req.headers["accept"] || "*/*",
    });

    for (const [k, v] of upstream.headers.entries()) {
      if (!STRIP_RES.has(k.toLowerCase())) reply.header(k, v);
    }
    proxyHeaders(reply);

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
    const results = (Array.isArray(data) ? data[1] || [] : []).map(s =>
      typeof s === "string"
        ? { title: s, url: `https://search.brave.com/search?q=${encodeURIComponent(s)}`, snippet: "" }
        : { title: s.phrase || s, url: s.url || `https://search.brave.com/search?q=${encodeURIComponent(s.phrase||s)}`, snippet: s.desc || "" }
    );
    return reply.send({ results });
  } catch (err) {
    return reply.code(502).send({ error: err.message });
  }
});

// ── YouTube API ───────────────────────────────────────────────────────────────

const INVIDIOUS_INSTANCES = [
  "https://invidious.io.lol",
  "https://invidious.privacyredirect.com",
  "https://vid.puffyan.us",
];

async function invidiousFetch(path) {
  for (const base of INVIDIOUS_INSTANCES) {
    try {
      const res = await fetch(base + path, {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) return res.json();
    } catch {}
  }
  throw new Error("All Invidious instances failed");
}

fastify.get("/api/youtube/search", async (req, reply) => {
  const q = req.query.q;
  if (!q) return reply.code(400).send({ error: "Missing q" });
  try {
    const data = await invidiousFetch(`/api/v1/search?q=${encodeURIComponent(q)}&type=video`);
    return reply.send({ results: data });
  } catch (err) {
    return reply.code(502).send({ error: err.message });
  }
});

fastify.get("/api/youtube/trending", async (req, reply) => {
  try {
    const data = await invidiousFetch("/api/v1/trending?type=default");
    return reply.send({ results: data });
  } catch (err) {
    return reply.code(502).send({ error: err.message });
  }
});

// ── TikTok API ────────────────────────────────────────────────────────────────

fastify.get("/api/tiktok/search", async (req, reply) => {
  const q = req.query.q;
  if (!q) return reply.code(400).send({ error: "Missing q" });
  try {
    const res = await fetch(
      `https://www.tiktok.com/api/search/general/full/?keyword=${encodeURIComponent(q)}&count=20`,
      { headers: { "User-Agent": UA, "Referer": "https://www.tiktok.com/" } }
    );
    const data = await res.json();
    return reply.send(data);
  } catch (err) {
    return reply.code(502).send({ error: err.message });
  }
});

fastify.get("/api/tiktok/trending", async (req, reply) => {
  try {
    const res = await fetch(
      "https://www.tiktok.com/api/recommend/itemlist/?recommendGeo=US&count=20",
      { headers: { "User-Agent": UA, "Referer": "https://www.tiktok.com/" } }
    );
    const data = await res.json();
    return reply.send(data);
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
  console.log(`✦ Matriarchs OS  http://localhost:${a.port}`);
  console.log(`  Wisp WS:       ws://localhost:${a.port}/wisp/`);
  console.log(`  Wisp active:   ${!!wispHandler}`);
  console.log(`  Scramjet SW:   /scramjet-sw.js`);
  console.log(`  Server proxy:  /proxy/`);
});

process.on("SIGINT",  () => { fastify.close(); process.exit(0); });
process.on("SIGTERM", () => { fastify.close(); process.exit(0); });

const port = parseInt(process.env.PORT || "") || 8080;
fastify.listen({ port, host: "0.0.0.0" });
