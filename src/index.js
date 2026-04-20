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
  try {
    const host = new URL(url).hostname;
    if (host.includes("tiktok") || host.includes("instagram")) return MOBILE_UA;
  } catch {}
  return DESKTOP_UA;
}

async function doFetch(url, accept, extra) {
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
  // Remove CSP
  html = html.replace(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*\/?>/gi, "");

  // <link> tags — stylesheets to fetch proxy, nav links to page proxy
  html = html.replace(/<link(\s[^>]*)>/gi, (tag, attrs) => {
    const isStyle = /rel=["'][^"']*\b(stylesheet|preload)\b[^"']*["']/i.test(attrs);
    attrs = attrs.replace(/\shref\s*=\s*(["'])([^"']+)\1/gi, (m, q, url) => {
      if (!url || url.startsWith("data:") || url.startsWith("#") || url.startsWith("javascript:")) return m;
      return ` href=${q}${isStyle ? toFetch(url, base) : toPage(url, base)}${q}`;
    });
    return `<link${attrs}>`;
  });

  // src= attributes
  html = html.replace(/\bsrc\s*=\s*(["'])(.*?)\1/gi, (m, q, url) =>
    url ? `src=${q}${toFetch(url, base)}${q}` : m);

  // href= on non-link tags
  html = html.replace(/(<(?!link\b)[a-z][^>]*?)\shref\s*=\s*(["'])([^"']+)\2/gi, (m, pre, q, url) => {
    if (!url || url.startsWith("data:") || url.startsWith("#") || url.startsWith("javascript:") ||
        url.startsWith("mailto:") || url.startsWith("/proxy/")) return m;
    return `${pre} href=${q}${toPage(url, base)}${q}`;
  });

  // action= forms
  html = html.replace(/\baction\s*=\s*(["'])(.*?)\1/gi, (m, q, url) =>
    url ? `action=${q}${toPage(url, base)}${q}` : m);

  // srcset=
  html = html.replace(/\bsrcset\s*=\s*(["'])(.*?)\1/gi, (m, q, srcset) => {
    const rw = srcset.split(",").map(part => {
      const t = part.trim(), si = t.search(/\s/);
      return si === -1 ? toFetch(t, base) : toFetch(t.slice(0, si), base) + t.slice(si);
    }).join(", ");
    return `srcset=${q}${rw}${q}`;
  });

  // <style> blocks
  html = html.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/gi,
    (m, o, css, c) => o + rewriteCss(css, base) + c);

  // inline style=
  html = html.replace(/\bstyle\s*=\s*(["'])(.*?)\1/gi,
    (m, q, css) => `style=${q}${rewriteCss(css, base)}${q}`);

  return html;
}

function makeInjection(origin, base) {
  return `<script>
(function(){
  var _b=${JSON.stringify(base)},_lo=location.origin;
  // Form submit interceptor
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
  // Enter key in inputs
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
  // Click interceptor
  document.addEventListener('click',function(e){
    var el=e.target;
    while(el&&el.tagName!=='A')el=el.parentElement;
    if(!el||!el.href)return;
    var href=el.href;
    if(!href||href.startsWith('#')||href.startsWith('javascript:')||href.startsWith('mailto:')||href.startsWith('blob:')||href.indexOf('/proxy/')!==-1)return;
    try{var u=new URL(href);if(u.origin===_lo)return;e.preventDefault();e.stopPropagation();top.location.href='/proxy/?url='+encodeURIComponent(u.toString());}catch(err){}
  },true);
  // fetch hook
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
  // XHR hook
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
  // history hook
  var _pp=history.pushState,_rp=history.replaceState;
  history.pushState=function(s,t,url){_pp.apply(this,arguments);try{top.postMessage({type:'mos-nav',url:new URL(url||'',_b).toString()},'*');}catch(e){}};
  history.replaceState=function(s,t,url){_rp.apply(this,arguments);try{top.postMessage({type:'mos-nav',url:new URL(url||'',_b).toString()},'*');}catch(e){}};
})();
</script>`;
}

function errorPage(msg, url) {
  return `<!DOCTYPE html><html><head><title>Proxy Error</title>
<style>body{font-family:monospace;background:#0a0a0a;color:#ff6b6b;padding:40px;margin:0}
p{color:#aaa;margin:4px 0}.url{color:#555;font-size:11px;margin-top:16px}</style>
</head><body><h2>Proxy Error</h2><p>${msg}</p><p class="url">${url}</p></body></html>`;
}

// ── PROXY PAGE ────────────────────────────────────────────────────────────────

fastify.get("/proxy/", async (req, reply) => {
  const target = req.query.url;
  if (!target) return reply.code(400).send("Missing ?url=");
  let targetUrl;
  try { targetUrl = new URL(target); } catch { return reply.code(400).send("Invalid URL"); }
  if (isBlocked(targetUrl.hostname)) return reply.code(403).send("Blocked");

  try {
    const res = await doFetch(targetUrl.toString(),
      "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      { "Referer": targetUrl.origin+"/", "Origin": targetUrl.origin, "Upgrade-Insecure-Requests": "1" });

    const ct = res.headers.get("content-type") || "";
    const finalUrl = targetUrl.toString();

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

// OPTIONS preflight for CORS
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

fastify.get("/api/youtube/search", async (req, reply) => {
  const q = req.query.q || "";
  if (!q.trim()) return reply.send({ results: [] });
  try {
    // Use Invidious public instance
    const instances = [
      "https://invidious.privacyredirect.com",
      "https://invidious.nerdvpn.de",
      "https://inv.nadeko.net",
    ];
    let data = null;
    let lastErr = "";
    for (const base of instances) {
      try {
        const res = await doFetch(
          `${base}/api/v1/search?q=${encodeURIComponent(q)}&type=video&page=1`,
          "application/json",
          { "Referer": base + "/" }
        );
        const text = await res.text();
        data = JSON.parse(text);
        if (Array.isArray(data)) break;
        data = null;
      } catch(e) { lastErr = e.message; }
    }
    if (!data) return reply.send({ error: "All Invidious instances failed: " + lastErr });
    const results = data
      .filter(v => v.type === "video")
      .map(v => ({
        videoId:          v.videoId,
        title:            v.title,
        author:           v.author,
        viewCount:        v.viewCount,
        lengthSeconds:    v.lengthSeconds,
        videoThumbnails:  v.videoThumbnails || [],
      }));
    reply.send({ results });
  } catch(err) {
    console.error("YouTube search error:", err.message);
    reply.send({ error: err.message });
  }
});

fastify.get("/api/youtube/trending", async (req, reply) => {
  try {
    const instances = [
      "https://invidious.privacyredirect.com",
      "https://invidious.nerdvpn.de",
      "https://inv.nadeko.net",
    ];
    let data = null;
    let lastErr = "";
    for (const base of instances) {
      try {
        const res = await doFetch(
          `${base}/api/v1/trending?type=default&region=US`,
          "application/json",
          { "Referer": base + "/" }
        );
        const text = await res.text();
        data = JSON.parse(text);
        if (Array.isArray(data)) break;
        data = null;
      } catch(e) { lastErr = e.message; }
    }
    if (!data) return reply.send({ error: "All Invidious instances failed: " + lastErr });
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
    console.error("YouTube trending error:", err.message);
    reply.send({ error: err.message });
  }
});

// ── TIKTOK API ────────────────────────────────────────────────────────────────

// Helper: try multiple ProxiTok instances
async function fetchProxiTok(path) {
  const instances = [
    "https://proxitok.pabloferreiro.es",
    "https://proxitok.privacyredirect.com",
    "https://tok.yields.org",
  ];
  let lastErr = "";
  for (const base of instances) {
    try {
      const res = await doFetch(
        `${base}${path}`,
        "application/json",
        { "Referer": base + "/", "Accept": "application/json" }
      );
      const text = await res.text();
      // ProxiTok sometimes returns HTML for errors
      if (text.trim().startsWith("<")) continue;
      const data = JSON.parse(text);
      return { data, error: null };
    } catch(e) { lastErr = e.message; }
  }
  return { data: null, error: lastErr };
}

function normalizeTikTokItem(v) {
  // Handle both ProxiTok and raw TikTok API shapes
  return {
    videoId:           v.id || v.videoId || "",
    video_description: v.desc || v.title || v.video_description || "",
    username:          v.author?.uniqueId || v.author?.nickname || v.username || "",
    like_count:        v.stats?.diggCount || v.like_count || 0,
    view_count:        v.stats?.playCount || v.view_count || 0,
    cover_image_url:   v.video?.cover || v.video?.dynamicCover || v.cover_image_url || "",
    embed_link:        v.id ? `https://www.tiktok.com/embed/v2/${v.id}` : (v.embed_link || ""),
  };
}

fastify.get("/api/tiktok/trending", async (req, reply) => {
  // Try ProxiTok first
  const { data: proxiData, error: proxiErr } = await fetchProxiTok("/api/trending?cursor=0&count=20");
  if (proxiData && (proxiData.items || proxiData.itemList)) {
    const list = proxiData.items || proxiData.itemList || [];
    return reply.send({ data: { videos: list.map(normalizeTikTokItem) } });
  }

  // Fallback: try TikTok's own (often blocked) recommend endpoint
  try {
    const res = await doFetch(
      "https://www.tiktok.com/api/recommend/item_list/?count=20&id=1&type=5&secUid=&maxCursor=0&minCursor=0&sourceType=12&appId=1233&region=US&priority_region=&language=en",
      "application/json",
      { "Referer": "https://www.tiktok.com/", "Origin": "https://www.tiktok.com" }
    );
    const text = await res.text();
    if (text.trim().startsWith("<")) throw new Error("TikTok returned HTML — likely blocked");
    const data = JSON.parse(text);
    const list = data.itemList || [];
    return reply.send({ data: { videos: list.map(normalizeTikTokItem) } });
  } catch(err) {
    console.error("TikTok trending error:", err.message);
    return reply.send({ error: proxiErr || err.message });
  }
});

fastify.get("/api/tiktok/search", async (req, reply) => {
  const q = req.query.q || "";
  if (!q.trim()) return reply.send({ data: { videos: [] } });

  // Try ProxiTok first
  const { data: proxiData, error: proxiErr } = await fetchProxiTok(`/api/search?keyword=${encodeURIComponent(q)}&cursor=0&count=20`);
  if (proxiData && (proxiData.items || proxiData.itemList)) {
    const list = proxiData.items || proxiData.itemList || [];
    return reply.send({ data: { videos: list.map(normalizeTikTokItem) } });
  }

  // Fallback: TikTok search endpoint (often blocked)
  try {
    const url = `https://www.tiktok.com/api/search/item/full/?keyword=${encodeURIComponent(q)}&offset=0&count=20&from_page=search`;
    const res = await doFetch(url, "application/json", {
      "Referer": "https://www.tiktok.com/",
      "Origin": "https://www.tiktok.com"
    });
    const text = await res.text();
    if (text.trim().startsWith("<")) throw new Error("TikTok returned HTML — likely blocked");
    const data = JSON.parse(text);
    const list = data.item_list || [];
    return reply.send({ data: { videos: list.map(normalizeTikTokItem) } });
  } catch(err) {
    console.error("TikTok search error:", err.message);
    return reply.send({ error: proxiErr || err.message });
  }
});

// ── SEARCH API ────────────────────────────────────────────────────────────────

fastify.get("/api/search", async (req, reply) => {
  const q = req.query.q || "";
  if (!q.trim()) return reply.send({ results: [] });
  try {
    // Use DuckDuckGo HTML scrape via proxy
    const res = await doFetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
      "text/html",
      { "Referer": "https://duckduckgo.com/" }
    );
    const html = await res.text();
    const results = [];
    // Parse result titles, URLs, snippets from DDG HTML
    const linkRe = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    const snippetRe = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
    const titles = [], urls = [], snippets = [];
    let m;
    while ((m = linkRe.exec(html)) !== null) {
      const rawUrl = m[1];
      const title  = m[2].replace(/<[^>]+>/g, "").trim();
      // DDG wraps URLs — extract uddg param
      let finalUrl = rawUrl;
      try {
        const u = new URL(rawUrl.startsWith("//") ? "https:" + rawUrl : rawUrl);
        finalUrl = u.searchParams.get("uddg") || rawUrl;
      } catch {}
      if (finalUrl && title && !finalUrl.includes("duckduckgo.com")) {
        titles.push(title);
        urls.push(decodeURIComponent(finalUrl));
      }
    }
    while ((m = snippetRe.exec(html)) !== null) {
      snippets.push(m[1].replace(/<[^>]+>/g, "").trim());
    }
    for (let i = 0; i < Math.min(titles.length, 10); i++) {
      results.push({ title: titles[i], url: urls[i], snippet: snippets[i] || "" });
    }
    reply.send({ results });
  } catch(err) {
    console.error("Search error:", err.message);
    reply.send({ error: err.message });
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
