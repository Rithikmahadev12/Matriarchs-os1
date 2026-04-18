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

// ══════════════════════════════════════
//  INJECTION SCRIPT
//  Injected into every proxied HTML page.
//  Intercepts fetch, XHR, WebSocket, clicks,
//  form submits, and location changes so all
//  network traffic routes through /proxy.
// ══════════════════════════════════════

function buildInjection(pageUrl) {
  const pageOrigin = (() => { try { return new URL(pageUrl).origin; } catch { return ""; } })();
  return `
<script data-proxy-injected="1">
(function(){
  var __base  = ${JSON.stringify(pageUrl)};
  var __origin = ${JSON.stringify(pageOrigin)};

  // ── URL rewriter ──────────────────────────────────────
  function __p(url) {
    if (!url || typeof url !== "string") return url;
    if (url.startsWith("data:") || url.startsWith("blob:") ||
        url.startsWith("javascript:") || url.startsWith("#") ||
        url.startsWith("mailto:") || url.startsWith("/proxy?url=")) return url;
    try {
      var abs = new URL(url, __base).toString();
      return "/proxy?url=" + encodeURIComponent(abs);
    } catch(e) { return url; }
  }

  // ── Fake location so sites don't detect proxy ─────────
  var __fakeLocation = new URL(__base);
  try {
    Object.defineProperty(window, "location", {
      get: function() { return __fakeLocation; },
      configurable: true
    });
  } catch(e) {}

  // ── Intercept fetch ───────────────────────────────────
  var __origFetch = window.fetch;
  window.fetch = function(input, init) {
    try {
      if (typeof input === "string") {
        input = __p(input);
      } else if (input && input.url) {
        input = new Request(__p(input.url), input);
      }
    } catch(e) {}
    return __origFetch.call(this, input, init);
  };

  // ── Intercept XMLHttpRequest ──────────────────────────
  var __OrigXHR = window.XMLHttpRequest;
  function __PatchedXHR() {
    var xhr = new __OrigXHR();
    var _open = xhr.open.bind(xhr);
    xhr.open = function(method, url, async, user, pass) {
      try { url = __p(url); } catch(e) {}
      return _open(method, url,
        async === undefined ? true : async,
        user, pass);
    };
    return xhr;
  }
  __PatchedXHR.prototype = __OrigXHR.prototype;
  window.XMLHttpRequest = __PatchedXHR;

  // ── Intercept WebSocket ───────────────────────────────
  var __OrigWS = window.WebSocket;
  window.WebSocket = function(url, protocols) {
    // Just let WebSocket through — we can't easily proxy WS
    // without a server-side tunnel, but at least don't break it
    try { return new __OrigWS(url, protocols); } catch(e) {}
  };
  window.WebSocket.prototype = __OrigWS.prototype;

  // ── Intercept history ─────────────────────────────────
  var __origPush    = history.pushState.bind(history);
  var __origReplace = history.replaceState.bind(history);
  history.pushState = function(state, title, url) {
    try {
      if (url) {
        var abs = new URL(url, __base).toString();
        window.parent.postMessage({ type: "__proxy_nav", url: abs }, "*");
      }
    } catch(e) {}
    return __origPush(state, title, url);
  };
  history.replaceState = function(state, title, url) {
    try {
      if (url) {
        var abs = new URL(url, __base).toString();
        window.parent.postMessage({ type: "__proxy_nav", url: abs }, "*");
      }
    } catch(e) {}
    return __origReplace(state, title, url);
  };

  // ── Intercept link clicks ─────────────────────────────
  document.addEventListener("click", function(e) {
    var el = e.target;
    while (el && el.tagName !== "A") el = el.parentElement;
    if (!el || !el.href) return;
    var href = el.getAttribute("href");
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
    try {
      var abs = new URL(href, __base).toString();
      e.preventDefault();
      e.stopPropagation();
      window.location.href = "/proxy?url=" + encodeURIComponent(abs);
      window.parent.postMessage({ type: "__proxy_nav", url: abs }, "*");
    } catch(err) {}
  }, true);

  // ── Intercept form submits ────────────────────────────
  document.addEventListener("submit", function(e) {
    var form = e.target;
    if (!form || !form.action) return;
    try {
      var abs = new URL(form.action, __base).toString();
      form.action = "/proxy?url=" + encodeURIComponent(abs);
    } catch(err) {}
  }, true);

  // ── Unblock iframe embedding ──────────────────────────
  try {
    Object.defineProperty(window, "top",    { get: function() { return window; }, configurable: true });
    Object.defineProperty(window, "parent", { get: function() { return window; }, configurable: true });
    Object.defineProperty(window, "frameElement", { get: function() { return null; }, configurable: true });
  } catch(e) {}

  console.log("[Proxy] Injected for", __base);
})();
</script>`;
}


// ══════════════════════════════════════
//  HTML REWRITER
// ══════════════════════════════════════

