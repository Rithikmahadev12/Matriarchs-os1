"use strict";

// ══════════════════════════════════════
//  CONSTANTS
// ══════════════════════════════════════

const OWNER_USERNAME = "Jay";
const OWNER_PASSWORD = "messi2be";
const USERS_KEY      = "mos_users";
const SESSION_KEY    = "mos_session";
const KICKED_KEY     = "mos_kicked";


// ══════════════════════════════════════
//  CLOCK
// ══════════════════════════════════════

function updateClock() {
  const now  = new Date();
  const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const date = now.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });

  const topEl  = document.getElementById("clock");
  const taskEl = document.getElementById("taskbar-clock");

  if (topEl)  topEl.textContent  = time;
  if (taskEl) taskEl.textContent = date + "  " + time;
}

setInterval(updateClock, 1000);


// ══════════════════════════════════════
//  USER STORAGE HELPERS
// ══════════════════════════════════════

function getUsers() {
  try { return JSON.parse(localStorage.getItem(USERS_KEY)) || []; }
  catch { return []; }
}

function saveUsers(users) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function getSession() {
  return localStorage.getItem(SESSION_KEY) || null;
}

function setSession(username) {
  localStorage.setItem(SESSION_KEY, username);
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

function isOwner(username) {
  return username === OWNER_USERNAME;
}

function findUser(username) {
  return getUsers().find(u => u.username.toLowerCase() === username.toLowerCase());
}

function isUserBanned(username) {
  const u = findUser(username);
  return u ? !!u.banned : false;
}

function isUserKicked(username) {
  try {
    const kicked = JSON.parse(localStorage.getItem(KICKED_KEY)) || [];
    return kicked.includes(username);
  } catch { return false; }
}

function markKicked(username) {
  try {
    const kicked = JSON.parse(localStorage.getItem(KICKED_KEY)) || [];
    if (!kicked.includes(username)) kicked.push(username);
    localStorage.setItem(KICKED_KEY, JSON.stringify(kicked));
  } catch {}
}

function clearKicked(username) {
  try {
    let kicked = JSON.parse(localStorage.getItem(KICKED_KEY)) || [];
    kicked = kicked.filter(u => u !== username);
    localStorage.setItem(KICKED_KEY, JSON.stringify(kicked));
  } catch {}
}


// ══════════════════════════════════════
//  AUTH SCREEN
// ══════════════════════════════════════

function switchAuthTab(tab) {
  const loginForm  = document.getElementById("auth-login-form");
  const signupForm = document.getElementById("auth-signup-form");
  const tabLogin   = document.getElementById("tab-login");
  const tabSignup  = document.getElementById("tab-signup");

  if (tab === "login") {
    loginForm.style.display  = "flex";
    signupForm.style.display = "none";
    tabLogin.classList.add("active");
    tabSignup.classList.remove("active");
    clearMsg("login-msg");
  } else {
    loginForm.style.display  = "none";
    signupForm.style.display = "flex";
    tabLogin.classList.remove("active");
    tabSignup.classList.add("active");
    clearMsg("signup-msg");
  }
}

function setMsg(id, text, isError = true) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className   = "auth-msg " + (isError ? "error" : "ok");
}

function clearMsg(id) {
  const el = document.getElementById(id);
  if (el) { el.textContent = ""; el.className = "auth-msg"; }
}

function shakeInput(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add("error");
  setTimeout(() => el.classList.remove("error"), 600);
}

function doLogin() {
  const username = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-password").value;

  if (!username) { shakeInput("login-username"); setMsg("login-msg", "Enter your username."); return; }
  if (!password) { shakeInput("login-password"); setMsg("login-msg", "Enter your password."); return; }

  // Owner login
  if (username === OWNER_USERNAME) {
    if (password !== OWNER_PASSWORD) {
      shakeInput("login-password");
      setMsg("login-msg", "Invalid credentials.");
      return;
    }
    clearKicked(OWNER_USERNAME);
    setSession(OWNER_USERNAME);
    proceedAfterAuth(OWNER_USERNAME);
    return;
  }

  // Regular user
  const user = findUser(username);
  if (!user) { shakeInput("login-username"); setMsg("login-msg", "Account not found. Create one?"); return; }
  if (user.password !== password) { shakeInput("login-password"); setMsg("login-msg", "Wrong password."); return; }
  if (user.banned) { setMsg("login-msg", "This account has been banned."); return; }

  clearKicked(username);
  setSession(username);
  proceedAfterAuth(username);
}

