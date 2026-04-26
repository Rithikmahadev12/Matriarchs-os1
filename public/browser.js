// ══════════════════════════════════════
//  BROWSER WINDOW — Scramjet edition
//  Drop this in to REPLACE the openBrowser() function and everything below
//  it in public/index.js (from "BROWSER WINDOW" section onward).
//
//  Key change: instead of /proxy/?url=<target> we use Scramjet's URL encoding:
//    /scramjet/<scramjet-encoded-url>
//  Scramjet's SW intercepts that and does the actual proxying via Wisp.
// ══════════════════════════════════════

// ── Scramjet URL helpers ──────────────────────────────────────────────────────
// These mirror what Scramjet's client runtime exposes after the SW loads.
// We call them directly so the browser window doesn't need to wait.

function scramjetEncode(url) {
  // If Scramjet's controller is ready, use it
  if (window.__scramjet && window.__scramjet.encodeUrl) {
    return window.__scramjet.encodeUrl(url);
  }
  // Fallback: Scramjet's default codec is plain base64 with prefix
  // /scramjet/<base64url>/
  try {
    return "/scramjet/" + btoa(url).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "") + "/";
  } catch {
    return "/scramjet/" + encodeURIComponent(url);
  }
}

function proxyUrl(rawUrl) {
  if (!rawUrl) return rawUrl;
  let url = rawUrl.trim();
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = url.includes(" ") || !url.includes(".") ? getSearchUrl(url) : "https://" + url;
  }
  return scramjetEncode(url);
}

// ── Search engines ────────────────────────────────────────────────────────────

const SEARCH_ENGINES = {
  brave:     { label: "Brave",      url: "https://search.brave.com/search?q=%s" },
  ddg:       { label: "DuckDuckGo", url: "https://duckduckgo.com/?q=%s" },
  google:    { label: "Google",     url: "https://www.google.com/search?q=%s" },
  bing:      { label: "Bing",       url: "https://www.bing.com/search?q=%s" },
  startpage: { label: "Startpage",  url: "https://www.startpage.com/search?q=%s" },
};

let currentEngine = localStorage.getItem("mos_engine") || "brave";

function getSearchUrl(q) {
  const e = SEARCH_ENGINES[currentEngine] || SEARCH_ENGINES.brave;
  return e.url.replace("%s", encodeURIComponent(q));
}

// ── openBrowser ───────────────────────────────────────────────────────────────

