"use strict";

const stockSW = "./sw.js";

/**
 * List of hostnames that are allowed to run serviceworkers on http://
 */
const swAllowedHostnames = ["localhost", "127.0.0.1"];

/**
 * Global util
 * Used in 404.html and index.html
 *
 * FIX: Register with an explicit scope instead of defaulting to root ("/").
 * School Chrome policies often block root-scope SW registration.
 * Scoping to a subdirectory bypasses this restriction, matching what
 * working proxy sites (Ultraviolet, etc.) do.
 */
async function registerSW() {
  if (!navigator.serviceWorker) {
    if (
      location.protocol !== "https:" &&
      !swAllowedHostnames.includes(location.hostname)
    )
      throw new Error("Service workers cannot be registered without https.");
    throw new Error("Your browser doesn't support service workers.");
  }

  try {
    // Try scoped registration first — works on most restricted school accounts
    await navigator.serviceWorker.register(stockSW, { scope: "./" });
  } catch (scopedErr) {
    try {
      // Fallback: try root scope
      await navigator.serviceWorker.register(stockSW);
    } catch (rootErr) {
      // Last resort: try registering from an explicit path
      await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    }
  }
}
