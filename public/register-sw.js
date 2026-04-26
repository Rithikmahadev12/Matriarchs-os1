"use strict";

// ══════════════════════════════════════
//  MATRIARCHS OS — Scramjet SW Loader
// ══════════════════════════════════════

async function initScramjet() {
  if (!("serviceWorker" in navigator)) {
    console.warn("[MOS] Service workers not supported.");
    return;
  }

  // 1. Clear any old SWs (old Scramjet scopes, old mos-proxy-v* etc.)
  const existing = await navigator.serviceWorker.getRegistrations();
  for (const reg of existing) {
    // Keep only our current Scramjet SW if it's already registered correctly
    if (!reg.scriptURL.includes("scramjet.serviceWorker.js")) {
      console.log("[MOS] Removing stale SW:", reg.scope);
      await reg.unregister();
    }
  }

  // 2. Register Scramjet's SW at root scope
  try {
    const reg = await navigator.serviceWorker.register(
      "/scramjet/scramjet.serviceWorker.js",
      { scope: "/" }
    );
    console.log("[MOS] Scramjet SW registered, scope:", reg.scope);
  } catch (err) {
    console.error("[MOS] Scramjet SW registration failed:", err);
    return;
  }

  // 3. Wait for the SW to be ready/controlling
  await navigator.serviceWorker.ready;

  // 4. Load Scramjet client runtime and bare-mux, then configure
  await Promise.all([
    loadScript("/baremux/bare.cjs"),
    loadScript("/scramjet/scramjet.shared.js"),
  ]);

  // 5. Init bare-mux with Wisp transport
  try {
    const { BareClient } = window;
    if (BareClient) {
      window.__bm = new BareClient();
    }
    // Configure Scramjet codec + Wisp backend via bare-mux
    if (window.ScramjetController) {
      const controller = new window.ScramjetController({
        prefix:  "/scramjet/",
        codec:   "/scramjet/scramjet.codecs.js",
        wasm:    "/scramjet/scramjet.wasm.js",
        shared:  "/scramjet/scramjet.shared.js",
        worker:  "/scramjet/scramjet.worker.js",
      });
      await controller.init("/scramjet/scramjet.serviceWorker.js");
      window.__scramjet = controller;
      console.log("[MOS] Scramjet controller ready");
    }
  } catch (err) {
    console.warn("[MOS] Scramjet init error:", err);
  }

  // 6. Set up Wisp as the bare-mux transport
  try {
    if (window.BareMux) {
      const conn = new window.BareMux.BareMuxConnection("/baremux/worker.js");
      const protocol = location.protocol === "https:" ? "wss" : "ws";
      await conn.setTransport("/wisp-js/index.js", [
        { wisp: `${protocol}://${location.host}/wisp/` }
      ]);
      console.log("[MOS] Wisp transport configured");
    }
  } catch (err) {
    console.warn("[MOS] Wisp transport setup error:", err);
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => {
      console.warn("[MOS] Script load failed:", src);
      resolve(); // Don't block — degrade gracefully
    };
    document.head.appendChild(s);
  });
}

// Run after DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initScramjet);
} else {
  initScramjet();
}
