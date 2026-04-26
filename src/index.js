import { createServer } from "node:http";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "url";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";

const publicPath    = fileURLToPath(new URL("../public/",   import.meta.url));
const scramjetDir   = fileURLToPath(new URL("../node_modules/@mercuryworkshop/scramjet/dist/",          import.meta.url));
const bareMuxDir    = fileURLToPath(new URL("../node_modules/@mercuryworkshop/bare-mux/dist/",          import.meta.url));
const wispDir       = fileURLToPath(new URL("../node_modules/@mercuryworkshop/wisp-js/dist/",           import.meta.url));
const libcurlDir    = fileURLToPath(new URL("../node_modules/@mercuryworkshop/libcurl-transport/dist/", import.meta.url));

// ── Wisp WebSocket server ─────────────────────────────────────────────────────

let wispHandler = null;
try {
  const mod = await import("@mercuryworkshop/wisp-js");
  const serverMod = mod.server ?? mod.default?.server;
  if (serverMod) {
    if (typeof serverMod.routeRequest === "function") {
      wispHandler = serverMod.routeRequest;
      console.log("[wisp] using serverMod.routeRequest");
    } else {
      const WS = serverMod.WispServer ?? serverMod.Server ?? serverMod.default;
      if (typeof WS === "function") {
        const inst = new WS({ logLevel: 0 });
        wispHandler = (inst.routeRequest ?? inst.handleRequest).bind(inst);
        console.log("[wisp] using WispServer instance");
      }
    }
  }
} catch(e) { console.error("[wisp] load error:", e.message); }

console.log("[wisp] active:", !!wispHandler);

// ── Fastify ───────────────────────────────────────────────────────────────────

const fastify = Fastify({
  serverFactory: (handler) => {
    const server = createServer((req, res) => {
      const url = req.url || "";
      const isProxy = url.startsWith("/proxy/") || url.startsWith("/scramjet/")
                   || url.startsWith("/baremux/") || url.startsWith("/wisp-js/")
                   || url.startsWith("/libcurl/");
      if (!isProxy) {
        res.setHeader("Cross-Origin-Opener-Policy",  "same-origin");
        res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
      }
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      handler(req, res);
    });
    server.on("upgrade", (req, socket, head) => {
      if (wispHandler && req.url.startsWith("/wisp/")) {
        try { wispHandler(req, socket, head); }
        catch(e) { console.error("[wisp] error:", e.message); socket.end("HTTP/1.1 500\r\n\r\n"); }
      } else {
        socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
      }
    });
    return server;
  },
});

// ── Static files ──────────────────────────────────────────────────────────────

fastify.register(fastifyStatic, { root: publicPath,  decorateReply: true,  setHeaders: r => r.setHeader("Cross-Origin-Resource-Policy","cross-origin") });
fastify.register(fastifyStatic, { root: scramjetDir, prefix: "/scramjet/", decorateReply: false, setHeaders: r => r.setHeader("Cross-Origin-Resource-Policy","cross-origin") });
fastify.register(fastifyStatic, { root: bareMuxDir,  prefix: "/baremux/",  decorateReply: false, setHeaders: r => r.setHeader("Cross-Origin-Resource-Policy","cross-origin") });
fastify.register(fastifyStatic, { root: wispDir,     prefix: "/wisp-js/",  decorateReply: false, setHeaders: r => r.setHeader("Cross-Origin-Resource-Policy","cross-origin") });
fastify.register(fastifyStatic, { root: libcurlDir,  prefix: "/libcurl/",  decorateReply: false, setHeaders: r => r.setHeader("Cross-Origin-Resource-Policy","cross-origin") });

// ── Diagnostics ───────────────────────────────────────────────────────────────

