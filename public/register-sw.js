"use strict";

// ══════════════════════════════════════
//  MATRIARCHS OS — Scramjet Loader
//  Works with scramjet v1.x (npm stable)
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

  // 2. Register our scramjet SW bootstrap
  try {
    await navigator.serviceWorker.register("/scramjet-sw.js", { scope: "/" });
    console.log("[MOS] Scramjet SW registered");
  } catch (err) {
    console.warn("[MOS] Scramjet SW registration failed:", err.message, "— server proxy fallback active");
    return;
  }

  // 3. Wait for SW to be controlling
  await navigator.serviceWorker.ready;
  console.log("[MOS] SW ready");

  // 4. Load BareMux runtime
  await loadScript("/baremux/index.js");

  // 5. Set Wisp as the transport
  try {
    if (window.BareMux && window.BareMux.BareMuxConnection) {
      const conn = new window.BareMux.BareMuxConnection("/baremux/worker.js");
      const protocol = location.protocol === "https:" ? "wss" : "ws";
      await conn.setTransport("/wisp-js/wisp-client.js", [
        { wisp: `${protocol}://${location.host}/wisp/` }
      ]);
      console.log("[MOS] Wisp transport set via BareMux");
    } else {
      console.warn("[MOS] BareMux not available on window");
    }
  } catch (err) {
    console.warn("[MOS] Wisp transport error:", err.message);
  }

  window.__scramjetReady = true;
  console.log("[MOS] Scramjet ready ✦");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initScramjet);
} else {
  initScramjet();
}
