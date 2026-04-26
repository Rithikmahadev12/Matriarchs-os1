"use strict";

// ══════════════════════════════════════
//  MATRIARCHS OS — Scramjet Loader
//  bare-mux v2.1.7 + libcurl-transport v1.5.2
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
    console.warn("[MOS] No SW support — server proxy only");
    return;
  }

  // ── 1. Remove stale service workers ──────────────────────────────────────
  try {
    for (const reg of await navigator.serviceWorker.getRegistrations()) {
      if (!(reg.scriptURL || "").includes("scramjet-sw")) {
        await reg.unregister();
        console.log("[MOS] Removed stale SW:", reg.scope);
      }
    }
  } catch (e) {
    console.warn("[MOS] SW cleanup error:", e.message);
  }

  // ── 2. Register scramjet SW ───────────────────────────────────────────────
  try {
    await navigator.serviceWorker.register("/scramjet-sw.js", { scope: "/" });
    console.log("[MOS] SW registered");
  } catch (err) {
    console.warn("[MOS] SW registration failed:", err.message);
    return;
  }

  await navigator.serviceWorker.ready;
  console.log("[MOS] SW ready");

  // ── 3. Load bare-mux (sets window.BareMux) ───────────────────────────────
  await loadScript("/baremux/index.js");

  if (!window.BareMux) {
    console.error("[MOS] BareMux not found — server proxy fallback only");
    return;
  }

  // ── 4. Set transport ──────────────────────────────────────────────────────
  // bare-mux v2 setTransport(moduleUrl, constructorArgs[]):
  //   moduleUrl       → ES module with `export default` BareTransport class
  //   constructorArgs → spread as: new BareTransport(...constructorArgs)
  //
  // LibcurlClient constructor: new LibcurlClient({ wisp: "wss://host/wisp/" })
  // Server serves @mercuryworkshop/libcurl-transport/dist/ at /libcurl/

  const protocol  = location.protocol === "https:" ? "wss" : "ws";
  const wispUrl   = `${protocol}://${location.host}/wisp/`;

  // Prefer .mjs (true ES module) for dynamic import() compatibility
  const candidates = ["/libcurl/index.mjs", "/libcurl/index.js"];
  let transportUrl = null;

  for (const path of candidates) {
    try {
      const r = await fetch(path, { method: "HEAD" });
      if (r.ok) { transportUrl = new URL(path, location.origin).toString(); break; }
    } catch {}
  }

  if (!transportUrl) {
    console.error("[MOS] No transport module found at /libcurl/ — server proxy fallback");
    return;
  }

  console.log("[MOS] Transport module:", transportUrl, "→ wisp:", wispUrl);

  try {
    // BareMuxConnection(workerPath): must point to bare-mux's own worker.js
    const conn = new BareMux.BareMuxConnection("/baremux/worker.js");

    // setTransport dynamically imports the module URL inside the worker,
    // then calls: new DefaultExport(...constructorArgs)
    // LibcurlClient takes one options object as its sole argument.
    await conn.setTransport(transportUrl, [{ wisp: wispUrl }]);

    console.log("[MOS] ✓ Transport ready");
    window.__scramjetReady = true;
  } catch (err) {
    console.error("[MOS] Transport setup error:", err.message);
  }

  console.log("[MOS] Init complete ✦  scramjetReady =", window.__scramjetReady);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initScramjet);
} else {
  initScramjet();
}
