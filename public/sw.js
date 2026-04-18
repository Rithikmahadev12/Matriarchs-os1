// ══════════════════════════════════════
//  MATRIARCHS OS — PROXY SERVICE WORKER
//  Kills old Scramjet SW on install
// ══════════════════════════════════════

const VERSION = "mos-proxy-v3";

self.addEventListener("install", (e) => {
  e.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(keys.map((key) => caches.delete(key)));
    }).then(() => self.clients.claim())
  );
});

// No fetch interception — server-side proxy handles everything
self.addEventListener("fetch", () => { return; });
