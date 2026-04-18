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

fastify.register(fastifyStatic, {
  root: publicPath,
  decorateReply: true,
});

// ══════════════════════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════════════════════

const BLOCKED_HOSTS = new Set(["localhost","127.0.0.1","0.0.0.0","::1","169.254.169.254"]);
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
        "Accept": accept || "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        // Do NOT send Accept-Encoding — we need uncompressed bodies we can rewrite
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Dest": "document",
        "Upgrade-Insecure-Requests": "1",
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

function isHtml(ct) { return ct && (ct.includes("text/html") || ct.includes("application/xhtml")); }
function isCss(ct, url)  { 
  return (ct && ct.includes("text/css")) || 
         (url && /\.css(\?|$)/i.test(url)); 
}

function toProxyPage(url, pageUrl) {
  if (!url) return url;
  const u = url.trim();
  if (!u || u.startsWith("data:") || u.startsWith("#") || u.startsWith("javascript:") ||
      u.startsWith("mailto:") || u.startsWith("blob:") || u.startsWith("about:") ||
      u.startsWith("/proxy/")) return u;
  try {
    const abs = new URL(u, pageUrl).toString();
    return "/proxy/?url=" + encodeURIComponent(abs);
  } catch { return url; }
}

function toProxyFetch(url, pageUrl) {
  if (!url) return url;
  const u = url.trim();
  if (!u || u.startsWith("data:") || u.startsWith("#") || u.startsWith("javascript:") ||
      u.startsWith("mailto:") || u.startsWith("blob:") || u.startsWith("about:") ||
      u.startsWith("/proxy/")) return u;
  try {
    const abs = new URL(u, pageUrl).toString();
    return "/proxy/fetch?url=" + encodeURIComponent(abs);
  } catch { return url; }
}

