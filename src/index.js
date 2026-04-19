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

fastify.register(fastifyStatic, { root: publicPath, decorateReply: true });

// ── Helpers ───────────────────────────────────────────────────────────────────

const BLOCKED = new Set(["localhost","127.0.0.1","0.0.0.0","::1","169.254.169.254"]);
function isBlocked(h) {
  return BLOCKED.has(h) || h.endsWith(".internal") || h.endsWith(".local");
}

const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const MOBILE_UA  = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

function getUA(url) {
  const host = new URL(url).hostname;
  if (host.includes("tiktok") || host.includes("instagram")) return MOBILE_UA;
  return DESKTOP_UA;
}

// Rewrite certain hostile URLs to friendlier alternatives
function rewriteTargetUrl(url) {
  try {
    const u = new URL(url);
    // TikTok → ProxiTok (open source TikTok frontend, proxy-friendly)
    if (u.hostname === "tiktok.com" || u.hostname === "www.tiktok.com") {
      return "https://tok.smahat.cn/";
    }
    // YouTube → Invidious (open source YT frontend, proxy-friendly)
    if (u.hostname === "youtube.com" || u.hostname === "www.youtube.com") {
      u.hostname = "yewtu.be"; // public Invidious instance
      return u.toString();
    }
    if (u.hostname === "youtu.be") {
      const videoId = u.pathname.slice(1);
      return "https://inv.nadeko.net/watch?v=" + videoId;
    }
  } catch {}
  return url;
}

