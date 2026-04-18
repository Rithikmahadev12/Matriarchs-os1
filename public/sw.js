// ══════════════════════════════════════
//  MATRIARCHS OS — PROXY SERVICE WORKER
//  Scope: /proxy/
//  Intercepts fetch calls made FROM proxied pages
//  and routes external requests through /proxy/fetch
// ══════════════════════════════════════

const VERSION = "mos-proxy-v1";

self.addEventListener("install", (e) => {
  e.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Already going through our proxy — pass straight through
  if (url.pathname.startsWith("/proxy/")) return;

  // Same origin request — pass through
  if (url.origin === self.location.origin) return;

  // External request from a proxied page — intercept and reroute
  event.respondWith(handleExternalRequest(req, url));
});

async function handleExternalRequest(req, url) {
  const proxyUrl = "/proxy/fetch?url=" + encodeURIComponent(url.toString());

  try {
    const res = await fetch(proxyUrl, {
      method: "GET", // We always GET through the proxy
      headers: {
        "Accept": req.headers.get("accept") || "*/*",
      },
    });
    return res;
  } catch (err) {
    return new Response("Proxy SW error: " + err.message, {
      status: 502,
      headers: { "Content-Type": "text/plain" },
    });
  }
}