function rewriteCss(css, pageUrl) {
  return css.replace(/url\(\s*(['"]?)((?!data:)[^'")]+)\1\s*\)/gi, (m, q, u) => {
    try {
      const abs = new URL(u.trim(), pageUrl).toString();
      return `url(${q}/proxy/fetch?url=${encodeURIComponent(abs)}${q})`;
    } catch { return m; }
  });
}

function rewriteHtml(html, pageUrl) {
  // Strip CSP meta tags
  html = html.replace(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*\/?>/gi, "");

  // href → page proxy (navigation)
  html = html.replace(/(\shref)=(["'])([^"']+)\2/gi, (m, attr, q, url) =>
    `${attr}=${q}${toProxyPage(url, pageUrl)}${q}`);

  // src → fetch proxy (resources)
  html = html.replace(/(\ssrc)=(["'])([^"']+)\2/gi, (m, attr, q, url) =>
    `${attr}=${q}${toProxyFetch(url, pageUrl)}${q}`);

  // action → page proxy (forms)
  html = html.replace(/(\saction)=(["'])([^"']+)\2/gi, (m, attr, q, url) =>
    `${attr}=${q}${toProxyPage(url, pageUrl)}${q}`);

  // srcset
  html = html.replace(/(\ssrcset)=(["'])([^"']+)\2/gi, (m, attr, q, srcset) => {
    const rw = srcset.split(",").map(part => {
      const t  = part.trim();
      const si = t.search(/\s/);
      if (si === -1) return toProxyFetch(t, pageUrl);
      return toProxyFetch(t.slice(0, si), pageUrl) + t.slice(si);
    }).join(", ");
    return `${attr}=${q}${rw}${q}`;
  });

  // CSS inside <style> tags
  html = html.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/gi,
    (m, o, css, c) => o + rewriteCss(css, pageUrl) + c);

  // Inline style attributes
  html = html.replace(/(\sstyle)=(["'])([^"']+)\2/gi,
    (m, attr, q, css) => `${attr}=${q}${rewriteCss(css, pageUrl)}${q}`);

  return html;
}

function injectionScript(origin, base) {
  return `<script>
(function(){
  // Register SW — handles CSS/JS/image/XHR interception automatically
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('/sw.js',{scope:'/proxy/'})
      .then(function(reg){
        if(reg.installing){
          reg.installing.addEventListener('statechange',function(e){
            if(e.target.state==='activated') location.reload();
          });
        }
      }).catch(function(){});
  }
  window.__proxyOrigin=${JSON.stringify(origin)};
  window.__proxyBase=${JSON.stringify(base)};

  // Click interceptor — catches JS-driven link navigation
  document.addEventListener('click',function(e){
    var el=e.target;
    while(el&&el.tagName!=='A')el=el.parentElement;
    if(!el||!el.href)return;
    var href=el.href;
    if(!href||href.startsWith('#')||href.startsWith('javascript:')||
       href.startsWith('mailto:')||href.startsWith('blob:')||
       href.indexOf('/proxy/')!==-1)return;
    try{
      var u=new URL(href);
      if(u.origin===window.location.origin)return;
      e.preventDefault();e.stopPropagation();
      window.location.href='/proxy/?url='+encodeURIComponent(u.toString());
    }catch(err){}
  },true);

  // window.open interceptor
  var _wo=window.open;
  window.open=function(url,t,f){
    if(url&&!url.startsWith('/proxy/')&&!url.startsWith('#')&&!url.startsWith('javascript:')){
      try{var u=new URL(url,window.__proxyBase);if(u.origin!==window.location.origin)url='/proxy/?url='+encodeURIComponent(u.toString());}catch(e){}
    }
    return _wo?_wo.call(this,url,t,f):null;
  };

  // fetch/XHR backup interceptors (SW handles most, these catch edge cases)
  var _f=window.fetch;
  window.fetch=function(input,init){
    try{
      var url=typeof input==='string'?input:(input instanceof Request?input.url:String(input));
      var abs=new URL(url,window.__proxyBase).toString();
      if(abs.indexOf(location.origin)!==0)return _f('/proxy/fetch?url='+encodeURIComponent(abs),init);
    }catch(e){}
    return _f(input,init);
  };
  var _xo=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(method,url){
    try{var abs=new URL(String(url),window.__proxyBase).toString();if(abs.indexOf(location.origin)!==0)arguments[1]='/proxy/fetch?url='+encodeURIComponent(abs);}catch(e){}
    return _xo.apply(this,arguments);
  };

  // Notify parent frame of URL changes
  var _pp=history.pushState;
  history.pushState=function(s,t,url){
    _pp.apply(this,arguments);
    try{window.parent.postMessage({type:'mos-nav',url:new URL(url||'',window.__proxyBase).toString()},'*');}catch(e){}
  };
})();
</script>`;}

function errorPage(msg, url) {
  return `<!DOCTYPE html><html><head><title>Proxy Error</title>
<style>body{font-family:monospace;background:#0a0a0a;color:#ff6b6b;padding:40px;margin:0}
p{color:#aaa;margin:4px 0}.url{color:#555;font-size:11px;margin-top:16px}</style>
</head><body><h2>Proxy Error</h2><p>${msg}</p><p class="url">${url}</p></body></html>`;
}

// ══════════════════════════════════════════════════════════════════════════════
//  PROXY — HTML PAGE LOADER   GET /proxy/?url=https://...
// ══════════════════════════════════════════════════════════════════════════════

fastify.get("/proxy/", async (request, reply) => {
  const target = request.query.url;
  if (!target) return reply.code(400).send("Missing ?url=");

  let targetUrl;
  try { targetUrl = new URL(target); }
  catch { return reply.code(400).send("Invalid URL"); }
  if (isBlocked(targetUrl.hostname)) return reply.code(403).send("Blocked");

  try {
    const res = await proxyFetch(
      targetUrl.toString(),
      "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    );

    const ct      = res.headers.get("content-type") || "";
    const finalUrl = res.url || targetUrl.toString();

    // If clearly NOT HTML (JS, CSS, binary) — show error instead of dumping raw
    // But if content-type is empty or unknown, try treating as HTML anyway
    const clearlyNotHtml = ct && !isHtml(ct) && (
      ct.includes("javascript") ||
      ct.includes("text/css") ||
      ct.includes("application/json") ||
      ct.includes("image/") ||
      ct.includes("font/") ||
      ct.includes("audio/") ||
      ct.includes("video/") ||
      ct.includes("application/octet-stream")
    );

    if (clearlyNotHtml) {
      return reply.code(200).type("text/html").send(errorPage(
        `This site returned "${ct}" instead of HTML and may block proxies.`,
        finalUrl
      ));
    }

    let html = await res.text();
    html = rewriteHtml(html, finalUrl);

    // Inject our runtime script right after <head>
    const inject = injectionScript(new URL(finalUrl).origin, finalUrl);
    if (/<head[^>]*>/i.test(html)) {
      html = html.replace(/<head([^>]*)>/i, (m) => m + inject);
    } else {
      html = inject + html;
    }

    reply.removeHeader("x-frame-options");
    reply.removeHeader("content-security-policy");
    reply.removeHeader("content-encoding");
    reply.removeHeader("transfer-encoding");
    reply.header("content-type", "text/html; charset=utf-8");
    return reply.send(html);

  } catch (err) {
    console.error("Proxy page error:", err.message);
    return reply.code(502).type("text/html").send(errorPage(err.message, target));
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  PROXY — RESOURCE FETCHER   GET /proxy/fetch?url=https://...
//  JS files are streamed through WITHOUT modification — touching them breaks them
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
    const res    = await fetch(targetUrl.toString(), {
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": accept,
        "Accept-Language": "en-US,en;q=0.9",
        "Origin": targetUrl.origin,
        "Referer": targetUrl.origin + "/",
      },
    });

    const ct = res.headers.get("content-type") || "application/octet-stream";

    reply.removeHeader("x-frame-options");
    reply.removeHeader("content-security-policy");
    // CRITICAL: Node fetch auto-decompresses, so strip encoding headers
    // or the browser will try to decompress already-decompressed data
    reply.removeHeader("content-encoding");
    reply.removeHeader("transfer-encoding");
    reply.header("content-type", ct);
    reply.header("access-control-allow-origin", "*");
    reply.header("access-control-allow-headers", "*");
    reply.header("cross-origin-resource-policy", "cross-origin");

    // CSS — rewrite url() references
    if (isCss(ct, targetUrl.toString())) {
      const css = await res.text();
      return reply.send(rewriteCss(css, targetUrl.toString()));
    }

    // HTML sub-pages — rewrite links
    if (isHtml(ct)) {
      let html = await res.text();
      html = rewriteHtml(html, targetUrl.toString());
      return reply.send(html);
    }

    // JS and everything else — stream through raw, do NOT touch
    const buf = await res.arrayBuffer();
    return reply.send(Buffer.from(buf));

  } catch (err) {
    console.error("Proxy fetch error:", err.message);
    return reply.code(502).send("Proxy error: " + err.message);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  404
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
  console.log(`\thttp://${addr.family==="IPv6"?`[${addr.address}]`:addr.address}:${addr.port}`);
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
