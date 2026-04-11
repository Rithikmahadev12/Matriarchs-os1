"use strict";

// ══════════════════════════════════════
//  CLOCK  (both topbar + taskbar)
// ══════════════════════════════════════

function updateClock() {
  const now = new Date();
  const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const date = now.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });

  const topEl  = document.getElementById("clock");
  const taskEl = document.getElementById("taskbar-clock");

  if (topEl)  topEl.textContent  = time;
  if (taskEl) taskEl.textContent = date + "  " + time;
}

setInterval(updateClock, 1000);


// ══════════════════════════════════════
//  ONBOARDING
// ══════════════════════════════════════

function obContinue() {
  const input = document.getElementById("ob-name");
  const name  = input.value.trim();
  if (!name) {
    input.style.borderColor = "rgba(255,80,80,0.5)";
    input.focus();
    setTimeout(() => { input.style.borderColor = ""; }, 1200);
    return;
  }

  // Save name
  localStorage.setItem("mos_username", name);

  // Transition to step 2
  document.getElementById("ob-step-1").classList.add("hidden");
  const step2 = document.getElementById("ob-step-2");
  step2.classList.remove("hidden");

  document.getElementById("ob-greeting").innerHTML =
    "Hello, <span>" + name + "</span>";
}

function obFinish() {
  const ob = document.getElementById("onboarding");
  ob.classList.add("fade-out");
  setTimeout(() => {
    ob.classList.add("hidden");
    runBoot();
  }, 600);
}

// Press Enter in name field
window.addEventListener("DOMContentLoaded", () => {
  const nameInput = document.getElementById("ob-name");
  if (nameInput) {
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") obContinue();
    });
  }
});


// ══════════════════════════════════════
//  BOOT SEQUENCE
// ══════════════════════════════════════

const BOOT_MESSAGES = [
  { text: "Initializing Matriarchs OS kernel…",     ok: true  },
  { text: "Loading sovereign network stack…",        ok: false },
  { text: "Mounting encrypted filesystem…",          ok: true  },
  { text: "Starting Scramjet proxy engine…",         ok: true  },
  { text: "Establishing BareMux transport layer…",   ok: false },
  { text: "Calibrating Wisp relay endpoints…",       ok: true  },
  { text: "Loading desktop environment…",            ok: true  },
  { text: "System ready.",                           ok: true  },
];

function runBoot() {
  const logEl  = document.getElementById("boot-log");
  const barEl  = document.getElementById("boot-bar");
  const bootEl = document.getElementById("boot-screen");
  const deskEl = document.getElementById("desktop");

  let i = 0;

  function step() {
    if (i >= BOOT_MESSAGES.length) {
      barEl.style.width = "100%";
      setTimeout(() => {
        bootEl.classList.add("fade-out");
        deskEl.classList.remove("hidden");
        updateClock();
        applyUsername();
      }, 650);
      return;
    }

    const { text, ok } = BOOT_MESSAGES[i];
    const line = document.createElement("div");
    line.className = "log-line" + (ok ? " log-ok" : "");
    line.textContent = (ok ? "[ OK ] " : "[    ] ") + text;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;

    barEl.style.width = ((i + 1) / BOOT_MESSAGES.length * 100) + "%";
    i++;
    setTimeout(step, 240 + Math.random() * 180);
  }

  setTimeout(step, 800);
}


// ══════════════════════════════════════
//  USERNAME — apply to topbar + start menu
// ══════════════════════════════════════

function applyUsername() {
  const name = localStorage.getItem("mos_username") || "";
  const topEl = document.getElementById("topbar-user");
  const smEl  = document.getElementById("sm-username");

  if (topEl && name) topEl.textContent = name.toUpperCase();
  if (smEl)          smEl.textContent  = name || "User";
}


// ══════════════════════════════════════
//  INIT — check onboarding on load
// ══════════════════════════════════════

window.addEventListener("DOMContentLoaded", () => {
  const hasName = localStorage.getItem("mos_username");

  if (!hasName) {
    // Show onboarding, hide boot
    document.getElementById("boot-screen").style.display = "none";
    document.getElementById("onboarding").classList.remove("hidden");
  } else {
    // Skip onboarding, run boot directly
    document.getElementById("onboarding").classList.add("hidden");
    runBoot();
  }
});


