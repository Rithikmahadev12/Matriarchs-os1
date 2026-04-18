"use strict";

// ══════════════════════════════════════
//  REGISTER SERVICE WORKER
//  Scoped to /proxy/ — NOT root scope
//  This is KEY: /proxy/ is narrower than /
//  so no Service-Worker-Allowed header needed,
//  which means BunnyCDN can't block it.
// ══════════════════════════════════════

async function registerSW() {
  if (!("serviceWorker" in navigator)) return;

  try {
    const reg = await navigator.serviceWorker.register("/sw.js", {
      scope: "/proxy/",
    });

    // Wait for it to be active
    if (reg.installing) {
      await new Promise((resolve) => {
        reg.installing.addEventListener("statechange", (e) => {
          if (e.target.state === "activated") resolve();
        });
      });
    }

    return reg;
  } catch (err) {
    console.warn("SW registration failed:", err);
    // Not fatal — server-side rewriting still handles most things
  }
}

// Register on page load
window.addEventListener("DOMContentLoaded", () => {
  registerSW();
});
