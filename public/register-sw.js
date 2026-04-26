"use strict";

// ══════════════════════════════════════
//  MATRIARCHS OS — Scramjet Loader
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

async function setWispTransport(wispUrl) {
  // Dump every key so we can see exactly what bare-mux v2 exports
  const bm = window.BareMux;
  console.log("[MOS] BareMux typeof:", typeof bm);
  if (bm && typeof bm === "object") {
    console.log("[MOS] BareMux keys:", JSON.stringify(Object.keys(bm)));
    for (const k of Object.keys(bm)) {
      console.log(`[MOS]   .${k} typeof:`, typeof bm[k]);
    }
  }

  const transport = "/wisp-js/wisp-client.js";
  const opts      = [{ wisp: wispUrl }];

  // ── Shape 1: flat window.setTransport ────────────────────────────────────
  if (typeof window.setTransport === "function") {
    await window.setTransport(transport, opts);
    console.log("[MOS] ✓ window.setTransport"); return;
  }

  if (!bm) { console.error("[MOS] BareMux not on window"); return; }

  // ── Shape 2: BareMux.setTransport static ─────────────────────────────────
  if (typeof bm.setTransport === "function") {
    await bm.setTransport(transport, opts);
    console.log("[MOS] ✓ BareMux.setTransport"); return;
  }

  // ── Shape 3: new BareMux.BareMuxConnection ────────────────────────────────
  if (typeof bm.BareMuxConnection === "function") {
    const c = new bm.BareMuxConnection("/baremux/worker.js");
    console.log("[MOS] BareMuxConnection instance keys:", JSON.stringify(Object.keys(c)));
    if (typeof c.setTransport === "function") { await c.setTransport(transport, opts); console.log("[MOS] ✓ BareMuxConnection.setTransport"); return; }
    if (typeof c.setClient   === "function") { await c.setClient(transport, opts);    console.log("[MOS] ✓ BareMuxConnection.setClient");    return; }
  }

  // ── Shape 4: BareMux itself is a class ───────────────────────────────────
  if (typeof bm === "function") {
    const c = new bm("/baremux/worker.js");
    if (typeof c.setTransport === "function") { await c.setTransport(transport, opts); console.log("[MOS] ✓ new BareMux().setTransport"); return; }
  }

  // ── Shape 5: BareMux.default ─────────────────────────────────────────────
  if (typeof bm.default === "function") {
    const c = new bm.default("/baremux/worker.js");
    if (typeof c.setTransport === "function") { await c.setTransport(transport, opts); console.log("[MOS] ✓ new BareMux.default().setTransport"); return; }
  }

  // ── Shape 6: any key whose value is a function (scan all) ────────────────
  for (const k of Object.keys(bm)) {
    if (typeof bm[k] === "function") {
      try {
        const c = new bm[k]("/baremux/worker.js");
        if (typeof c.setTransport === "function") {
          await c.setTransport(transport, opts);
          console.log(`[MOS] ✓ new BareMux.${k}().setTransport`); return;
        }
        if (typeof c.setClient === "function") {
          await c.setClient(transport, opts);
          console.log(`[MOS] ✓ new BareMux.${k}().setClient`); return;
        }
      } catch(e) {
        console.log(`[MOS]   BareMux.${k} as constructor failed:`, e.message);
        // Maybe it's a plain function not a constructor
        try {
          const result = bm[k]("/baremux/worker.js");
          if (result && typeof result.setTransport === "function") {
            await result.setTransport(transport, opts);
            console.log(`[MOS] ✓ BareMux.${k}() (function).setTransport`); return;
          }
        } catch(e2) {
          console.log(`[MOS]   BareMux.${k} as function also failed:`, e2.message);
        }
      }
    }
  }

  console.error("[MOS] ✗ No bare-mux API worked. Falling back to server proxy.");
}

async function initScramjet() {
  if (!("serviceWorker" in navigator)) {
    console.warn("[MOS] No SW support"); return;
  }

  // Remove stale SWs
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    for (const reg of regs) {
      if (!(reg.scriptURL||"").includes("scramjet-sw")) {
        console.log("[MOS] Removing stale SW:", reg.scope);
        await reg.unregister();
      }
    }
  } catch(e) { console.warn("[MOS] SW cleanup:", e.message); }

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

  // Set transport
  try {
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    await setWispTransport(`${protocol}://${location.host}/wisp/`);
  } catch(err) {
    console.error("[MOS] Transport setup failed:", err.message, err.stack);
  }

  window.__scramjetReady = true;
  console.log("[MOS] Init complete ✦");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initScramjet);
} else {
  initScramjet();
}
