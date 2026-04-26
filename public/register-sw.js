"use strict";

// ══════════════════════════════════════
//  MATRIARCHS OS — Scramjet Loader
//  bare-mux v2.1.7 + wisp-js v0.4.1
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

// Probe which wisp transport file actually exists on our server
async function findWispTransport() {
  // wisp-js v0.4.x dist — the bare-mux transport worker.
  // The dist folder is served at /wisp-js/ — try known filenames in order.
  const candidates = [
    "/wisp-js/wisp-client.js",    // some builds
    "/wisp-js/client.js",         // matches 'client' export key in wisp-js
    "/wisp-js/index.js",          // fallback
  ];
  for (const path of candidates) {
    try {
      const r = await fetch(path, { method: "HEAD" });
      if (r.ok) { console.log("[MOS] Found wisp transport:", path); return path; }
    } catch {}
  }
  console.warn("[MOS] No wisp transport file found — listing /wisp-js/ to diagnose");
  // Try a GET on the dir (won't work but gives a 404 vs network error clue)
  return null;
}

async function setWispTransport(wispUrl) {
  const transportPath = await findWispTransport();
  if (!transportPath) {
    console.error("[MOS] Cannot set transport — wisp client file not found");
    return;
  }

  // bare-mux v2 requires an absolute URL for the transport worker
  const transportUrl = new URL(transportPath, location.origin).toString();
  const opts = [{ wisp: wispUrl }];

  console.log("[MOS] Setting transport:", transportUrl, "→ wisp:", wispUrl);

  const bm = window.BareMux;

  // BareMuxConnection is confirmed present and instantiable
  // The constructor takes NO arguments in v2 — worker path is baked in
  if (typeof bm.BareMuxConnection === "function") {
    // Try with no args first (v2 style — worker URL is internal)
    let conn;
    try {
      conn = new bm.BareMuxConnection();
      console.log("[MOS] BareMuxConnection() (no args) OK");
    } catch(e) {
      console.log("[MOS] BareMuxConnection() no-args failed:", e.message);
      // Fall back to passing worker path
      conn = new bm.BareMuxConnection("/baremux/worker.js");
      console.log("[MOS] BareMuxConnection('/baremux/worker.js') OK");
    }

    if (typeof conn.setTransport === "function") {
      await conn.setTransport(transportUrl, opts);
      console.log("[MOS] ✓ Transport set via BareMuxConnection.setTransport");
      return;
    }
    if (typeof conn.setClient === "function") {
      await conn.setClient(transportUrl, opts);
      console.log("[MOS] ✓ Transport set via BareMuxConnection.setClient");
      return;
    }
    console.log("[MOS] BareMuxConnection instance methods:", Object.getOwnPropertyNames(Object.getPrototypeOf(conn)));
  }

  // WorkerConnection is also exported — try that
  if (typeof bm.WorkerConnection === "function") {
    try {
      const conn = new bm.WorkerConnection("/baremux/worker.js");
      if (typeof conn.setTransport === "function") {
        await conn.setTransport(transportUrl, opts);
        console.log("[MOS] ✓ Transport set via WorkerConnection.setTransport");
        return;
      }
    } catch(e) { console.log("[MOS] WorkerConnection failed:", e.message); }
  }

  // BareClient — try it
  if (typeof bm.BareClient === "function") {
    try {
      const client = new bm.BareClient();
      console.log("[MOS] BareClient instance methods:", Object.getOwnPropertyNames(Object.getPrototypeOf(client)));
    } catch(e) { console.log("[MOS] BareClient failed:", e.message); }
  }

  console.error("[MOS] ✗ All transport methods exhausted");
}

async function initScramjet() {
  if (!("serviceWorker" in navigator)) {
    console.warn("[MOS] No SW support — server proxy only"); return;
  }

  // Remove stale SWs
  try {
    for (const reg of await navigator.serviceWorker.getRegistrations()) {
      if (!(reg.scriptURL||"").includes("scramjet-sw")) {
        await reg.unregister();
        console.log("[MOS] Removed stale SW:", reg.scope);
      }
    }
  } catch(e) { console.warn("[MOS] SW cleanup error:", e.message); }

  // Register scramjet SW
  try {
    await navigator.serviceWorker.register("/scramjet-sw.js", { scope: "/" });
    console.log("[MOS] SW registered");
  } catch(err) {
    console.warn("[MOS] SW registration failed:", err.message); return;
  }

  await navigator.serviceWorker.ready;
  console.log("[MOS] SW ready");

  // Load bare-mux
  await loadScript("/baremux/index.js");

  // Set wisp transport
  try {
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    await setWispTransport(`${protocol}://${location.host}/wisp/`);
  } catch(err) {
    console.error("[MOS] Transport setup error:", err.message, err.stack);
  }

  window.__scramjetReady = true;
  console.log("[MOS] Init complete ✦");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initScramjet);
} else {
  initScramjet();
}
