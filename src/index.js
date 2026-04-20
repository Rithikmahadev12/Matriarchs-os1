import { createServer } from "node:http";
import { fileURLToPath } from "url";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";

const publicPath = fileURLToPath(new URL("../public/", import.meta.url));

const fastify = Fastify({
  serverFactory: (handler) => {
    return createServer().on("request", (req, res) => {
      if (!req.url?.startsWith("/proxy/")) {
        res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
        res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
      }
      handler(req, res);
    });
  },
});

fastify.register(fastifyStatic, { root: publicPath, decorateReply: true });

// ── Helpers ───────────────────────────────────────────────────────────────────

const BLOCKED = new Set(["localhost","127.0.0.1","0.0.0.0","::1","169.254.169.254"]);
function isBlocked(h) {
  return BLOCKED.has(h) || h.endsWith(".internal") || h.endsWith(".local");
}

const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const MOBILE_UA  = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

function getUA(url) {
  try {
    const host = new URL(url).hostname;
    if (host.includes("tiktok") || host.includes("instagram")) return MOBILE_UA;
  } catch {}
  return DESKTOP_UA;
}

async function doFetch(url, accept, extra = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "User-Agent": getUA(url),
        "Accept": accept || "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        ...extra,
      },
    });
  } finally { clearTimeout(t); }
}

function toFetch(url, base) {
  if (!url) return url;
  const u = url.trim();
  if (!u || u.startsWith("data:") || u.startsWith("#") || u.startsWith("javascript:") ||
      u.startsWith("mailto:") || u.startsWith("blob:") || u.startsWith("about:") ||
      u.startsWith("/proxy/")) return u;
  try {
    const abs = new URL(u.startsWith("//") ? new URL(base).protocol + u : u, base);
    return "/proxy/fetch?url=" + encodeURIComponent(abs.toString());
  } catch { return url; }
}

function toPage(url, base) {
  if (!url) return url;
  const u = url.trim();
  if (!u || u.startsWith("data:") || u.startsWith("#") || u.startsWith("javascript:") ||
      u.startsWith("mailto:") || u.startsWith("blob:") || u.startsWith("about:") ||
      u.startsWith("/proxy/")) return u;
  try {
    const abs = new URL(u.startsWith("//") ? new URL(base).protocol + u : u, base);
    return "/proxy/?url=" + encodeURIComponent(abs.toString());
  } catch { return url; }
}