function rewriteHtml(html, pageUrl) {
  // Rewrite href / src / action / srcset
  html = html.replace(/(\s(?:href|src|action|data-src)=["'])([^"']+)(["'])/gi, (m, pre, url, post) => {
    return pre + proxyUrl(url, pageUrl) + post;
  });

  html = html.replace(/(\ssrcset=["'])([^"']+)(["'])/gi, (m, pre, srcset, post) => {
    const rewritten = srcset.split(",").map(part => {
      const [u, ...rest] = part.trim().split(/\s+/);
      return [proxyUrl(u, pageUrl), ...rest].join(" ");
    }).join(", ");
    return pre + rewritten + post;
  });

  // Rewrite url() in inline styles
  html = html.replace(/url\(\s*(['"]?)((?!data:)[^'")]+)\1\s*\)/gi, (m, q, u) => {
    try {
      const abs = new URL(u, pageUrl).toString();
      return `url(${q}/proxy?url=${encodeURIComponent(abs)}${q})`;
    } catch { return m; }
  });

  // Inject interception script right after <head>
  const injection = buildInjection(pageUrl);
  if (/<head(\s[^>]*)?>/i.test(html)) {
    html = html.replace(/<head(\s[^>]*)?>/i, (m) => m + injection);
  } else {
    html = injection + html;
  }

  return html;
}

function rewriteCss(css, pageUrl) {
  return css.replace(/url\(\s*(['"]?)((?!data:)[^'")]+)\1\s*\)/gi, (m, q, u) => {
    try {
      const abs = new URL(u, pageUrl).toString();
      return `url(${q}/proxy?url=${encodeURIComponent(abs)}${q})`;
    } catch { return m; }
  });
}

function rewriteJs(js, pageUrl) {
  // Rewrite string literals that look like absolute URLs from the same origin
  // This is best-effort — fully rewriting minified JS is not possible without a real parser
  try {
    const origin = new URL(pageUrl).origin;
    const escaped = origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(["'\`])${escaped}(/[^"'\`]*)\\1`, "g");
    js = js.replace(re, (m, q, path) => {
      const abs = origin + path;
      return `${q}/proxy?url=${encodeURIComponent(abs)}${q}`;
    });
  } catch(e) {}
  return js;
}

function proxyUrl(url, pageUrl) {
  if (!url) return url;
  url = url.trim();
  if (url.startsWith("data:") || url.startsWith("blob:") ||
      url.startsWith("#") || url.startsWith("javascript:") ||
      url.startsWith("mailto:") || url.startsWith("/proxy?url=")) return url;
  try {
    const abs = new URL(url, pageUrl).toString();
    return "/proxy?url=" + encodeURIComponent(abs);
  } catch { return url; }
}


// ══════════════════════════════════════
//  PROXY ROUTE
// ══════════════════════════════════════

const BLOCKED_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

fastify.get("/proxy", async (request, reply) => {
  const target = request.query.url;
  if (!target) return reply.code(400).send("Missing ?url=");

  let targetUrl;
  try { targetUrl = new URL(target); }
  catch { return reply.code(400).send("Invalid URL"); }

  if (BLOCKED_HOSTS.has(targetUrl.hostname)) return reply.code(403).send("Blocked");

  try {
    const response = await fetch(targetUrl.toString(), {
      headers: {
        "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "identity",
        "Referer":         targetUrl.origin,
        "Origin":          targetUrl.origin,
      },
      redirect: "follow",
    });

    // Use the final URL after redirects
    const finalUrl = response.url || targetUrl.toString();
    const contentType = response.headers.get("content-type") || "text/plain";

    // Strip headers that break embedding / caching
    const stripHeaders = [
      "x-frame-options", "content-security-policy",
      "content-security-policy-report-only", "x-content-type-options",
      "strict-transport-security", "permissions-policy",
      "cross-origin-opener-policy", "cross-origin-embedder-policy",
      "cross-origin-resource-policy",
    ];
    for (const h of stripHeaders) reply.removeHeader(h);

    reply.header("content-type", contentType);
    reply.header("x-proxied-url", finalUrl);
    reply.header("access-control-allow-origin", "*");

    if (contentType.includes("text/html")) {
      let html = await response.text();
      html = rewriteHtml(html, finalUrl);
      return reply.send(html);
    }

    if (contentType.includes("text/css")) {
      let css = await response.text();
      css = rewriteCss(css, finalUrl);
      return reply.send(css);
    }

    if (contentType.includes("javascript") || contentType.includes("ecmascript")) {
      let js = await response.text();
      js = rewriteJs(js, finalUrl);
      return reply.send(js);
    }

    // Binary / everything else — stream through
    const buffer = await response.arrayBuffer();
    return reply.send(Buffer.from(buffer));

  } catch (err) {
    console.error("Proxy error:", err.message);
    return reply.code(502).type("text/html").send(`
      <html>
      <head><style>
        body { font-family: monospace; background: #0a0a0a; color: #e0e0e0; padding: 40px; }
        h2 { color: #ff6b6b; } pre { color: #888; font-size: 12px; }
        a { color: #4fc; }
      </style></head>
      <body>
        <h2>⚠ Proxy Error</h2>
        <p>${err.message}</p>
        <pre>URL: ${target}</pre>
        <p><a href="javascript:history.back()">← Go back</a></p>
      </body>
      </html>
    `);
  }
});


// ══════════════════════════════════════
//  404 HANDLER
// ══════════════════════════════════════

fastify.setNotFoundHandler((req, reply) => {
  return reply.code(404).type("text/html").sendFile("404.html");
});


// ══════════════════════════════════════
//  START
// ══════════════════════════════════════

fastify.server.on("listening", () => {
  const address = fastify.server.address();
  console.log("Listening on:");
  console.log(`\thttp://localhost:${address.port}`);
  console.log(`\thttp://${hostname()}:${address.port}`);
  console.log(`\thttp://${address.family === "IPv6" ? `[${address.address}]` : address.address}:${address.port}`);
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