function doSignup() {
  const username = document.getElementById("signup-username").value.trim();
  const password = document.getElementById("signup-password").value;
  const confirm  = document.getElementById("signup-confirm").value;

  if (!username) { shakeInput("signup-username"); setMsg("signup-msg", "Choose a username."); return; }
  if (username.length < 2) { shakeInput("signup-username"); setMsg("signup-msg", "Username must be at least 2 characters."); return; }
  if (/[^a-zA-Z0-9_\-]/.test(username)) { shakeInput("signup-username"); setMsg("signup-msg", "Letters, numbers, _ and - only."); return; }
  if (username === OWNER_USERNAME) { shakeInput("signup-username"); setMsg("signup-msg", "That username is reserved."); return; }
  if (!password) { shakeInput("signup-password"); setMsg("signup-msg", "Choose a password."); return; }
  if (password.length < 4) { shakeInput("signup-password"); setMsg("signup-msg", "Password must be at least 4 characters."); return; }
  if (password !== confirm) { shakeInput("signup-confirm"); setMsg("signup-msg", "Passwords don't match."); return; }

  const users = getUsers();
  if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
    shakeInput("signup-username");
    setMsg("signup-msg", "Username already taken.");
    return;
  }

  users.push({ username, password, banned: false, createdAt: Date.now() });
  saveUsers(users);
  setSession(username);
  setMsg("signup-msg", "Account created!", false);
  setTimeout(() => proceedAfterAuth(username), 600);
}

function doGuest() {
  const guest = "Guest_" + Math.floor(Math.random() * 9000 + 1000);
  setSession(guest);
  proceedAfterAuth(guest);
}

function doLogout() {
  clearSession();
  location.reload();
}

function proceedAfterAuth(username) {
  const auth = document.getElementById("auth-screen");
  auth.classList.add("hidden");

  const visitKey   = "mos_visited_" + username;
  const hasVisited = localStorage.getItem(visitKey);

  if (!hasVisited) {
    localStorage.setItem(visitKey, "1");
    showOnboarding(username);
  } else {
    runBoot();
  }
}


// ══════════════════════════════════════
//  ONBOARDING
// ══════════════════════════════════════

function showOnboarding(username) {
  const ob = document.getElementById("onboarding");
  ob.classList.remove("hidden");

  const greeting = document.getElementById("ob-greeting");
  if (greeting) {
    greeting.innerHTML = "Welcome, <span>" + username + "</span>";
  }

  document.getElementById("ob-step-1").classList.add("hidden");
  const step2 = document.getElementById("ob-step-2");
  step2.classList.remove("hidden");
}

function obFinish() {
  const ob = document.getElementById("onboarding");
  ob.classList.add("fade-out");
  setTimeout(() => {
    ob.classList.add("hidden");
    runBoot();
  }, 600);
}


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
  const bootEl = document.getElementById("boot-screen");
  const logEl  = document.getElementById("boot-log");
  const barEl  = document.getElementById("boot-bar");
  const deskEl = document.getElementById("desktop");

  bootEl.style.display = "flex";
  bootEl.style.opacity = "1";
  bootEl.classList.remove("fade-out");
  logEl.innerHTML = "";

  let i = 0;

  function step() {
    if (i >= BOOT_MESSAGES.length) {
      barEl.style.width = "100%";
      setTimeout(() => {
        bootEl.classList.add("fade-out");
        // After CSS transition finishes, fully hide the boot screen
        setTimeout(() => {
          bootEl.style.display = "none";
        }, 850);
        deskEl.classList.remove("hidden");
        updateClock();
        applyDesktopUI();
      }, 650);
      return;
    }

    const { text, ok } = BOOT_MESSAGES[i];
    const line = document.createElement("div");
    line.className   = "log-line" + (ok ? " log-ok" : "");
    line.textContent = (ok ? "[ OK ] " : "[    ] ") + text;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;

    barEl.style.width = ((i + 1) / BOOT_MESSAGES.length * 100) + "%";
    i++;
    setTimeout(step, 240 + Math.random() * 180);
  }

  setTimeout(step, 600);
}