fastify.get("/api/diag", async (req, reply) => {
  const dirs = { scramjet: scramjetDir, baremux: bareMuxDir, wisp: wispDir, libcurl: libcurlDir };
  const out = {};
  for (const [k,d] of Object.entries(dirs)) {
    try { out[k] = readdirSync(d); } catch(e) { out[k] = e.message; }
  }
  return reply.send(out);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const BLOCKED = new Set(["localhost","127.0.0.1","0.0.0.0","::1","169.254.169.254"]);
function isBlocked(h) { return BLOCKED.has(h)||h.endsWith(".internal")||h.endsWith(".local"); }
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const STRIP_RES = new Set(["content-encoding","transfer-encoding","x-frame-options","content-security-policy","cross-origin-opener-policy","cross-origin-embedder-policy","cross-origin-resource-policy"]);

async function upstreamFetch(targetUrl, extraHeaders={}) {
  const ctrl=new AbortController(), t=setTimeout(()=>ctrl.abort(),20000);
  try { return await fetch(targetUrl,{signal:ctrl.signal,redirect:"follow",headers:{"User-Agent":UA,"Accept-Language":"en-US,en;q=0.9","Referer":new URL(targetUrl).origin+"/",...extraHeaders}}); }
  finally { clearTimeout(t); }
}
function proxyHeaders(reply) { reply.header("access-control-allow-origin","*"); reply.header("access-control-allow-headers","*"); reply.header("cross-origin-resource-policy","cross-origin"); }

// ── /proxy/ ───────────────────────────────────────────────────────────────────

function rewriteBody(html, base) {
  html = html.replace(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*\/?>/gi,"");
  html = html.replace(/\bsrc\s*=\s*(["'])((?!data:|blob:|javascript:)[^"']+)\1/gi,(_,q,u)=>`src=${q}${rewriteUrl(u,base,"fetch")}${q}`);
  html = html.replace(/\bhref\s*=\s*(["'])((?!#|javascript:|mailto:|data:|blob:)[^"']+)\1/gi,(_,q,u)=>`href=${q}${rewriteUrl(u,base,"page")}${q}`);
  html = html.replace(/\baction\s*=\s*(["'])((?!javascript:)[^"']+)\1/gi,(_,q,u)=>`action=${q}${rewriteUrl(u,base,"page")}${q}`);
  html = html.replace(/\bsrcset\s*=\s*(["'])(.*?)\1/gi,(_,q,ss)=>`srcset=${q}${ss.split(",").map(p=>{const t=p.trim(),s=t.search(/\s/),u=s===-1?t:t.slice(0,s),d=s===-1?"":t.slice(s);return rewriteUrl(u,base,"fetch")+d;}).join(", ")}${q}`);
  html = html.replace(/url\(\s*(["']?)((?!data:|blob:)[^"')]+)\1\s*\)/gi,(_,q,u)=>`url(${q}${rewriteUrl(u,base,"fetch")}${q})`);
  const inject=`<script>(function(){var _b=${JSON.stringify(base)},_o=location.origin;var _f=window.fetch;window.fetch=function(i,n){try{var u=typeof i==="string"?i:(i instanceof Request?i.url:String(i));if(u&&!u.startsWith("data:")&&!u.startsWith("blob:")){var a=new URL(u,_b).toString();if(!a.startsWith(_o))return _f("/proxy/fetch?url="+encodeURIComponent(a),n);}}catch(e){}return _f(i,n);};var _x=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){try{if(u&&!String(u).startsWith("data:")&&!String(u).startsWith("blob:")){var a=new URL(String(u),_b).toString();if(!a.startsWith(_o))arguments[1]="/proxy/fetch?url="+encodeURIComponent(a);}}catch(e){}return _x.apply(this,arguments);};var _p=history.pushState.bind(history);history.pushState=function(s,t,u){_p(s,t,u);try{top.postMessage({type:"mos-nav",url:new URL(u,_b).toString()},"*");}catch(e){}};document.addEventListener("click",function(e){var el=e.target;while(el&&el.tagName!=="A")el=el.parentElement;if(!el||!el.href)return;var h=el.href;if(!h||h.startsWith("#")||h.startsWith("javascript:")||h.startsWith("mailto:")||h.indexOf("/proxy/")!==-1)return;try{var u=new URL(h);if(u.origin===_o)return;e.preventDefault();e.stopPropagation();top.location.href="/proxy/?url="+encodeURIComponent(u.toString());}catch(e){}},true);document.addEventListener("submit",function(e){var f=e.target;if(!f||!f.action)return;try{var u=new URL(f.action,_b);if(u.origin===_o)return;e.preventDefault();var q=new URLSearchParams(new FormData(f)).toString();top.location.href="/proxy/?url="+encodeURIComponent(u.toString()+(q?"?"+q:""));}catch(e){}},true);})();<\/script>`;
  return /<head[\s>]/i.test(html)?html.replace(/<head(\s[^>]*)?>/i,m=>m+inject):inject+html;
}
function rewriteUrl(url,base,mode) {
  if(!url)return url;const u=url.trim();
  if(!u||u.startsWith("/proxy/")||u.startsWith("data:")||u.startsWith("blob:"))return u;
  try{const a=new URL(u,base).toString();return mode==="page"?"/proxy/?url="+encodeURIComponent(a):"/proxy/fetch?url="+encodeURIComponent(a);}catch{return url;}
}

fastify.get("/proxy/", async(req,reply)=>{
  const target=req.query.url;if(!target)return reply.code(400).type("text/html").send("<h2>Missing ?url=</h2>");
  let targetUrl;try{targetUrl=new URL(target).toString();}catch{return reply.code(400).type("text/html").send("<h2>Invalid URL</h2>");}
  const h=new URL(targetUrl).hostname;if(isBlocked(h))return reply.code(403).type("text/html").send("<h2>Blocked</h2>");
  const rh=(req.headers["host"]||"").split(":")[0];if(h===rh)return reply.code(400).type("text/html").send("<h2>Cannot proxy this origin</h2>");
  try{
    const up=await upstreamFetch(targetUrl,{"Accept":"text/html,application/xhtml+xml,*/*;q=0.8","Upgrade-Insecure-Requests":"1"});
    const ct=up.headers.get("content-type")||"";
    if(!ct.includes("text/html")&&!ct.includes("xhtml"))return reply.redirect("/proxy/fetch?url="+encodeURIComponent(targetUrl));
    proxyHeaders(reply);reply.header("content-type","text/html; charset=utf-8");
    return reply.send(rewriteBody(await up.text(),targetUrl));
  }catch(e){console.error("[proxy/]",e.message);return reply.code(502).type("text/html").send(`<h2 style="font-family:monospace;padding:40px;color:#ff6b6b">Proxy error: ${e.message}</h2>`);}
});

fastify.get("/proxy/fetch", async(req,reply)=>{
  const target=req.query.url;if(!target)return reply.code(400).send("Missing ?url=");
  let targetUrl;try{targetUrl=new URL(target).toString();}catch{return reply.code(400).send("Invalid URL");}
  if(isBlocked(new URL(targetUrl).hostname))return reply.code(403).send("Blocked");
  const rh=(req.headers["host"]||"").split(":")[0];if(new URL(targetUrl).hostname===rh)return reply.code(400).send("Cannot proxy this origin");
  try{
    const up=await upstreamFetch(targetUrl,{"Accept":req.headers["accept"]||"*/*"});
    for(const[k,v]of up.headers.entries()){if(!STRIP_RES.has(k.toLowerCase()))reply.header(k,v);}
    proxyHeaders(reply);return reply.send(Buffer.from(await up.arrayBuffer()));
  }catch(e){console.error("[proxy/fetch]",e.message);return reply.code(502).send("Proxy error: "+e.message);}
});

// ── APIs ──────────────────────────────────────────────────────────────────────

fastify.get("/api/search",async(req,reply)=>{const q=req.query.q;if(!q)return reply.code(400).send({error:"Missing q"});try{const r=await fetch(`https://search.brave.com/api/suggest?q=${encodeURIComponent(q)}&rich=true`,{headers:{"User-Agent":UA,"Accept":"application/json"}});const d=await r.json();const results=(Array.isArray(d)?d[1]||[]:d).map(s=>typeof s==="string"?{title:s,url:`https://search.brave.com/search?q=${encodeURIComponent(s)}`,snippet:""}:{title:s.phrase||s,url:s.url||`https://search.brave.com/search?q=${encodeURIComponent(s.phrase||s)}`,snippet:s.desc||""});return reply.send({results});}catch(e){return reply.code(502).send({error:e.message});}});

const INV=["https://invidious.io.lol","https://invidious.privacyredirect.com","https://vid.puffyan.us"];
async function invFetch(path){for(const b of INV){try{const r=await fetch(b+path,{headers:{"User-Agent":UA},signal:AbortSignal.timeout(8000)});if(r.ok)return r.json();}catch{}}throw new Error("All Invidious instances failed");}
fastify.get("/api/youtube/search",async(req,reply)=>{const q=req.query.q;if(!q)return reply.code(400).send({error:"Missing q"});try{return reply.send({results:await invFetch(`/api/v1/search?q=${encodeURIComponent(q)}&type=video`)});}catch(e){return reply.code(502).send({error:e.message});}});
fastify.get("/api/youtube/trending",async(req,reply)=>{try{return reply.send({results:await invFetch("/api/v1/trending?type=default")});}catch(e){return reply.code(502).send({error:e.message});}});
fastify.get("/api/tiktok/search",async(req,reply)=>{const q=req.query.q;if(!q)return reply.code(400).send({error:"Missing q"});try{const r=await fetch(`https://www.tiktok.com/api/search/general/full/?keyword=${encodeURIComponent(q)}&count=20`,{headers:{"User-Agent":UA,"Referer":"https://www.tiktok.com/"}});return reply.send(await r.json());}catch(e){return reply.code(502).send({error:e.message});}});
fastify.get("/api/tiktok/trending",async(req,reply)=>{try{const r=await fetch("https://www.tiktok.com/api/recommend/itemlist/?recommendGeo=US&count=20",{headers:{"User-Agent":UA,"Referer":"https://www.tiktok.com/"}});return reply.send(await r.json());}catch(e){return reply.code(502).send({error:e.message});}});

fastify.setNotFoundHandler((req,reply)=>reply.code(404).type("text/html").sendFile("404.html"));

fastify.server.on("listening",()=>{const a=fastify.server.address();console.log(`✦ Matriarchs OS  http://localhost:${a.port}`);console.log(`  Wisp active:   ${!!wispHandler}`);});
process.on("SIGINT",()=>{fastify.close();process.exit(0);});
process.on("SIGTERM",()=>{fastify.close();process.exit(0);});
fastify.listen({port:parseInt(process.env.PORT||"")||8080,host:"0.0.0.0"});
