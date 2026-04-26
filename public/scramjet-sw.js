"use strict";

// ══════════════════════════════════════
//  MATRIARCHS OS — Scramjet Service Worker Bootstrap
//  Loads scramjet v1.x with correct dist file names
// ══════════════════════════════════════

// 1. Load codecs (sets self.__scramjet$codecs)
importScripts("/scramjet/scramjet.codecs.js");

// 2. Set config with correct server paths
self.__scramjet$config = {
  prefix: "/scramjet/",
  codec: self.__scramjet$codecs.plain,
  config: "/scramjet/scramjet.config.js",
  bundle: "/scramjet/scramjet.bundle.js",
  worker: "/scramjet/scramjet-sw.js",
  client: "/scramjet/scramjet.client.js",
  codecs: "/scramjet/scramjet.codecs.js",
};

// 3. Load rewriter bundle (sets self.__scramjet$bundle)
importScripts("/scramjet/scramjet.bundle.js");

// 4. Load the scramjet worker class (includes BareMux client)
importScripts("/scramjet/scramjet.worker.js");

// 5. Instantiate and wire up fetch handler
const sw = new ScramjetServiceWorker();

self.addEventListener("fetch", (event) => {
  if (sw.route(event)) {
    event.respondWith(sw.fetch(event));
  }
});

self.addEventListener("install", () => {
  console.log("[SJ SW] Installing");
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  console.log("[SJ SW] Activated");
  event.waitUntil(self.clients.claim());
});