// ══════════════════════════════════════
//  DESKTOP UI
// ══════════════════════════════════════

function applyDesktopUI() {
  const username = getSession() || "Guest";
  const owner    = isOwner(username);

  const topEl = document.getElementById("topbar-user");
  if (topEl) {
    topEl.textContent = username.toUpperCase();
    if (owner) topEl.classList.add("is-owner");
  }

  const smEl = document.getElementById("sm-username");
  if (smEl) {
    smEl.textContent = username;
    if (owner) smEl.classList.add("is-owner");
  }

  if (owner) {
    injectOwnerUI();
  }
}

function injectOwnerUI() {
  const topbarLeft = document.querySelector(".topbar-left");
  if (topbarLeft && !document.getElementById("topbar-admin-btn")) {
    const adminMenu = document.createElement("span");
    adminMenu.className   = "bar-menu owner-menu";
    adminMenu.id          = "topbar-admin-btn";
    adminMenu.textContent = "⬡ Admin";
    adminMenu.onclick     = () => openAdmin();
    topbarLeft.appendChild(adminMenu);
  }

  const desktopIcons = document.getElementById("desktop-icons");
  if (desktopIcons && !document.getElementById("icon-admin")) {
    const adminIcon = document.createElement("div");
    adminIcon.className = "desktop-icon owner-icon";
    adminIcon.id        = "icon-admin";
    adminIcon.onclick   = openAdmin;
    adminIcon.innerHTML = `
      <div class="icon-img">
        <svg width="32" height="32" viewBox="0 0 24 24"><use href="#ico-shield"/></svg>
      </div>
      <span>Admin</span>
    `;
    desktopIcons.appendChild(adminIcon);
  }

  const smGrid = document.getElementById("sm-grid");
  if (smGrid && !document.getElementById("sm-admin-app")) {
    const adminApp = document.createElement("div");
    adminApp.className = "sm-app owner-app";
    adminApp.id        = "sm-admin-app";
    adminApp.onclick   = () => { openAdmin(); toggleStartMenu(); };
    adminApp.innerHTML = `
      <div class="sm-app-icon">
        <svg width="20" height="20" viewBox="0 0 24 24"><use href="#ico-shield"/></svg>
      </div>
      <span>Admin Panel</span>
    `;
    smGrid.appendChild(adminApp);
  }
}


// ══════════════════════════════════════
//  ADMIN PANEL
// ══════════════════════════════════════

function openAdmin() {
  const existing = document.getElementById("win-admin");
  if (existing) {
    existing.classList.remove("minimized");
    bringToFront("win-admin");
    return;
  }

  const win = document.createElement("div");
  win.className = "window";
  win.id        = "win-admin";

  win.innerHTML = `
    <div class="window-titlebar">
      <div class="window-controls">
        <button class="wbtn close" onclick="closeWindow('win-admin')"></button>
        <button class="wbtn min"   onclick="minimizeWindow('win-admin')"></button>
        <button class="wbtn max"   onclick="maximizeWindow('win-admin')"></button>
      </div>
      <span class="window-title">ADMIN PANEL</span>
    </div>
    <div class="window-body">
      <div class="admin-body">
        <div class="admin-header">
          <div class="admin-title">⬡ OWNER CONTROL PANEL</div>
          <div class="admin-sub">Logged in as Jay — Sovereign Access</div>
        </div>
        <div class="admin-stats" id="admin-stats"></div>
        <div class="admin-section-title">Registered Users</div>
        <div class="admin-users-list" id="admin-users-list"></div>
      </div>
    </div>
  `;

  document.getElementById("windows").appendChild(win);
  makeDraggable(win);
  bringToFront("win-admin");

  openWindows["win-admin"] = { title: "Admin", iconId: "shield" };
  refreshTaskbar();
  renderAdminPanel();
}