// ══════════════════════════════════════
//  SCRAMJET INIT
// ══════════════════════════════════════

let scramjet  = null;
let connection = null;

window.addEventListener("DOMContentLoaded", () => {
  try {
    const { ScramjetController } = $scramjetLoadController();
    scramjet = new ScramjetController({
      files: {
        wasm: "/scram/scramjet.wasm.wasm",
        all:  "/scram/scramjet.all.js",
        sync: "/scram/scramjet.sync.js",
      },
    });
    scramjet.init();
    connection = new BareMux.BareMuxConnection("/baremux/worker.js");
  } catch (e) {
    console.warn("Scramjet init failed:", e);
  }
});


// ══════════════════════════════════════
//  WINDOW MANAGEMENT
// ══════════════════════════════════════

let zTop = 10;

// Registry of open windows for taskbar: { id, title, iconId }
const openWindows = {};

function bringToFront(id) {
  const w = document.getElementById(id);
  if (w) w.style.zIndex = ++zTop;
  refreshTaskbar();
}

function closeWindow(id) {
  const w = document.getElementById(id);
  if (!w) return;
  w.style.opacity   = "0";
  w.style.transform = "scale(0.9)";
  setTimeout(() => {
    w.remove();
    delete openWindows[id];
    refreshTaskbar();
  }, 200);
}

function minimizeWindow(id) {
  const w = document.getElementById(id);
  if (!w) return;
  w.classList.toggle("minimized");
  refreshTaskbar();
}

function maximizeWindow(id) {
  const w = document.getElementById(id);
  if (!w) return;

  if (w.dataset.maximized) {
    w.style.top    = w.dataset.origTop;
    w.style.left   = w.dataset.origLeft;
    w.style.width  = w.dataset.origW;
    w.style.height = w.dataset.origH;
    delete w.dataset.maximized;
  } else {
    w.dataset.origTop  = w.style.top    || w.offsetTop    + "px";
    w.dataset.origLeft = w.style.left   || w.offsetLeft   + "px";
    w.dataset.origW    = w.style.width  || w.offsetWidth  + "px";
    w.dataset.origH    = w.style.height || w.offsetHeight + "px";
    const tbH = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--taskbar-h")) || 44;
    w.style.top    = "32px";
    w.style.left   = "0";
    w.style.width  = "100vw";
    w.style.height = `calc(100vh - 32px - ${tbH}px)`;
    w.dataset.maximized = "1";
  }
}

function makeDraggable(win) {
  const bar = win.querySelector(".window-titlebar");
  if (!bar) return;

  let ox = 0, oy = 0, dragging = false;

  bar.addEventListener("mousedown", (e) => {
    if (e.target.classList.contains("wbtn")) return;
    if (win.dataset.maximized) return;
    dragging = true;
    ox = e.clientX - win.offsetLeft;
    oy = e.clientY - win.offsetTop;
    bringToFront(win.id);
    e.preventDefault();
  });

  document.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    win.style.left = (e.clientX - ox) + "px";
    win.style.top  = (e.clientY - oy) + "px";
  });

  document.addEventListener("mouseup", () => { dragging = false; });

  win.addEventListener("mousedown", () => bringToFront(win.id));
}


// ══════════════════════════════════════
//  TASKBAR
// ══════════════════════════════════════