function openBrowser(initialUrl) {
  const existing = document.getElementById("win-browser");
  if (existing) {
    existing.classList.remove("minimized");
    bringToFront("win-browser");
    if (initialUrl) browserNavigate(initialUrl);
    return;
  }

  const tpl   = document.getElementById("browser-window-tpl");
  const clone = tpl.content.cloneNode(true);
  document.getElementById("windows").appendChild(clone);

  const win = document.getElementById("win-browser");
  makeDraggable(win);
  bringToFront("win-browser");
  openWindows["win-browser"] = { title: "Browser", iconId: "globe" };
  refreshTaskbar();

  const addrEl    = document.getElementById("sj-address");
  const frameWrap = document.getElementById("sj-frame-wrap");
  const goBtn     = document.getElementById("sj-go");

  // ── Search engine picker ──────────────────────────────────────────────────
  const browserBar = win.querySelector(".browser-bar");
  if (browserBar) {
    const picker = document.createElement("div");
    picker.style.cssText = "position:relative;display:flex;align-items:center;flex-shrink:0";
    const btn = document.createElement("button");
    btn.id = "sj-engine-btn";
    btn.style.cssText =
      "background:rgba(122,158,126,0.1);border:1px solid rgba(122,158,126,0.25);" +
      "color:var(--text-mid);font-family:var(--mono);font-size:10px;padding:4px 8px;" +
      "border-radius:4px;cursor:pointer;white-space:nowrap;letter-spacing:0.04em;height:28px;";
    btn.textContent = SEARCH_ENGINES[currentEngine]?.label || "Brave";

    const drop = document.createElement("div");
    drop.style.cssText =
      "display:none;position:absolute;top:calc(100% + 6px);left:0;" +
      "background:#0d1a10;border:1px solid rgba(122,158,126,0.25);border-radius:6px;" +
      "overflow:hidden;z-index:9999;min-width:130px;box-shadow:0 8px 24px rgba(0,0,0,0.6);";

    Object.entries(SEARCH_ENGINES).forEach(([key, eng]) => {
      const item = document.createElement("div");
      item.style.cssText =
        "padding:8px 14px;font-family:var(--mono);font-size:11px;" +
        "color:" + (key === currentEngine ? "var(--gold)" : "var(--text-dim)") + ";" +
        "cursor:pointer;border-bottom:1px solid rgba(122,158,126,0.08);transition:background 0.1s;";
      item.textContent = eng.label;
      item.onmouseenter = () => { item.style.background = "rgba(122,158,126,0.08)"; };
      item.onmouseleave = () => { item.style.background = ""; };
      item.onclick = (e) => {
        e.stopPropagation();
        currentEngine = key;
        localStorage.setItem("mos_engine", key);
        btn.textContent = eng.label;
        drop.querySelectorAll("div").forEach(d => { d.style.color = "var(--text-dim)"; });
        item.style.color = "var(--gold)";
        drop.style.display = "none";
      };
      drop.appendChild(item);
    });

    btn.onclick = (e) => {
      e.stopPropagation();
      drop.style.display = drop.style.display === "none" ? "block" : "none";
    };
    document.addEventListener("click", () => { drop.style.display = "none"; });
    picker.appendChild(btn);
    picker.appendChild(drop);
    const addr = browserBar.querySelector("#sj-address");
    if (addr) browserBar.insertBefore(picker, addr);
  }

  // ── Navigation state ──────────────────────────────────────────────────────
  let navHistory = [];    // stores *real* URLs (not encoded)
  let navIdx = -1;

  function createIframe(proxied) {
    frameWrap.innerHTML = "";
    const iframe = document.createElement("iframe");
    iframe.style.cssText = "width:100%;height:100%;border:none;background:#fff;display:block;";
    iframe.setAttribute("sandbox",
      "allow-scripts allow-same-origin allow-forms allow-popups " +
      "allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation " +
      "allow-downloads allow-modals allow-pointer-lock");
    iframe.setAttribute("allow", "autoplay; fullscreen; encrypted-media; pointer-lock");
    frameWrap.appendChild(iframe);
    iframe.src = proxied;
    return iframe;
  }

  function navigate(rawUrl) {
    if (!rawUrl || !rawUrl.trim()) return;
    let url = rawUrl.trim();
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      url = url.includes(" ") || !url.includes(".") ? getSearchUrl(url) : "https://" + url;
    }

    addrEl.value = url;

    // Use Scramjet if SW is controlling, otherwise fall back to legacy proxy
    const useSJ = navigator.serviceWorker?.controller?.scriptURL?.includes("scramjet");
    const proxied = useSJ ? scramjetEncode(url) : "/proxy/fetch?url=" + encodeURIComponent(url);

    createIframe(proxied);

    navHistory = navHistory.slice(0, navIdx + 1);
    navHistory.push(url);
    navIdx = navHistory.length - 1;
    updateNavBtns();
  }

  win._navigate = navigate;

  function updateNavBtns() {
    const b = document.getElementById("sj-back");
    const f = document.getElementById("sj-fwd");
    if (b) b.disabled = navIdx <= 0;
    if (f) f.disabled = navIdx >= navHistory.length - 1;
  }

  function navTo(idx) {
    navIdx = idx;
    const url = navHistory[navIdx];
    addrEl.value = url;
    const useSJ = navigator.serviceWorker?.controller?.scriptURL?.includes("scramjet");
    const proxied = useSJ ? scramjetEncode(url) : "/proxy/fetch?url=" + encodeURIComponent(url);
    createIframe(proxied);
    updateNavBtns();
  }

  goBtn.addEventListener("click", () => { if (addrEl.value.trim()) navigate(addrEl.value.trim()); });
  addrEl.addEventListener("keydown", (e) => { if (e.key === "Enter" && addrEl.value.trim()) navigate(addrEl.value.trim()); });
  addrEl.addEventListener("focus", () => addrEl.select());

  document.getElementById("sj-back")?.addEventListener("click",   () => { if (navIdx > 0) navTo(navIdx - 1); });
  document.getElementById("sj-fwd")?.addEventListener("click",    () => { if (navIdx < navHistory.length - 1) navTo(navIdx + 1); });
  document.getElementById("sj-reload")?.addEventListener("click", () => {
    const iframe = frameWrap.querySelector("iframe");
    if (!iframe) return;
    const src = iframe.src;
    frameWrap.innerHTML = "";
    const ni = document.createElement("iframe");
    ni.style.cssText = "width:100%;height:100%;border:none;background:#fff;display:block;";
    ni.setAttribute("sandbox",
      "allow-scripts allow-same-origin allow-forms allow-popups " +
      "allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation " +
      "allow-downloads allow-modals allow-pointer-lock");
    ni.setAttribute("allow", "autoplay; fullscreen; encrypted-media; pointer-lock");
    frameWrap.appendChild(ni);
    ni.src = src;
  });

  // Listen for address-bar updates from Scramjet SPA navigation
  window.addEventListener("message", (e) => {
    if (e.data?.type === "mos-nav" && e.data.url) {
      addrEl.value = e.data.url;
    }
    // Scramjet also sends __scramjet$navigate
    if (e.data?.type === "__scramjet$navigate" && e.data.url) {
      try {
        // Decode Scramjet URL back to real URL
        let realUrl = e.data.url;
        if (window.__scramjet?.decodeUrl) realUrl = window.__scramjet.decodeUrl(e.data.url);
        addrEl.value = realUrl;
      } catch {}
    }
  });

  updateNavBtns();
  if (initialUrl) navigate(initialUrl);
}

function browserNavigate(url) {
  const win = document.getElementById("win-browser");
  if (win && win._navigate) win._navigate(url);
  else openBrowser(url);
}