function renderAdminPanel() {
  const users   = getUsers();
  const statsEl = document.getElementById("admin-stats");
  const listEl  = document.getElementById("admin-users-list");
  if (!statsEl || !listEl) return;

  const total  = users.length;
  const banned = users.filter(u => u.banned).length;
  const active = total - banned;

  statsEl.innerHTML = `
    <div class="admin-stat">
      <div class="admin-stat-num">${total}</div>
      <div class="admin-stat-label">TOTAL USERS</div>
    </div>
    <div class="admin-stat">
      <div class="admin-stat-num">${active}</div>
      <div class="admin-stat-label">ACTIVE</div>
    </div>
    <div class="admin-stat">
      <div class="admin-stat-num">${banned}</div>
      <div class="admin-stat-label">BANNED</div>
    </div>
  `;

  if (users.length === 0) {
    listEl.innerHTML = `<div class="admin-empty">No registered accounts yet.</div>`;
    return;
  }

  listEl.innerHTML = users.map((user) => {
    const initials    = user.username.slice(0, 2).toUpperCase();
    const isBanned    = user.banned;
    const statusText  = isBanned ? "Banned" : "Active";
    const statusClass = isBanned ? "banned" : "online";

    return `
      <div class="admin-user-row">
        <div class="admin-user-avatar">${initials}</div>
        <div class="admin-user-info">
          <div class="admin-user-name">${escHtml(user.username)}</div>
          <div class="admin-user-status ${statusClass}">${statusText}</div>
        </div>
        <div class="admin-actions">
          ${isBanned
            ? `<button class="admin-action-btn unban-btn" onclick="adminUnban('${escHtml(user.username)}')">UNBAN</button>`
            : `<button class="admin-action-btn ban-btn"   onclick="adminBan('${escHtml(user.username)}')">BAN</button>`
          }
          <button class="admin-action-btn kick-btn" onclick="adminKick('${escHtml(user.username)}')"${isBanned ? " disabled" : ""}>KICK</button>
        </div>
      </div>
    `;
  }).join("");
}

function adminBan(username) {
  const users = getUsers();
  const user  = users.find(u => u.username === username);
  if (!user) return;
  user.banned = true;
  saveUsers(users);
  showToast(`${username} has been banned.`);
  renderAdminPanel();
}

function adminUnban(username) {
  const users = getUsers();
  const user  = users.find(u => u.username === username);
  if (!user) return;
  user.banned = false;
  saveUsers(users);
  showToast(`${username} has been unbanned.`);
  renderAdminPanel();
}

function adminKick(username) {
  markKicked(username);
  showToast(`${username} has been kicked. They'll be forced out on next session check.`);
  renderAdminPanel();
}

function escHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function showToast(msg) {
  const toast = document.createElement("div");
  toast.className   = "kick-toast";
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("fade-out");
    setTimeout(() => toast.remove(), 350);
  }, 2800);
}


// ══════════════════════════════════════
//  INIT
// ══════════════════════════════════════

window.addEventListener("DOMContentLoaded", () => {
  const session = getSession();

  if (session && isUserKicked(session)) {
    clearSession();
    location.reload();
    return;
  }

  if (session && session !== OWNER_USERNAME && isUserBanned(session)) {
    clearSession();
    location.reload();
    return;
  }

  if (session) {
    const visitKey   = "mos_visited_" + session;
    const hasVisited = localStorage.getItem(visitKey);
    if (!hasVisited) {
      localStorage.setItem(visitKey, "1");
      document.getElementById("auth-screen").classList.add("hidden");
      showOnboarding(session);
    } else {
      document.getElementById("auth-screen").classList.add("hidden");
      runBoot();
    }
  }

  document.getElementById("login-password")?.addEventListener("keydown", e => {
    if (e.key === "Enter") doLogin();
  });
  document.getElementById("login-username")?.addEventListener("keydown", e => {
    if (e.key === "Enter") doLogin();
  });
  document.getElementById("signup-confirm")?.addEventListener("keydown", e => {
    if (e.key === "Enter") doSignup();
  });
});


// ══════════════════════════════════════
//  SCRAMJET INIT
// ══════════════════════════════════════

let scramjet   = null;
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
    const win       = document.getElementById(id);
    const isOpen    = !!win;
    const isMin     = win && win.classList.contains("minimized");
    const isFocused = win && parseInt(win.style.zIndex || 0) === zTop;

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
  const menu = document.getElementById("start-menu");
  const btn  = document.querySelector(".taskbar-start");
  startMenuOpen = !startMenuOpen;
  menu.classList.toggle("hidden", !startMenuOpen);
  if (btn) btn.classList.toggle("active", startMenuOpen);
}

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

  openWindows["win-about"] = { title: "About", iconId: "hex" };
  refreshTaskbar();
}