async function doFetch(url, accept, extraHeaders) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "User-Agent": getUA(url),
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Accept": accept || "*/*",
        ...extraHeaders,
      },
    });
  } finally { clearTimeout(t); }
}

// Convert any URL to an absolute URL through our proxy fetch endpoint
function toFetch(url, base) {
  if (!url) return url;
  let u = url.trim();
  if (!u || u.startsWith("data:") || u.startsWith("#") ||
      u.startsWith("javascript:") || u.startsWith("mailto:") ||
      u.startsWith("blob:") || u.startsWith("about:") ||
      u.startsWith("/proxy/")) return u;
  // Handle protocol-relative URLs like //cdn.example.com/file.js
  if (u.startsWith("//")) u = new URL(base).protocol + u;
  try {
    const abs = new URL(u, base).toString();
    return "/proxy/fetch?url=" + encodeURIComponent(abs);
  } catch { return url; }
}

// Convert any URL to go through our page proxy
function toPage(url, base) {
  if (!url) return url;
  let u = url.trim();
  if (!u || u.startsWith("data:") || u.startsWith("#") ||
      u.startsWith("javascript:") || u.startsWith("mailto:") ||
      u.startsWith("blob:") || u.startsWith("about:") ||
      u.startsWith("/proxy/")) return u;
  // Handle protocol-relative URLs
  if (u.startsWith("//")) u = new URL(base).protocol + u;
  try {
    const abs = new URL(u, base).toString();
    return "/proxy/?url=" + encodeURIComponent(abs);
  } catch { return url; }
}

function rewriteCss(css, base) {
  return css.replace(/url\(\s*(['"]?)((?!data:)[^'"\)]+)\1\s*\)/gi, (m, q, u) => {
    try {
      const abs = new URL(u.trim(), base).toString();
      return `url(${q}/proxy/fetch?url=${encodeURIComponent(abs)}${q})`;
    } catch { return m; }
  });
}

function rewriteHtml(html, base) {
  // Remove CSP
  html = html.replace(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*\/?>/gi, "");

  // Rewrite <link> tags — stylesheet hrefs go to fetch proxy, others to page proxy
  html = html.replace(/<link(\s[^>]*)>/gi, (tag, attrs) => {
    const isStylesheet = /rel=["']([^"']*\bstylesheet\b[^"']*)["']/i.test(attrs)
                      || /rel=["']([^"']*\bpreload\b[^"']*)["']/i.test(attrs);
    attrs = attrs.replace(/\shref\s*=\s*(["'])([^"']+)\1/gi, (m, q, url) => {
      if (!url || url.startsWith("data:") || url.startsWith("#") || url.startsWith("javascript:")) return m;
      return ` href=${q}${isStylesheet ? toFetch(url, base) : toPage(url, base)}${q}`;
    });
    return `<link${attrs}>`;
  });

  // src= attributes (scripts, images, iframes, video, audio)
  html = html.replace(/\bsrc\s*=\s*(["'])(.*?)\1/gi, (m, q, url) =>
    `src=${q}${toFetch(url, base)}${q}`);

  // href= on non-link tags (anchors etc)
  html = html.replace(/(<(?!link)[a-z][^>]*?)\shref\s*=\s*(["'])([^"']+)\2/gi, (m, pre, q, url) => {
    if (!url || url.startsWith("data:") || url.startsWith("#") || url.startsWith("javascript:") ||
        url.startsWith("mailto:") || url.startsWith("/proxy/")) return m;
    return `${pre} href=${q}${toPage(url, base)}${q}`;
  });

  // action= on forms
  html = html.replace(/\baction\s*=\s*(["'])(.*?)\1/gi, (m, q, url) =>
    `action=${q}${toPage(url, base)}${q}`);

  // srcset=
  html = html.replace(/\bsrcset\s*=\s*(["'])(.*?)\1/gi, (m, q, srcset) => {
    const rw = srcset.split(",").map(part => {
      const t = part.trim();
      const sp = t.search(/\s/);
      if (sp === -1) return toFetch(t, base);
      return toFetch(t.slice(0, sp), base) + t.slice(sp);
    }).join(", ");
    return `srcset=${q}${rw}${q}`;
  });

  // <style> blocks
  html = html.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/gi,
    (m, open, css, close) => open + rewriteCss(css, base) + close);

  // inline style= attributes
  html = html.replace(/\bstyle\s*=\s*(["'])(.*?)\1/gi,
    (m, q, css) => `style=${q}${rewriteCss(css, base)}${q}`);

  return html;
}

function makeInjection(origin, base) {
  return `<script>
(function(){
  var _base=${JSON.stringify(base)};
  var _origin=${JSON.stringify(origin)};
  var _lo=location.origin;

  // ── fetch hook ──
  var _f=window.fetch;
  window.fetch=function(input,init){
    try{
      var url=typeof input==='string'?input:(input instanceof Request?input.url:String(input));
      if(url&&!url.startsWith('data:')&&!url.startsWith('blob:')){
        var abs=new URL(url,_base).toString();
        if(!abs.startsWith(_lo))return _f('/proxy/fetch?url='+encodeURIComponent(abs),init);
      }
    }catch(e){}
    return _f(input,init);
  };

  // ── XHR hook ──
  var _xo=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(m,url){
    try{
      if(url&&!String(url).startsWith('data:')&&!String(url).startsWith('blob:')){
        var abs=new URL(String(url),_base).toString();
        if(!abs.startsWith(_lo))arguments[1]='/proxy/fetch?url='+encodeURIComponent(abs);
      }
    }catch(e){}
    return _xo.apply(this,arguments);
  };

  // ── Form submit interceptor — fixes GET forms losing ?url= param ──
  function handleFormSubmit(form){
    if(!form)return false;
    var method=(form.method||'get').toLowerCase();
    if(method==='post')return false;
    var action=form.getAttribute('action')||'';
    var abs;
    try{
      if(action.startsWith('/proxy/')){
        var match=action.match(/[?&]url=([^&]+)/);
        abs=match?decodeURIComponent(match[1]):_base;
      }else{
        abs=new URL(action||'',_base).toString();
      }
    }catch(err){abs=_base;}
    var params=new URLSearchParams(new FormData(form));
    var qs=params.toString();
    var dest=abs+(abs.includes('?')?'&':'?')+qs;
    top.location.href='/proxy/?url='+encodeURIComponent(dest);
    return true;
  }
  document.addEventListener('submit',function(e){
    if(handleFormSubmit(e.target))e.preventDefault();
  },true);
  // Also catch Enter key in input fields
  document.addEventListener('keydown',function(e){
    if(e.key!=='Enter')return;
    var el=e.target;
    if(el.tagName==='INPUT'||el.tagName==='TEXTAREA'){
      var form=el.closest('form');
      if(form&&handleFormSubmit(form)){e.preventDefault();e.stopPropagation();}
    }
  },true);

  // ── Click interceptor ──
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
      if(u.origin===_lo)return;
      e.preventDefault();e.stopPropagation();
      top.location.href='/proxy/?url='+encodeURIComponent(u.toString());
    }catch(err){}
  },true);

  // ── window.open hook ──
  var _wo=window.open;
  window.open=function(url,t,f){
    if(url&&!url.startsWith('#')&&!url.startsWith('javascript:')){
      try{var u=new URL(url,_base);if(u.origin!==_lo)url='/proxy/?url='+encodeURIComponent(u.toString());}catch(e){}
    }
    return _wo?_wo.call(this,url,t,f):null;
  };

  // ── history hook → tell parent our current URL ──
  var _pp=history.pushState;
  history.pushState=function(s,t,url){
    _pp.apply(this,arguments);
    try{top.postMessage({type:'mos-nav',url:new URL(url||'',_base).toString()},'*');}catch(e){}
  };
  var _rp=history.replaceState;
  history.replaceState=function(s,t,url){
    _rp.apply(this,arguments);
    try{top.postMessage({type:'mos-nav',url:new URL(url||'',_base).toString()},'*');}catch(e){}
  };
})();
</script>`;
}

function errorPage(msg, url) {
  return `<!DOCTYPE html><html><head><title>Proxy Error</title>
<style>body{font-family:monospace;background:#0a0a0a;color:#ff6b6b;padding:40px;margin:0}
h2{margin-bottom:8px}p{color:#aaa;margin:4px 0}.url{color:#555;font-size:11px;margin-top:16px}</style>
</head><body><h2>Proxy Error</h2><p>${msg}</p><p class="url">${url}</p></body></html>`;
}

// ── PROXY — HTML PAGE LOADER ─────────────────────────────────────────────────

fastify.get("/proxy/", async (req, reply) => {
  const target = req.query.url;
  if (!target) return reply.code(400).send("Missing ?url=");

  let targetUrl;
  try { targetUrl = new URL(target); }
  catch { return reply.code(400).send("Invalid URL"); }
  if (isBlocked(targetUrl.hostname)) return reply.code(403).send("Blocked");

  // Rewrite hostile URLs to friendlier alternatives
  const rewrittenUrl = rewriteTargetUrl(targetUrl.toString());

  try {
    const res = await doFetch(rewrittenUrl,
      "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      { "Referer": targetUrl.origin + "/", "Origin": targetUrl.origin,
        "Sec-Fetch-Mode": "navigate", "Upgrade-Insecure-Requests": "1" });

    const ct = res.headers.get("content-type") || "";
    // Use original target URL as base (not the rewritten one) so links resolve correctly
    const finalUrl = targetUrl.toString();

    // Not HTML? Redirect to fetch proxy so browser gets raw resource
    if (ct && !ct.includes("text/html") && !ct.includes("xhtml") && ct !== "") {
      return reply.redirect("/proxy/fetch?url=" + encodeURIComponent(targetUrl.toString()));
    }

    let html = await res.text();
    html = rewriteHtml(html, finalUrl);

    // Inject runtime hooks
    const injection = makeInjection(new URL(finalUrl).origin, finalUrl);
    if (/<head[\s>]/i.test(html)) {
      html = html.replace(/<head(\s[^>]*)?>/i, (m) => m + injection);
    } else if (/<html[\s>]/i.test(html)) {
      html = html.replace(/<html(\s[^>]*)?>/i, (m) => m + injection);
    } else {
      html = injection + html;
    }

    reply.removeHeader("x-frame-options");
    reply.removeHeader("content-security-policy");
    reply.removeHeader("content-encoding");
    reply.removeHeader("transfer-encoding");
    reply.header("content-type", "text/html; charset=utf-8");
    return reply.send(html);

  } catch (err) {
    console.error("Page proxy error:", err.message);
    return reply.code(502).type("text/html").send(errorPage(err.message, target));
  }
});

// ── PROXY — RESOURCE FETCHER ─────────────────────────────────────────────────

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
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        "Accept": accept,
        "Referer": targetUrl.origin + "/",
        "Origin": targetUrl.origin,
      },
    });

    const ct = res.headers.get("content-type") || "application/octet-stream";
    const url = targetUrl.toString();

    reply.removeHeader("x-frame-options");
    reply.removeHeader("content-security-policy");
    reply.removeHeader("content-encoding");
    reply.removeHeader("transfer-encoding");
    reply.header("content-type", ct);
    reply.header("access-control-allow-origin", "*");
    reply.header("access-control-allow-headers", "*");
    reply.header("cross-origin-resource-policy", "cross-origin");

    // CSS — rewrite url() references
    if (ct.includes("text/css") || url.match(/\.css(\?|$)/i)) {
      const css = await res.text();
      return reply.send(rewriteCss(css, url));
    }

    // Sub-HTML pages
    if (ct.includes("text/html")) {
      let html = await res.text();
      html = rewriteHtml(html, url);
      return reply.send(html);
    }

    // Everything else (JS, images, fonts, etc.) — raw passthrough
    const buf = await res.arrayBuffer();
    return reply.send(Buffer.from(buf));

  } catch (err) {
    console.error("Resource proxy error:", err.message);
    return reply.code(502).send("Proxy error: " + err.message);
  }
});

// ── TIKTOK API ROUTE ─────────────────────────────────────────────────────────
// GET /tiktok/feed?token=YOUR_TOKEN — fetches trending videos via TikTok API
// GET /tiktok/search?token=YOUR_TOKEN&q=query

fastify.get("/tiktok/feed", async (req, reply) => {
  const token = req.query.token || process.env.TIKTOK_TOKEN;
  if (!token) return reply.code(400).send({ error: "Missing token" });

  try {
    const res = await fetch("https://open.tiktokapis.com/v2/video/list/", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        max_count: 20,
        fields: "id,title,cover_image_url,video_description,duration,like_count,view_count,share_count,embed_link,embed_html"
      }),
    });
    const data = await res.json();
    reply.header("access-control-allow-origin", "*");
    return reply.send(data);
  } catch (err) {
    return reply.code(502).send({ error: err.message });
  }
});

fastify.get("/tiktok/search", async (req, reply) => {
  const token = req.query.token || process.env.TIKTOK_TOKEN;
  const q = req.query.q || "";
  if (!token) return reply.code(400).send({ error: "Missing token" });

  try {
    const res = await fetch("https://open.tiktokapis.com/v2/research/video/query/", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: { and: [{ operation: "IN", field_name: "keyword", field_values: [q] }] },
        max_count: 20,
        fields: "id,username,video_description,create_time,like_count,view_count,share_count,embed_link"
      }),
    });
    const data = await res.json();
    reply.header("access-control-allow-origin", "*");
    return reply.send(data);
  } catch (err) {
    return reply.code(502).send({ error: err.message });
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

// ══════════════════════════════════════════════════════════════════════════════
//  TIKTOK API INTEGRATION
//  Uses Client Credentials flow — token cached in memory
// ══════════════════════════════════════════════════════════════════════════════

let ttToken = null;
let ttTokenExpiry = 0;

async function getTikTokToken() {
  if (ttToken && Date.now() < ttTokenExpiry) return ttToken;

  const key    = process.env.TIKTOK_CLIENT_KEY;
  const secret = process.env.TIKTOK_CLIENT_SECRET;
  if (!key || !secret) throw new Error("TikTok credentials not configured");

  const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: key,
      client_secret: secret,
      grant_type: "client_credentials",
    }),
  });

  const data = await res.json();
  if (!data.access_token) throw new Error("Token error: " + JSON.stringify(data));

  ttToken = data.access_token;
  ttTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return ttToken;
}

// GET /api/tiktok/search?q=query — search TikTok videos
fastify.get("/api/tiktok/search", async (req, reply) => {
  reply.header("access-control-allow-origin", "*");
  const q = (req.query.q || "").trim();
  if (!q) return reply.send({ videos: [] });

  try {
    const token = await getTikTokToken();
    const res = await fetch(
      "https://open.tiktokapis.com/v2/research/video/query/?fields=id,video_description,create_time,like_count,view_count,share_count,comment_count,music_id,hashtag_names,username,embed_link,cover_image_url",
      {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: {
            and: [{ operation: "IN", field_name: "keyword", field_values: [q] }],
          },
          max_count: 20,
          start_date: "20240101",
          end_date: new Date().toISOString().slice(0,10).replace(/-/g,""),
        }),
      }
    );
    const data = await res.json();
    return reply.send(data);
  } catch (err) {
    return reply.code(502).send({ error: err.message });
  }
});

// GET /api/tiktok/trending — trending videos
fastify.get("/api/tiktok/trending", async (req, reply) => {
  reply.header("access-control-allow-origin", "*");
  try {
    const token = await getTikTokToken();
    const res = await fetch(
      "https://open.tiktokapis.com/v2/research/video/query/?fields=id,video_description,create_time,like_count,view_count,share_count,comment_count,username,embed_link,cover_image_url",
      {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: {
            and: [{ operation: "GT", field_name: "like_count", field_values: ["100000"] }],
          },
          max_count: 20,
          start_date: "20240101",
          end_date: new Date().toISOString().slice(0,10).replace(/-/g,""),
        }),
      }
    );
    const data = await res.json();
    return reply.send(data);
  } catch (err) {
    return reply.code(502).send({ error: err.message });
  }
});

// GET /api/tiktok/embed?id=VIDEO_ID — get embed HTML for a video
fastify.get("/api/tiktok/embed", async (req, reply) => {
  reply.header("access-control-allow-origin", "*");
  const id = req.query.id;
  if (!id) return reply.code(400).send({ error: "Missing id" });
  try {
    const res = await fetch(
      `https://www.tiktok.com/oembed?url=https://www.tiktok.com/video/${id}`
    );
    const data = await res.json();
    return reply.send(data);
  } catch (err) {
    return reply.code(502).send({ error: err.message });
  }
});
