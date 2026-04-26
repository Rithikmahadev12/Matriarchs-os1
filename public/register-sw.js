"use strict";

// ══════════════════════════════════════
//  MATRIARCHS OS — Scramjet SW Loader
// ══════════════════════════════════════

window.__scramjetReady = false;

async function loadScript(src) {
  return new Promise((resolve) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement("script");
    s.src = src;
    s.onload  = resolve;
    s.onerror = () => { console.warn("[MOS] Script load failed:", src); resolve(); };
    document.head.appendChild(s);
  });
}

async function initScramjet() {
  if (!("serviceWorker" in navigator)) {
    console.warn("[MOS] No service worker support");
    return;
  }

  // 1. Unregister anything that isn't Scramjet's SW
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    for (const reg of regs) {
      const url = reg.scriptURL || "";
      if (!url.includes("scramjet.serviceWorker")) {
        console.log("[MOS] Removing stale SW:", reg.scope);
        await reg.unregister();
      }
    }
  } catch (e) {
    console.warn("[MOS] Could not clean old SWs:", e.message);
  }

  // 2. Register Scramjet's SW
  try {
    await navigator.serviceWorker.register(
      "/scramjet/scramjet.serviceWorker.js",
      { scope: "/" }
    );
    console.log("[MOS] Scramjet SW registered");
  } catch (err) {
    console.error("[MOS] Scramjet SW registration failed:", err);
    return;
  }

  // 3. Wait for SW to be ready
  await navigator.serviceWorker.ready;
  console.log("[MOS] SW ready");

  // 4. Load bare-mux + scramjet shared runtime
  await loadScript("/baremux/bare.cjs");
  await loadScript("/scramjet/scramjet.shared.js");

  // 5. Set Wisp as bare-mux transport
  try {
    if (window.BareMux) {
      const conn = new window.BareMux.BareMuxConnection("/baremux/worker.js");
      const protocol = location.protocol === "https:" ? "wss" : "ws";
      await conn.setTransport("/wisp-js/index.js", [
        { wisp: `${protocol}://${location.host}/wisp/` }
      ]);
      console.log("[MOS] Wisp transport set");
    } else {
      console.warn("[MOS] BareMux not found on window after script load");
    }
  } catch (err) {
    console.warn("[MOS] Wisp transport error:", err);
  }

  // 6. Init Scramjet controller
  try {
    if (window.ScramjetController) {
      const controller = new window.ScramjetController({
        prefix: "/scramjet/",
        codec:  "/scramjet/scramjet.codecs.js",
        wasm:   "/scramjet/scramjet.wasm.js",
        shared: "/scramjet/scramjet.shared.js",
        worker: "/scramjet/scramjet.worker.js",
      });
      await controller.init("/scramjet/scramjet.serviceWorker.js");
      window.__scramjet = controller;
      window.__scramjetReady = true;
      console.log("[MOS] Scramjet controller ready ✦");
    } else {
      console.warn("[MOS] ScramjetController not on window — SW handles encoding directly");
      window.__scramjetReady = true;
    }
  } catch (err) {
    console.warn("[MOS] Scramjet controller init error:", err);
    window.__scramjetReady = true;
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initScramjet);
} else {
  initScramjet();
}
