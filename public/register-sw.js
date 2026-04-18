"use strict";

// Unregister ALL old service workers (especially Scramjet at root scope)
async function killOldServiceWorkers() {
  if (!("serviceWorker" in navigator)) return;
  const regs = await navigator.serviceWorker.getRegistrations();
  for (const reg of regs) {
    console.log("Unregistering old SW:", reg.scope);
    await reg.unregister();
  }
}

// Register our new minimal SW scoped to /proxy/ only
async function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("/sw.js", { scope: "/proxy/" });
  } catch (err) {
    console.warn("SW registration failed:", err);
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  await killOldServiceWorkers();
  await registerSW();
});