function rewriteCss(css, base) {
  return css.replace(/url\(\s*(['"]?)((?!data:)[^'"\)]+)\1\s*\)/gi, (m, q, u) => {
    try { return `url(${q}${toFetch(u.trim(), base)}${q})`; }
    catch { return m; }
  });
}

function rewriteHtml(html, base) {
  html = html.replace(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*\/?>/gi, "");

  html = html.replace(/<link(\s[^>]*)>/gi, (tag, attrs) => {
    const isStyle = /rel=["'][^"']*\b(stylesheet|preload)\b[^"']*["']/i.test(attrs);
    attrs = attrs.replace(/\shref\s*=\s*(["'])([^"']+)\1/gi, (m, q, url) => {
      if (!url || url.startsWith("data:") || url.startsWith("#") || url.startsWith("javascript:")) return m;
      return ` href=${q}${isStyle ? toFetch(url, base) : toPage(url, base)}${q}`;
    });
    return `<link${attrs}>`;
  });

  html = html.replace(/\bsrc\s*=\s*(["'])(.*?)\1/gi, (m, q, url) =>
    url ? `src=${q}${toFetch(url, base)}${q}` : m);

  html = html.replace(/(<(?!link\b)[a-z][^>]*?)\shref\s*=\s*(["'])([^"']+)\2/gi, (m, pre, q, url) => {
    if (!url || url.startsWith("data:") || url.startsWith("#") || url.startsWith("javascript:") ||
        url.startsWith("mailto:") || url.startsWith("/proxy/")) return m;
    return `${pre} href=${q}${toPage(url, base)}${q}`;
  });

  html = html.replace(/\baction\s*=\s*(["'])(.*?)\1/gi, (m, q, url) =>
    url ? `action=${q}${toPage(url, base)}${q}` : m);

  html = html.replace(/\bsrcset\s*=\s*(["'])(.*?)\1/gi, (m, q, srcset) => {
    const rw = srcset.split(",").map(part => {
      const t = part.trim(), si = t.search(/\s/);
      return si === -1 ? toFetch(t, base) : toFetch(t.slice(0, si), base) + t.slice(si);
    }).join(", ");
    return `srcset=${q}${rw}${q}`;
  });

  html = html.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/gi,
    (m, o, css, c) => o + rewriteCss(css, base) + c);

  html = html.replace(/\bstyle\s*=\s*(["'])(.*?)\1/gi,
    (m, q, css) => `style=${q}${rewriteCss(css, base)}${q}`);

  return html;
}

function makeInjection(origin, base) {
  return `<base href="${base}">
<script>
(function(){
  var _b=${JSON.stringify(base)};
  var _lo=location.origin;

  // MutationObserver catches dynamic script/link/img elements added by JS
  // With the <base> tag above, relative src="/foo.js" resolves to the real
  // site origin, making it cross-origin — the SW then proxies it automatically.
  // But we also catch and fix them here in case they load before the SW handles it.
  var _obs=new MutationObserver(function(muts){
    for(var i=0;i<muts.length;i++){
      var nodes=muts[i].addedNodes;
      for(var j=0;j<nodes.length;j++){
        var n=nodes[j];
        if(!n||!n.tagName) continue;
        var tag=n.tagName.toLowerCase();
        if(tag==='script'||tag==='img'||tag==='source'||tag==='video'||tag==='audio'){
          var s=n.getAttribute('src');
          if(s&&!s.startsWith('/proxy/')&&!s.startsWith('data:')&&!s.startsWith('blob:')){
            try{
              var abs=new URL(s,_b).toString();
              if(!abs.startsWith(_lo)) n.setAttribute('src','/proxy/fetch?url='+encodeURIComponent(abs));
            }catch(e){}
          }
        }
        if(tag==='link'){
          var h=n.getAttribute('href');
          if(h&&!h.startsWith('/proxy/')&&!h.startsWith('data:')){
            try{
              var abs2=new URL(h,_b).toString();
              if(!abs2.startsWith(_lo)){
                var rel=(n.getAttribute('rel')||'').toLowerCase();
                n.setAttribute('href',(rel==='stylesheet'||rel==='preload')
                  ?'/proxy/fetch?url='+encodeURIComponent(abs2)
                  :'/proxy/?url='+encodeURIComponent(abs2));
              }
            }catch(e){}
          }
        }
      }
    }
  });
  _obs.observe(document.documentElement,{childList:true,subtree:true});

  // Form submit
  document.addEventListener('submit',function(e){
    var f=e.target;
    if(!f||(f.method||'get').toLowerCase()==='post') return;
    e.preventDefault();
    var action=f.getAttribute('action')||'';
    var abs;
    try{
      if(action.startsWith('/proxy/')){var m=action.match(/[?&]url=([^&]+)/);abs=m?decodeURIComponent(m[1]):_b;}
      else{abs=new URL(action||'',_b).toString();}
    }catch(e){abs=_b;}
    var qs=new URLSearchParams(new FormData(f)).toString();
    top.location.href='/proxy/?url='+encodeURIComponent(abs+(abs.includes('?')?'&':'?')+qs);
  },true);

  // Enter key in inputs
  document.addEventListener('keydown',function(e){
    if(e.key!=='Enter') return;
    var el=e.target;
    if(el.tagName==='INPUT'||el.tagName==='TEXTAREA'){
      var f=el.closest('form');
      if(f&&(f.method||'get').toLowerCase()!=='post'){
        e.preventDefault();e.stopPropagation();
        var action=f.getAttribute('action')||'';
        var abs;
        try{
          if(action.startsWith('/proxy/')){var m=action.match(/[?&]url=([^&]+)/);abs=m?decodeURIComponent(m[1]):_b;}
          else{abs=new URL(action||'',_b).toString();}
        }catch(err){abs=_b;}
        var qs=new URLSearchParams(new FormData(f)).toString();
        top.location.href='/proxy/?url='+encodeURIComponent(abs+(abs.includes('?')?'&':'?')+qs);
      }
    }
  },true);

  // Link clicks
  document.addEventListener('click',function(e){
    var el=e.target;
    while(el&&el.tagName!=='A') el=el.parentElement;
    if(!el||!el.href) return;
    var href=el.href;
    if(!href||href.startsWith('#')||href.startsWith('javascript:')||href.startsWith('mailto:')||href.startsWith('blob:')||href.indexOf('/proxy/')!==-1) return;
    try{
      var u=new URL(href);
      if(u.origin===_lo) return;
      e.preventDefault();e.stopPropagation();
      top.location.href='/proxy/?url='+encodeURIComponent(u.toString());
    }catch(err){}
  },true);

  // fetch hook
  var _f=window.fetch;
  window.fetch=function(input,init){
    try{
      var url=typeof input==='string'?input:(input instanceof Request?input.url:String(input));
      if(url&&!url.startsWith('data:')&&!url.startsWith('blob:')){
        var abs=new URL(url,_b).toString();
        if(!abs.startsWith(_lo)) return _f('/proxy/fetch?url='+encodeURIComponent(abs),init);
      }
    }catch(e){}
    return _f(input,init);
  };

  // XHR hook
  var _xo=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(m,url){
    try{
      if(url&&!String(url).startsWith('data:')&&!String(url).startsWith('blob:')){
        var abs=new URL(String(url),_b).toString();
        if(!abs.startsWith(_lo)) arguments[1]='/proxy/fetch?url='+encodeURIComponent(abs);
      }
    }catch(e){}
    return _xo.apply(this,arguments);
  };

  // History hooks
  var _pp=history.pushState,_rp=history.replaceState;
  history.pushState=function(s,t,url){_pp.apply(this,arguments);try{top.postMessage({type:'mos-nav',url:new URL(url||'',_b).toString()},'*');}catch(e){}};
  history.replaceState=function(s,t,url){_rp.apply(this,arguments);try{top.postMessage({type:'mos-nav',url:new URL(url||'',_b).toString()},'*');}catch(e){}};
})();
</script>`;
}

function errorPage(msg, url) {
  return `<!DOCTYPE html><html><head><title>Proxy Error</title>
<style>body{font-family:monospace;background:#07100a;color:#ceefd4;padding:40px;margin:0;
display:flex;flex-direction:column;align-items:center;justify-content:center;height:80vh;gap:12px}
h2{color:#ff6b6b;letter-spacing:0.1em;margin:0}p{color:#4a6650;margin:0;font-size:12px}
.url{color:#2a3d2e;font-size:10px;margin-top:8px;word-break:break-all;max-width:500px;text-align:center}
a{color:#7a9e7e;font-size:11px;margin-top:16px}</style></head><body>
<h2>⬡ Proxy Error</h2><p>${msg.replace(/</g,"&lt;")}</p>
<p class="url">${url.replace(/</g,"&lt;")}</p>
<a href="javascript:history.back()">← Go back</a></body></html>`;
}

function setProxyHeaders(reply) {
  reply.removeHeader("x-frame-options");
  reply.removeHeader("content-security-policy");
  reply.removeHeader("content-encoding");
  reply.removeHeader("transfer-encoding");
  reply.removeHeader("cross-origin-embedder-policy");
  reply.removeHeader("cross-origin-opener-policy");
  reply.header("access-control-allow-origin", "*");
  reply.header("access-control-allow-headers", "*");
  reply.header("cross-origin-resource-policy", "cross-origin");
}

// ── PROXY PAGE ────────────────────────────────────────────────────────────────

fastify.get("/proxy/", async (req, reply) => {
  const target = req.query.url;
  if (!target) return reply.code(400).send("Missing ?url=");

  let targetUrl;
  try { targetUrl = new URL(target); }
  catch { return reply.code(400).type("text/html").send(errorPage("Invalid URL", target)); }

  if (isBlocked(targetUrl.hostname))
    return reply.code(403).type("text/html").send(errorPage("Blocked host", target));

  try {
    const res = await doFetch(targetUrl.toString(),
      "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      { "Referer": targetUrl.origin + "/", "Origin": targetUrl.origin });

    const ct = res.headers.get("content-type") || "";
    const finalUrl = res.url || targetUrl.toString();

    if (ct && !ct.includes("text/html") && !ct.includes("xhtml")) {
      return reply.redirect("/proxy/fetch?url=" + encodeURIComponent(target));
    }

    let html = await res.text();
    if (!html.trim()) {
      return reply.code(502).type("text/html").send(
        errorPage("Empty response — this site may block proxies", finalUrl));
    }

    html = rewriteHtml(html, finalUrl);
    const inject = makeInjection(targetUrl.origin, finalUrl);
    if (/<head[\s>]/i.test(html)) {
      html = html.replace(/<head(\s[^>]*)?>/i, m => m + inject);
    } else {
      html = inject + html;
    }

    setProxyHeaders(reply);
    reply.header("content-type", "text/html; charset=utf-8");
    return reply.send(html);
  } catch (err) {
    console.error("Page proxy error:", err.message);
    return reply.code(502).type("text/html").send(errorPage(err.message, target));
  }
});

// ── PROXY FETCH ───────────────────────────────────────────────────────────────

fastify.get("/proxy/fetch", async (req, reply) => {
  const target = req.query.url;
  if (!target) return reply.code(400).send("Missing ?url=");

  let targetUrl;
  try { targetUrl = new URL(target); }
  catch { return reply.code(400).send("Invalid URL"); }

  if (isBlocked(targetUrl.hostname)) return reply.code(403).send("Blocked");

  try {
    const accept = req.headers["accept"] || "*/*";
    const res = await fetch(targetUrl.toString(), {
      redirect: "follow",
      headers: {
        "User-Agent": getUA(targetUrl.toString()),
        "Accept": accept,
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": targetUrl.origin + "/",
        "Origin": targetUrl.origin,
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "cross-site",
        "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
      },
    });

    const ct  = res.headers.get("content-type") || "application/octet-stream";
    const url = res.url || targetUrl.toString();

    setProxyHeaders(reply);
    reply.header("content-type", ct);

    if (ct.includes("text/css") || url.match(/\.css(\?|$)/i)) {
      return reply.send(rewriteCss(await res.text(), url));
    }
    if (ct.includes("text/html")) {
      return reply.send(rewriteHtml(await res.text(), url));
    }
    return reply.send(Buffer.from(await res.arrayBuffer()));
  } catch (err) {
    console.error("Fetch proxy error:", err.message);
    return reply.code(502).send("Proxy error: " + err.message);
  }
});

// ── 404 ───────────────────────────────────────────────────────────────────────

fastify.setNotFoundHandler((req, reply) => {
  return reply.code(404).type("text/html").sendFile("404.html");
});

// ── START ─────────────────────────────────────────────────────────────────────

fastify.server.on("listening", () => {
  const a = fastify.server.address();
  console.log(`Listening on http://localhost:${a.port}`);
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
function shutdown() { fastify.close(); process.exit(0); }

let port = parseInt(process.env.PORT || "");
if (isNaN(port)) port = 8080;
fastify.listen({ port, host: "0.0.0.0" });
