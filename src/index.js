import { createServer } from "node:http";
import { fileURLToPath } from "url";
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
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        "Accept": accept || "*/*",
        ...extra,
      },
    });
  } finally { clearTimeout(t); }
}

// Try a list of async fetchers, return first success
async function tryAll(fetchers) {
  for (const fn of fetchers) {
    try {
      const result = await fn();
      if (result !== null && result !== undefined) return result;
    } catch(e) { /* try next */ }
  }
  return null;
}

function toFetch(url, base) {
  if (!url) return url;
  let u = url.trim();
  if (!u || u.startsWith("data:") || u.startsWith("#") || u.startsWith("javascript:") ||
      u.startsWith("mailto:") || u.startsWith("blob:") || u.startsWith("about:") ||
      u.startsWith("/proxy/")) return u;
  if (u.startsWith("//")) { try { u = new URL(base).protocol + u; } catch {} }
  try { return "/proxy/fetch?url=" + encodeURIComponent(new URL(u, base).toString()); }
  catch { return url; }
}

function toPage(url, base) {
  if (!url) return url;
  let u = url.trim();
  if (!u || u.startsWith("data:") || u.startsWith("#") || u.startsWith("javascript:") ||
      u.startsWith("mailto:") || u.startsWith("blob:") || u.startsWith("about:") ||
      u.startsWith("/proxy/")) return u;
  if (u.startsWith("//")) { try { u = new URL(base).protocol + u; } catch {} }
  try { return "/proxy/?url=" + encodeURIComponent(new URL(u, base).toString()); }
  catch { return url; }
}

