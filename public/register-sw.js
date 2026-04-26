"use strict";

// ══════════════════════════════════════
//  MATRIARCHS OS — Scramjet Loader
//  bare-mux v2 + scramjet v2-alpha
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
    console.warn("[MOS] No service worker support — using server proxy only");
    return;
  }

  // 1. Remove stale non-scramjet service workers
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    for (const reg of regs) {
      const url = reg.scriptURL || "";
      if (!url.includes("scramjet-sw")) {
        console.log("[MOS] Removing stale SW:", reg.scope);
        await reg.unregister();
      }
    }
  } catch (e) {
    console.warn("[MOS] Could not clean old SWs:", e.message);
  }

  // 2. Register scramjet SW
  try {
    await navigator.serviceWorker.register("/scramjet-sw.js", { scope: "/" });
    console.log("[MOS] Scramjet SW registered");
  } catch (err) {
    console.warn("[MOS] Scramjet SW registration failed:", err.message);
    return;
  }

  // 3. Wait for SW to control this page
  await navigator.serviceWorker.ready;
  console.log("[MOS] SW ready");

  // 4. Load bare-mux client bundle
  await loadScript("/baremux/index.js");

  // 5. Set Wisp transport — probe all known bare-mux v1/v2 API shapes
  try {
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const wispUrl  = `${protocol}://${location.host}/wisp/`;

    // Diagnostic: log what bare-mux exposed
    console.log("[MOS] window.BareMux type:", typeof window.BareMux);
    if (window.BareMux && typeof window.BareMux === "object") {
      console.log("[MOS] window.BareMux keys:", Object.keys(window.BareMux));
    }

    let set = false;

    // Shape A: window.setTransport (flat export)
    if (!set && typeof window.setTransport === "function") {
      await window.setTransport("/wisp-js/wisp-client.js", [{ wisp: wispUrl }]);
      console.log("[MOS] Transport set via window.setTransport");
      set = true;
    }

    // Shape B: BareMux.setTransport (static method on namespace object)
    if (!set && window.BareMux && typeof window.BareMux.setTransport === "function") {
      await window.BareMux.setTransport("/wisp-js/wisp-client.js", [{ wisp: wispUrl }]);
      console.log("[MOS] Transport set via BareMux.setTransport");
      set = true;
    }

    // Shape C: new BareMux.BareMuxConnection (v1 class)
    if (!set && window.BareMux && typeof window.BareMux.BareMuxConnection === "function") {
      const conn = new window.BareMux.BareMuxConnection("/baremux/worker.js");
      if (typeof conn.setTransport === "function") {
        await conn.setTransport("/wisp-js/wisp-client.js", [{ wisp: wispUrl }]);
        console.log("[MOS] Transport set via new BareMuxConnection().setTransport");
        set = true;
      } else if (typeof conn.setClient === "function") {
        await conn.setClient("/wisp-js/wisp-client.js", [{ wisp: wispUrl }]);
        console.log("[MOS] Transport set via new BareMuxConnection().setClient");
        set = true;
      }
    }

    // Shape D: BareMux itself is the Connection class
    if (!set && typeof window.BareMux === "function") {
      const conn = new window.BareMux("/baremux/worker.js");
      if (typeof conn.setTransport === "function") {
        await conn.setTransport("/wisp-js/wisp-client.js", [{ wisp: wispUrl }]);
        console.log("[MOS] Transport set via new BareMux()");
        set = true;
      }
    }

    // Shape E: BareMux.default is the Connection class
    if (!set && window.BareMux && typeof window.BareMux.default === "function") {
      const conn = new window.BareMux.default("/baremux/worker.js");
      if (typeof conn.setTransport === "function") {
        await conn.setTransport("/wisp-js/wisp-client.js", [{ wisp: wispUrl }]);
        console.log("[MOS] Transport set via new BareMux.default()");
        set = true;
      }
    }

    if (!set) {
      // Last resort: try to read the actual dist file to understand its export
      console.error("[MOS] No bare-mux API matched. Check /baremux/index.js exports.");
      console.error("[MOS] Falling back to server-side /proxy/ for all navigation.");
    }

  } catch (err) {
    console.error("[MOS] Wisp transport setup error:", err.message);
  }

  window.__scramjetReady = true;
  console.log("[MOS] Init complete ✦");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initScramjet);
} else {
  initScramjet();
}
