// ══════════════════════════════════════
//  MATRIARCHS OS — PROXY SERVICE WORKER
//  Scope: /proxy/
//  Intercepts ALL external resource requests
//  from proxied pages (CSS, JS, images, XHR, fetch)
// ══════════════════════════════════════

const VERSION = "mos-proxy-v4";
const PROXY_ORIGIN = self.location.origin;

self.addEventListener("install", (e) => {
  console.log("[MOS SW] Installing", VERSION);
  e.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (e) => {
  console.log("[MOS SW] Activating", VERSION);
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Pass through same-origin requests (our own server)
  if (url.origin === PROXY_ORIGIN) return;

  // Skip navigate mode — handled by HTML rewriter + click interceptor
  // (navigate = full page loads from link clicks)
  if (req.mode === "navigate") return;

  // All other external requests — CSS, JS, images, fonts, XHR, fetch
  // Route through our /proxy/fetch endpoint
  event.respondWith(handleResource(req, url));
});

async function handleResource(req, url) {
  const proxyUrl = PROXY_ORIGIN + "/proxy/fetch?url=" + encodeURIComponent(url.toString());

  try {
    const res = await fetch(proxyUrl, {
      method: "GET",
      headers: {
        "Accept": req.headers.get("accept") || "*/*",
        "Accept-Language": req.headers.get("accept-language") || "en-US,en;q=0.9",
      },
    });
    return res;
  } catch (err) {
    console.error("[MOS SW] Fetch error:", err.message, url.toString());
    return new Response("SW proxy error: " + err.message, {
      status: 502,
      headers: { "Content-Type": "text/plain" },
    });
  }
}
