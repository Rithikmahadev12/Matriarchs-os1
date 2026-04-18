import { createServer } from "node:http";
import { fileURLToPath } from "url";
import { hostname } from "node:os";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";

const publicPath = fileURLToPath(new URL("../public/", import.meta.url));

const fastify = Fastify({
  serverFactory: (handler) => {
    return createServer().on("request", (req, res) => {
      res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
      handler(req, res);
    });
  },
});

// ── Static files ──────────────────────────────────────────────────────────────
fastify.register(fastifyStatic, {
  root: publicPath,
  decorateReply: true,
});

// ══════════════════════════════════════════════════════════════════════════════
//  PROXY — HTML PAGE LOADER
//  GET /proxy/?url=https://...
// ══════════════════════════════════════════════════════════════════════════════

fastify.get("/proxy/", async (request, reply) => {
  const target = request.query.url;
  if (!target) return reply.code(400).send("Missing ?url=");

  let targetUrl;
  try { targetUrl = new URL(target); }
  catch { return reply.code(400).send("Invalid URL"); }
  if (isBlocked(targetUrl.hostname)) return reply.code(403).send("Blocked");

  try {
    const res = await proxyFetch(targetUrl.toString(), "text/html,application/xhtml+xml,*/*");
    const ct  = res.headers.get("content-type") || "text/html";

    if (!ct.includes("text/html")) {
      return reply.redirect("/proxy/fetch?url=" + encodeURIComponent(target));
    }

    let html = await res.text();
    html = rewriteHtml(html, targetUrl.toString());

    // Inject SW registration + runtime fetch hook into every proxied page
    const injection = `<script>
(function(){
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('/sw.js',{scope:'/proxy/'}).catch(function(){});
  }
  window.__proxyOrigin=${JSON.stringify(targetUrl.origin)};
  window.__proxyBase=${JSON.stringify(targetUrl.toString())};
  // Hook fetch so JS-heavy sites route through our proxy
  var _fetch=window.fetch;
  window.fetch=function(input,init){
    var url=typeof input==='string'?input:(input&&input.url)||String(input);
    try{
      var abs=new URL(url,window.__proxyBase).toString();
      if(!abs.startsWith(location.origin)){
        var proxied='/proxy/fetch?url='+encodeURIComponent(abs);
        return _fetch(proxied,init);
      }
    }catch(e){}
    return _fetch(input,init);
  };
  // Hook XMLHttpRequest
  var _open=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(method,url){
    try{
      var abs=new URL(url,window.__proxyBase).toString();
      if(!abs.startsWith(location.origin)){
        url='/proxy/fetch?url='+encodeURIComponent(abs);
      }
    }catch(e){}
    return _open.apply(this,arguments);
  };
})();
</script>`;

    if (/<head[^>]*>/i.test(html)) {
      html = html.replace(/<head([^>]*)>/i, (m) => m + injection);
    } else {
      html = injection + html;
    }

    reply.removeHeader("x-frame-options");
    reply.removeHeader("content-security-policy");
    reply.header("content-type", "text/html; charset=utf-8");
    return reply.send(html);

  } catch (err) {
    console.error("Proxy page error:", err.message);
    return reply.code(502).type("text/html").send(errorPage(err.message, target));
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  PROXY — RESOURCE FETCHER
//  GET /proxy/fetch?url=https://...
// ══════════════════════════════════════════════════════════════════════════════

fastify.get("/proxy/fetch", async (request, reply) => {
  const target = request.query.url;
  if (!target) return reply.code(400).send("Missing ?url=");

  let targetUrl;
  try { targetUrl = new URL(target); }
  catch { return reply.code(400).send("Invalid URL"); }
  if (isBlocked(targetUrl.hostname)) return reply.code(403).send("Blocked");

  try {
    const accept = request.headers["accept"] || "*/*";
    const res    = await proxyFetch(targetUrl.toString(), accept);
    const ct     = res.headers.get("content-type") || "application/octet-stream";

    reply.removeHeader("x-frame-options");
    reply.removeHeader("content-security-policy");
    reply.header("content-type", ct);
    reply.header("access-control-allow-origin", "*");
    reply.header("access-control-allow-headers", "*");

    if (ct.includes("text/css")) {
      const css = await res.text();
      return reply.send(rewriteCss(css, targetUrl.toString()));
    }

    if (ct.includes("text/html")) {
      let html = await res.text();
      html = rewriteHtml(html, targetUrl.toString());
      return reply.send(html);
    }

    // Binary passthrough — images, fonts, wasm, video chunks, etc.
    const buf = await res.arrayBuffer();
    return reply.send(Buffer.from(buf));

  } catch (err) {
    console.error("Proxy fetch error:", err.message);
    return reply.code(502).send("Proxy error: " + err.message);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════════════════════

const BLOCKED_HOSTS = new Set([
  "localhost","127.0.0.1","0.0.0.0","::1","169.254.169.254"
]);
function isBlocked(h) {
  return BLOCKED_HOSTS.has(h) || h.endsWith(".internal") || h.endsWith(".local");
}

async function proxyFetch(url, accept) {
  const ctrl    = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 20000);
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": accept || "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "identity",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

function toProxyFetch(url, pageUrl) {
  if (!url) return url;
  const u = url.trim();
  if (u.startsWith("data:") || u.startsWith("#") || u.startsWith("javascript:") ||
      u.startsWith("mailto:") || u.startsWith("blob:") || u.startsWith("about:") ||
      u.startsWith("/proxy/")) return u;
  try {
    const abs = new URL(u, pageUrl).toString();
    return "/proxy/fetch?url=" + encodeURIComponent(abs);
  } catch { return url; }
}

function toProxyPage(url, pageUrl) {
  if (!url) return url;
  const u = url.trim();
  if (u.startsWith("data:") || u.startsWith("#") || u.startsWith("javascript:") ||
      u.startsWith("mailto:") || u.startsWith("blob:") || u.startsWith("about:") ||
      u.startsWith("/proxy/")) return u;
  try {
    const abs = new URL(u, pageUrl).toString();
    return "/proxy/?url=" + encodeURIComponent(abs);
  } catch { return url; }
}

function rewriteHtml(html, pageUrl) {
  // Strip CSP
  html = html.replace(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*\/?>/gi, "");

  // href → page proxy
  html = html.replace(/\shref=(["'])([^"'#][^"']*)\1/gi, (m, q, url) =>
    ` href=${q}${toProxyPage(url, pageUrl)}${q}`);

  // src → fetch proxy
  html = html.replace(/\ssrc=(["'])([^"'][^"']*)\1/gi, (m, q, url) =>
    ` src=${q}${toProxyFetch(url, pageUrl)}${q}`);

  // action → page proxy
  html = html.replace(/\saction=(["'])([^"'][^"']*)\1/gi, (m, q, url) =>
    ` action=${q}${toProxyPage(url, pageUrl)}${q}`);

  // srcset
  html = html.replace(/\ssrcset=(["'])([^"']+)\1/gi, (m, q, srcset) => {
    const rw = srcset.split(",").map(part => {
      const t = part.trim();
      const si = t.search(/\s/);
      if (si === -1) return toProxyFetch(t, pageUrl);
      return toProxyFetch(t.slice(0, si), pageUrl) + t.slice(si);
    }).join(", ");
    return ` srcset=${q}${rw}${q}`;
  });

  // <style> blocks + inline styles
  html = html.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/gi,
    (m, o, css, c) => o + rewriteCss(css, pageUrl) + c);
  html = html.replace(/\sstyle=(["'])([^"']*)\1/gi,
    (m, q, css) => ` style=${q}${rewriteCss(css, pageUrl)}${q}`);

  return html;
}

function rewriteCss(css, pageUrl) {
  return css.replace(/url\(\s*(['"]?)((?!data:)[^'")]+)\1\s*\)/gi, (m, q, u) => {
    try {
      const abs = new URL(u.trim(), pageUrl).toString();
      return `url(${q}/proxy/fetch?url=${encodeURIComponent(abs)}${q})`;
    } catch { return m; }
  });
}

function errorPage(msg, url) {
  return `<!DOCTYPE html><html><head><title>Proxy Error</title>
<style>body{font-family:monospace;background:#0a0a0a;color:#ff6b6b;padding:40px;margin:0}
h2{margin-bottom:8px}p{color:#aaa;margin:4px 0}.url{color:#555;font-size:11px;margin-top:16px}</style>
</head><body><h2>Proxy Error</h2><p>${msg}</p><p class="url">URL: ${url}</p></body></html>`;
}

// ══════════════════════════════════════════════════════════════════════════════
//  404 HANDLER
// ══════════════════════════════════════════════════════════════════════════════

fastify.setNotFoundHandler((req, reply) => {
  return reply.code(404).type("text/html").sendFile("404.html");
});

// ══════════════════════════════════════════════════════════════════════════════
//  START
// ══════════════════════════════════════════════════════════════════════════════

fastify.server.on("listening", () => {
  const addr = fastify.server.address();
  console.log("Listening on:");
  console.log(`\thttp://localhost:${addr.port}`);
  console.log(`\thttp://${hostname()}:${addr.port}`);
  console.log(`\thttp://${addr.family === "IPv6" ? `[${addr.address}]` : addr.address}:${addr.port}`);
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
function shutdown() {
  console.log("SIGTERM signal received: closing HTTP server");
  fastify.close();
  process.exit(0);
}

let port = parseInt(process.env.PORT || "");
if (isNaN(port)) port = 8080;
fastify.listen({ port, host: "0.0.0.0" });