function rewriteCss(css, base) {
  return css.replace(/url\(\s*(['"]?)((?!data:)[^'"\)]+)\1\s*\)/gi, (m, q, u) => {
    try { return `url(${q}/proxy/fetch?url=${encodeURIComponent(new URL(u.trim(), base).toString())}${q})`; }
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
  return `<script>
(function(){
  var _b=${JSON.stringify(base)},_lo=location.origin;
  document.addEventListener('submit',function(e){
    var f=e.target;
    if(!f||(f.method||'get').toLowerCase()==='post')return;
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
  document.addEventListener('keydown',function(e){
    if(e.key!=='Enter')return;
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
  document.addEventListener('click',function(e){
    var el=e.target;
    while(el&&el.tagName!=='A')el=el.parentElement;
    if(!el||!el.href)return;
    var href=el.href;
    if(!href||href.startsWith('#')||href.startsWith('javascript:')||href.startsWith('mailto:')||href.startsWith('blob:')||href.indexOf('/proxy/')!==-1)return;
    try{var u=new URL(href);if(u.origin===_lo)return;e.preventDefault();e.stopPropagation();top.location.href='/proxy/?url='+encodeURIComponent(u.toString());}catch(err){}
  },true);
  var _f=window.fetch;
  window.fetch=function(input,init){
    try{
      var url=typeof input==='string'?input:(input instanceof Request?input.url:String(input));
      if(url&&!url.startsWith('data:')&&!url.startsWith('blob:')){
        var abs=new URL(url,_b).toString();
        if(!abs.startsWith(_lo))return _f('/proxy/fetch?url='+encodeURIComponent(abs),init);
      }
    }catch(e){}
    return _f(input,init);
  };
  var _xo=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(m,url){
    try{
      if(url&&!String(url).startsWith('data:')&&!String(url).startsWith('blob:')){
        var abs=new URL(String(url),_b).toString();
        if(!abs.startsWith(_lo))arguments[1]='/proxy/fetch?url='+encodeURIComponent(abs);
      }
    }catch(e){}
    return _xo.apply(this,arguments);
  };
  var _pp=history.pushState,_rp=history.replaceState;
  history.pushState=function(s,t,url){_pp.apply(this,arguments);try{top.postMessage({type:'mos-nav',url:new URL(url||'',_b).toString()},'*');}catch(e){}};
  history.replaceState=function(s,t,url){_rp.apply(this,arguments);try{top.postMessage({type:'mos-nav',url:new URL(url||'',_b).toString()},'*');}catch(e){}};
})();
</script>`;
}

// Shown when a site blocks iframes / proxy
function blockedPage(url) {
  const hostname = (() => { try { return new URL(url).hostname; } catch { return url; } })();
  return `<!DOCTYPE html><html><head><title>Site Blocked Proxy</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:monospace;background:#0a0e0a;color:#ccc;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:32px}
  .card{background:#0f180f;border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:36px 40px;max-width:480px;width:100%;text-align:center}
  .icon{font-size:36px;margin-bottom:16px}
  h2{color:#e8e8e8;font-size:16px;margin-bottom:8px;letter-spacing:0.05em}
  p{color:#777;font-size:12px;line-height:1.7;margin-bottom:20px}
  .host{color:#a0c4a0;font-size:13px;margin-bottom:20px;padding:8px 14px;background:rgba(255,255,255,0.04);border-radius:5px;display:inline-block}
  .actions{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}
  a{display:inline-block;padding:8px 18px;border-radius:5px;font-family:monospace;font-size:11px;text-decoration:none;cursor:pointer}
  .open{background:#1a3a1a;color:#8fc98f;border:1px solid rgba(143,201,143,0.3)}
  .open:hover{background:#1f441f}
  .back{background:rgba(255,255,255,0.06);color:#aaa;border:1px solid rgba(255,255,255,0.1)}
  .back:hover{background:rgba(255,255,255,0.1)}
</style>
</head><body>
<div class="card">
  <div class="icon">🚫</div>
  <h2>SITE REFUSES PROXY</h2>
  <div class="host">${hostname}</div>
  <p>This site sends headers that block it from loading inside a proxy frame. This is a restriction set by the site itself and cannot be bypassed.</p>
  <div class="actions">
    <a class="open" href="${url}" target="_blank" rel="noopener">Open Directly ↗</a>
    <a class="back" onclick="history.back()">← Go Back</a>
  </div>
</div>
</body></html>`;
}

function errorPage(msg, url) {
  return `<!DOCTYPE html><html><head><title>Proxy Error</title>
<style>body{font-family:monospace;background:#0a0a0a;color:#ff6b6b;padding:40px;margin:0}
p{color:#aaa;margin:4px 0}.url{color:#555;font-size:11px;margin-top:16px}</style>
</head><body><h2>Proxy Error</h2><p>${msg}</p><p class="url">${url}</p></body></html>`;
}

// Sites known to block iframe/proxy — show blocked page immediately
const IFRAME_BLOCKED_HOSTS = new Set([
  "search.brave.com", "brave.com",
  "www.bing.com", "bing.com",
  "www.google.com", "google.com",
  "duckduckgo.com", "www.duckduckgo.com",
  "accounts.google.com",
  "www.facebook.com", "facebook.com",
  "twitter.com", "x.com",
  "www.linkedin.com", "linkedin.com",
]);

// ── PROXY PAGE ────────────────────────────────────────────────────────────────

fastify.get("/proxy/", async (req, reply) => {
  const target = req.query.url;
  if (!target) return reply.code(400).send("Missing ?url=");
  let targetUrl;
  try { targetUrl = new URL(target); } catch { return reply.code(400).send("Invalid URL"); }
  if (isBlocked(targetUrl.hostname)) return reply.code(403).send("Blocked");

  // Show blocked page immediately for known iframe-blocking sites
  if (IFRAME_BLOCKED_HOSTS.has(targetUrl.hostname)) {
    reply.header("content-type", "text/html; charset=utf-8");
    return reply.send(blockedPage(targetUrl.toString()));
  }

  try {
    const res = await doFetch(targetUrl.toString(),
      "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      { "Referer": targetUrl.origin+"/", "Origin": targetUrl.origin, "Upgrade-Insecure-Requests": "1" });

    const ct = res.headers.get("content-type") || "";
    const finalUrl = targetUrl.toString();

    // Check if server is sending x-frame-options / CSP frame-ancestors
    const xfo = res.headers.get("x-frame-options") || "";
    const csp = res.headers.get("content-security-policy") || "";
    if (
      xfo.toLowerCase().includes("deny") ||
      xfo.toLowerCase().includes("sameorigin") ||
      csp.includes("frame-ancestors 'none'") ||
      csp.includes("frame-ancestors 'self'")
    ) {
      reply.header("content-type", "text/html; charset=utf-8");
      return reply.send(blockedPage(finalUrl));
    }

    if (ct && !ct.includes("text/html") && !ct.includes("xhtml")) {
      return reply.redirect("/proxy/fetch?url=" + encodeURIComponent(target));
    }

    let html = await res.text();
    html = rewriteHtml(html, finalUrl);
    const inject = makeInjection(targetUrl.origin, finalUrl);
    if (/<head[\s>]/i.test(html)) html = html.replace(/<head(\s[^>]*)?>/i, m => m + inject);
    else html = inject + html;

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

// ── PROXY FETCH ───────────────────────────────────────────────────────────────

fastify.options("/proxy/fetch", async (req, reply) => {
  reply.header("access-control-allow-origin", "*");
  reply.header("access-control-allow-headers", "*");
  reply.header("access-control-allow-methods", "GET, OPTIONS");
  reply.code(204).send();
});

fastify.get("/proxy/fetch", async (req, reply) => {
  const target = req.query.url;
  if (!target) return reply.code(400).send("Missing ?url=");
  let targetUrl;
  try { targetUrl = new URL(target); } catch { return reply.code(400).send("Invalid URL"); }
  if (isBlocked(targetUrl.hostname)) return reply.code(403).send("Blocked");

  try {
    const accept = req.headers["accept"] || "*/*";
    const res = await fetch(targetUrl.toString(), {
      redirect: "follow",
      headers: {
        "User-Agent": getUA(targetUrl.toString()),
        "Accept-Language": "en-US,en;q=0.9",
        "Accept": accept,
        "Referer": targetUrl.origin + "/",
        "Origin": targetUrl.origin,
      },
    });

    const ct  = res.headers.get("content-type") || "application/octet-stream";
    const url = targetUrl.toString();

    reply.removeHeader("x-frame-options");
    reply.removeHeader("content-security-policy");
    reply.removeHeader("content-encoding");
    reply.removeHeader("transfer-encoding");
    reply.removeHeader("x-content-type-options");
    reply.header("content-type", ct);
    reply.header("access-control-allow-origin", "*");
    reply.header("access-control-allow-headers", "*");
    reply.header("access-control-allow-methods", "*");
    reply.header("cross-origin-resource-policy", "cross-origin");
    reply.header("cross-origin-embedder-policy", "unsafe-none");
    reply.header("timing-allow-origin", "*");

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

// ── YOUTUBE API ───────────────────────────────────────────────────────────────

const INVIDIOUS_INSTANCES = [
  "https://invidious.privacyredirect.com",
  "https://invidious.nerdvpn.de",
  "https://inv.nadeko.net",
  "https://invidious.io.lol",
  "https://invidious.fdn.fr",
];

async function invidiousFetch(path) {
  for (const base of INVIDIOUS_INSTANCES) {
    try {
      const res = await doFetch(`${base}${path}`, "application/json", { "Referer": base + "/" });
      const text = await res.text();
      if (!text || text.trim().startsWith("<")) continue;
      const data = JSON.parse(text);
      if (data && !data.error) return data;
    } catch(e) { /* try next */ }
  }
  return null;
}

fastify.get("/api/youtube/search", async (req, reply) => {
  const q = req.query.q || "";
  if (!q.trim()) return reply.send({ results: [] });
  try {
    const data = await invidiousFetch(`/api/v1/search?q=${encodeURIComponent(q)}&type=video&page=1`);
    if (!data || !Array.isArray(data)) return reply.send({ error: "No results from any instance" });
    const results = data.filter(v => v.type === "video").map(v => ({
      videoId:         v.videoId,
      title:           v.title,
      author:          v.author,
      viewCount:       v.viewCount,
      lengthSeconds:   v.lengthSeconds,
      videoThumbnails: v.videoThumbnails || [],
    }));
    reply.send({ results });
  } catch(err) {
    reply.send({ error: err.message });
  }
});

fastify.get("/api/youtube/trending", async (req, reply) => {
  try {
    const data = await invidiousFetch(`/api/v1/trending?type=default&region=US`);
    if (!data || !Array.isArray(data)) return reply.send({ error: "No results from any instance" });
    const results = data.map(v => ({
      videoId:         v.videoId,
      title:           v.title,
      author:          v.author,
      viewCount:       v.viewCount,
      lengthSeconds:   v.lengthSeconds,
      videoThumbnails: v.videoThumbnails || [],
    }));
    reply.send({ results });
  } catch(err) {
    reply.send({ error: err.message });
  }
});

// ── TIKTOK API ────────────────────────────────────────────────────────────────

// TikTok via RapidAPI-style public scrapers — no key needed, best effort
function normalizeTikTokItem(v) {
  const id = v.id || v.videoId || v.aweme_id || "";
  return {
    videoId:           id,
    video_description: v.desc || v.title || v.video_description || v.share_desc || "",
    username:          v.author?.uniqueId || v.author?.nickname || v.username || v.nickname || "",
    like_count:        v.stats?.diggCount ?? v.statistics?.digg_count ?? v.like_count ?? 0,
    view_count:        v.stats?.playCount ?? v.statistics?.play_count ?? v.view_count ?? 0,
    cover_image_url:   v.video?.cover || v.video?.dynamicCover || v.cover_image_url || v.video?.origin_cover || "",
    embed_link:        id ? `https://www.tiktok.com/embed/v2/${id}` : "",
  };
}

// Scrape TikTok trending page for video IDs
async function scrapeTikTokTrending() {
  const res = await doFetch("https://www.tiktok.com/trending", "text/html", {
    "Referer": "https://www.tiktok.com/",
    "Origin":  "https://www.tiktok.com",
  });
  const html = await res.text();
  // Extract __UNIVERSAL_DATA_FOR_REHYDRATION__ or itemList from page
  const match = html.match(/"itemList"\s*:\s*(\[[\s\S]{100,50000}?\])\s*[,}]/);
  if (!match) return null;
  const list = JSON.parse(match[1]);
  return list.map(normalizeTikTokItem).filter(v => v.videoId);
}

// Scrape TikTok search
async function scrapeTikTokSearch(q) {
  const url = `https://www.tiktok.com/search/video?q=${encodeURIComponent(q)}`;
  const res = await doFetch(url, "text/html", {
    "Referer": "https://www.tiktok.com/",
  });
  const html = await res.text();
  const match = html.match(/"itemList"\s*:\s*(\[[\s\S]{100,50000}?\])\s*[,}]/);
  if (!match) return null;
  const list = JSON.parse(match[1]);
  return list.map(normalizeTikTokItem).filter(v => v.videoId);
}

// Use Nitter-style TikTok open frontend as fallback
async function tikTokViaApi(q, trending = false) {
  // Try TikTok's internal app API (often works server-side)
  const url = trending
    ? `https://www.tiktok.com/api/recommend/item_list/?count=20&id=1&type=5&secUid=&maxCursor=0&minCursor=0&sourceType=12&appId=1233&region=US&priority_region=&language=en`
    : `https://www.tiktok.com/api/search/item/full/?keyword=${encodeURIComponent(q)}&offset=0&count=20&from_page=search`;
  const res = await doFetch(url, "application/json", {
    "Referer": "https://www.tiktok.com/",
    "Origin":  "https://www.tiktok.com",
    "sec-ch-ua": '"Chromium";v="124"',
    "sec-fetch-site": "same-origin",
  });
  const text = await res.text();
  if (!text || text.trim().startsWith("<")) return null;
  const data = JSON.parse(text);
  const list = data.itemList || data.item_list || [];
  if (!list.length) return null;
  return list.map(normalizeTikTokItem).filter(v => v.videoId);
}

fastify.get("/api/tiktok/trending", async (req, reply) => {
  const videos = await tryAll([
    () => tikTokViaApi("", true),
    () => scrapeTikTokTrending(),
  ]);
  if (videos && videos.length) return reply.send({ data: { videos } });
  // Last resort: return curated static popular creators' embed links
  reply.send({ data: { videos: [] }, error: "TikTok trending unavailable — try searching instead" });
});

fastify.get("/api/tiktok/search", async (req, reply) => {
  const q = req.query.q || "";
  if (!q.trim()) return reply.send({ data: { videos: [] } });
  const videos = await tryAll([
    () => tikTokViaApi(q, false),
    () => scrapeTikTokSearch(q),
  ]);
  if (videos && videos.length) return reply.send({ data: { videos } });
  reply.send({ data: { videos: [] }, error: "TikTok search unavailable — TikTok is blocking server-side requests. Try the Browser app and navigate to tiktok.com directly." });
});

// ── SEARCH API ────────────────────────────────────────────────────────────────

// Parse DuckDuckGo HTML results
function parseDDG(html) {
  const results = [];
  // Match result blocks
  const blockRe = /<div[^>]+class="[^"]*result[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
  const titleLinkRe = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i;
  const snippetRe = /<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i;
  let block;
  while ((block = blockRe.exec(html)) !== null && results.length < 10) {
    const content = block[1];
    const tl = titleLinkRe.exec(content);
    if (!tl) continue;
    let url = tl[1];
    const title = tl[2].replace(/<[^>]+>/g, "").trim();
    try {
      const u = new URL(url.startsWith("//") ? "https:" + url : url);
      url = u.searchParams.get("uddg") || decodeURIComponent(u.searchParams.get("u") || url);
    } catch {}
    if (!url || url.includes("duckduckgo.com")) continue;
    const snip = snippetRe.exec(content);
    const snippet = snip ? snip[1].replace(/<[^>]+>/g, "").trim() : "";
    results.push({ title, url, snippet });
  }
  return results;
}

// Parse Bing HTML results as fallback
function parseBing(html) {
  const results = [];
  const re = /<li[^>]+class="[^"]*b_algo[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
  const titleRe = /<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i;
  const snippetRe = /<p[^>]*>([\s\S]*?)<\/p>/i;
  let m;
  while ((m = re.exec(html)) !== null && results.length < 10) {
    const block = m[1];
    const t = titleRe.exec(block);
    if (!t) continue;
    const url = t[1];
    const title = t[2].replace(/<[^>]+>/g, "").trim();
    const s = snippetRe.exec(block);
    const snippet = s ? s[1].replace(/<[^>]+>/g, "").trim() : "";
    if (url && !url.startsWith("javascript:")) results.push({ title, url, snippet });
  }
  return results;
}

fastify.get("/api/search", async (req, reply) => {
  const q = req.query.q || "";
  if (!q.trim()) return reply.send({ results: [] });

  // Try DDG HTML first
  const results = await tryAll([
    async () => {
      const res = await doFetch(
        `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
        "text/html,application/xhtml+xml,*/*",
        { "Referer": "https://duckduckgo.com/", "Accept-Encoding": "identity" }
      );
      const html = await res.text();
      const r = parseDDG(html);
      return r.length ? r : null;
    },
    // Fallback: Bing
    async () => {
      const res = await doFetch(
        `https://www.bing.com/search?q=${encodeURIComponent(q)}&form=QBLH`,
        "text/html,*/*",
        { "Referer": "https://www.bing.com/" }
      );
      const html = await res.text();
      const r = parseBing(html);
      return r.length ? r : null;
    },
  ]);

  if (results && results.length) return reply.send({ results });
  reply.send({ results: [], error: "No results found" });
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
