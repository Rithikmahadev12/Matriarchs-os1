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
//  SERVER-SIDE PROXY ROUTE
// ══════════════════════════════════════

fastify.get("/proxy", async (request, reply) => {
  const target = request.query.url;

  if (!target) {
    return reply.code(400).send("Missing ?url= parameter");
  }

  // Make sure it's a valid URL
  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch {
    return reply.code(400).send("Invalid URL");
  }

  // Block local network access
  const blocked = ["localhost", "127.0.0.1", "0.0.0.0", "::1"];
  if (blocked.includes(targetUrl.hostname)) {
    return reply.code(403).send("Blocked");
  }

  try {
    const response = await fetch(targetUrl.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "identity",
      },
      redirect: "follow",
    });

    const contentType = response.headers.get("content-type") || "text/plain";

    // Forward important headers
    reply.header("content-type", contentType);
    reply.header("x-proxied-url", targetUrl.toString());

    // Remove headers that break iframe embedding
    reply.removeHeader("x-frame-options");
    reply.removeHeader("content-security-policy");
    reply.removeHeader("x-content-type-options");

    // If HTML — rewrite links to go through the proxy
    if (contentType.includes("text/html")) {
      let html = await response.text();
      const base = targetUrl.origin;

      // Rewrite absolute URLs
      html = rewriteHtml(html, base, targetUrl.toString());

      // Inject a base-fix script so relative JS fetches also get proxied
      const injected = `
<script>
(function() {
  const __proxyBase = ${JSON.stringify(targetUrl.toString())};
  const __proxyOrigin = ${JSON.stringify(targetUrl.origin)};
  const origFetch = window.fetch;
  window.fetch = function(url, opts) {
    try {
      const abs = new URL(url, __proxyBase).toString();
      if (abs.startsWith(__proxyOrigin)) {
        return origFetch('/proxy?url=' + encodeURIComponent(abs), opts);
      }
    } catch(e) {}
    return origFetch(url, opts);
  };
})();
</script>`;

      html = html.replace(/<head([^>]*)>/i, `<head$1>${injected}`);
      return reply.send(html);
    }

    // For CSS — rewrite urls() inside it
    if (contentType.includes("text/css")) {
      let css = await response.text();
      css = css.replace(/url\(['"]?((?!data:)[^'")]+)['"]?\)/gi, (match, u) => {
        try {
          const abs = new URL(u, targetUrl.toString()).toString();
          return `url('/proxy?url=${encodeURIComponent(abs)}')`;
        } catch { return match; }
      });
      return reply.send(css);
    }

    // Everything else (images, fonts, JS, etc.) — stream through
    const buffer = await response.arrayBuffer();
    return reply.send(Buffer.from(buffer));

  } catch (err) {
    console.error("Proxy error:", err);
    return reply.code(502).type("text/html").send(`
      <html><body style="font-family:monospace;background:#0a0a0a;color:#ff6b6b;padding:40px">
        <h2>Proxy Error</h2>
        <p>${err.message}</p>
        <p style="color:#666;font-size:12px">URL: ${target}</p>
      </body></html>
    `);
  }
});

// ══════════════════════════════════════
//  HTML REWRITER
// ══════════════════════════════════════

function rewriteHtml(html, base, pageUrl) {
  // Rewrite href attributes
  html = html.replace(/\shref=['"]([^'"]+)['"]/gi, (match, url) => {
    return ` href="${proxyUrl(url, pageUrl)}"`;
  });

  // Rewrite src attributes
  html = html.replace(/\ssrc=['"]([^'"]+)['"]/gi, (match, url) => {
    return ` src="${proxyUrl(url, pageUrl)}"`;
  });

  // Rewrite action attributes (forms)
  html = html.replace(/\saction=['"]([^'"]+)['"]/gi, (match, url) => {
    return ` action="${proxyUrl(url, pageUrl)}"`;
  });

  // Rewrite srcset
  html = html.replace(/\ssrcset=['"]([^'"]+)['"]/gi, (match, srcset) => {
    const rewritten = srcset.split(",").map(part => {
      const [u, ...rest] = part.trim().split(/\s+/);
      return [proxyUrl(u, pageUrl), ...rest].join(" ");
    }).join(", ");
    return ` srcset="${rewritten}"`;
  });

  // Rewrite CSS url() inside style tags
  html = html.replace(/url\(['"]?((?!data:)[^'")]+)['"]?\)/gi, (match, u) => {
    try {
      const abs = new URL(u, pageUrl).toString();
      return `url('/proxy?url=${encodeURIComponent(abs)}')`;
    } catch { return match; }
  });

  return html;
}

function proxyUrl(url, pageUrl) {
  // Skip data URIs, anchors, javascript:, mailto:
  if (!url || url.startsWith("data:") || url.startsWith("#") ||
      url.startsWith("javascript:") || url.startsWith("mailto:")) {
    return url;
  }
  try {
    const abs = new URL(url, pageUrl).toString();
    return "/proxy?url=" + encodeURIComponent(abs);
  } catch {
    return url;
  }
}

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
  console.log(
    `\thttp://${
      address.family === "IPv6" ? `[${address.address}]` : address.address
    }:${address.port}`
  );
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

fastify.listen({
  port: port,
  host: "0.0.0.0",
});