function refreshTaskbar() {
  const container = document.getElementById("taskbar-apps");
  if (!container) return;
  container.innerHTML = "";

  for (const [id, info] of Object.entries(openWindows)) {
    const win        = document.getElementById(id);
    const isOpen     = !!win;
    const isMin      = win && win.classList.contains("minimized");
    const isFocused  = win && parseInt(win.style.zIndex || 0) === zTop;

    const btn = document.createElement("button");
    btn.className = "taskbar-btn open" + (isFocused && !isMin ? " active" : "");
    btn.title     = info.title;

    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24">
        <use href="#ico-${info.iconId}"/>
      </svg>
      <span>${info.title}</span>
    `;

    btn.addEventListener("click", () => {
      if (!isOpen) return;
      if (isMin) {
        win.classList.remove("minimized");
        bringToFront(id);
      } else if (isFocused) {
        win.classList.add("minimized");
      } else {
        bringToFront(id);
      }
      refreshTaskbar();
    });

    container.appendChild(btn);
  }
}


// ══════════════════════════════════════
//  START MENU
// ══════════════════════════════════════

let startMenuOpen = false;

function toggleStartMenu() {
  const menu  = document.getElementById("start-menu");
  const btn   = document.querySelector(".taskbar-start");
  startMenuOpen = !startMenuOpen;
  menu.classList.toggle("hidden", !startMenuOpen);
  if (btn) btn.classList.toggle("active", startMenuOpen);
}

// Close start menu when clicking outside
document.addEventListener("click", (e) => {
  if (!startMenuOpen) return;
  const menu = document.getElementById("start-menu");
  const btn  = document.querySelector(".taskbar-start");
  if (menu && !menu.contains(e.target) && btn && !btn.contains(e.target)) {
    startMenuOpen = false;
    menu.classList.add("hidden");
    btn.classList.remove("active");
  }
});


// ══════════════════════════════════════
//  BROWSER WINDOW
// ══════════════════════════════════════

function openBrowser() {
  const existing = document.getElementById("win-browser");
  if (existing) {
    existing.classList.remove("minimized");
    bringToFront("win-browser");
    return;
  }

  const tpl   = document.getElementById("browser-window-tpl");
  const clone = tpl.content.cloneNode(true);
  document.getElementById("windows").appendChild(clone);

  const win = document.getElementById("win-browser");
  makeDraggable(win);
  bringToFront("win-browser");

  // Register in taskbar
  openWindows["win-browser"] = { title: "Browser", iconId: "globe" };
  refreshTaskbar();

  const addrEl    = document.getElementById("sj-address");
  const engineEl  = document.getElementById("sj-search-engine");
  const errorEl   = document.getElementById("sj-error");
  const errCodeEl = document.getElementById("sj-error-code");
  const frameWrap = document.getElementById("sj-frame-wrap");
  const goBtn     = document.getElementById("sj-go");

  async function navigate() {
    errorEl.textContent   = "";
    errCodeEl.textContent = "";

    try {
      await registerSW();
    } catch (err) {
      errorEl.textContent   = "Failed to register service worker.";
      errCodeEl.textContent = err.toString();
      return;
    }

    const url     = search(addrEl.value, engineEl.value);
    const wispUrl = (location.protocol === "https:" ? "wss" : "ws") +
                    "://" + location.host + "/wisp/";

    if ((await connection.getTransport()) !== "/libcurl/index.mjs") {
      await connection.setTransport("/libcurl/index.mjs", [{ websocket: wispUrl }]);
    }

    frameWrap.innerHTML = "";
    const frame = scramjet.createFrame();
    frameWrap.appendChild(frame.frame);
    frame.go(url);
  }

  goBtn.addEventListener("click", navigate);
  addrEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") navigate();
  });
}


// ══════════════════════════════════════
//  ABOUT WINDOW
// ══════════════════════════════════════

function openAbout() {
  const existing = document.getElementById("win-about");
  if (existing) {
    existing.classList.remove("minimized");
    bringToFront("win-about");
    return;
  }

  const win = document.createElement("div");
  win.className = "window";
  win.id        = "win-about";

  win.innerHTML = `
    <div class="window-titlebar">
      <div class="window-controls">
        <button class="wbtn close" onclick="closeWindow('win-about')"></button>
        <button class="wbtn min"   onclick="minimizeWindow('win-about')"></button>
        <button class="wbtn max"   onclick="maximizeWindow('win-about')"></button>
      </div>
      <span class="window-title">ABOUT</span>
    </div>
    <div class="window-body">
      <div class="about-body">
        <div class="about-sigil">
          <svg width="40" height="40" viewBox="0 0 24 24">
            <use href="#ico-hex"/>
          </svg>
        </div>
        <div class="about-name">MATRIARCHS OS</div>
        <div class="about-sub">SOVEREIGN EDITION — v1.0.0</div>
        <div class="about-divider"></div>
        <div class="about-info">
          Scramjet + BareMux<br>
          Mercury Workshop
        </div>
      </div>
    </div>
  `;

  document.getElementById("windows").appendChild(win);
  makeDraggable(win);
  bringToFront("win-about");

  // Register in taskbar
  openWindows["win-about"] = { title: "About", iconId: "hex" };
  refreshTaskbar();
}
