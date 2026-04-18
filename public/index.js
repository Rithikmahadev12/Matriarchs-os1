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
function saveUsers(u) { localStorage.setItem(USERS_KEY, JSON.stringify(u)); }
function getSession() { return localStorage.getItem(SESSION_KEY) || null; }
function setSession(u) { localStorage.setItem(SESSION_KEY, u); }
function clearSession() { localStorage.removeItem(SESSION_KEY); }
function isOwner(u) { return u === OWNER_USERNAME; }
function findUser(u) { return getUsers().find(x => x.username.toLowerCase() === u.toLowerCase()); }
function isUserBanned(u) { const x = findUser(u); return x ? !!x.banned : false; }
function isUserKicked(u) {
  try { return (JSON.parse(localStorage.getItem(KICKED_KEY)) || []).includes(u); } catch { return false; }
}
function markKicked(u) {
  try {
    const k = JSON.parse(localStorage.getItem(KICKED_KEY)) || [];
    if (!k.includes(u)) k.push(u);
    localStorage.setItem(KICKED_KEY, JSON.stringify(k));
  } catch {}
}
function clearKicked(u) {
  try {
    let k = JSON.parse(localStorage.getItem(KICKED_KEY)) || [];
    localStorage.setItem(KICKED_KEY, JSON.stringify(k.filter(x => x !== u)));
  } catch {}
}


// ══════════════════════════════════════
//  AUTH SCREEN
// ══════════════════════════════════════

function switchAuthTab(tab) {
  const lf = document.getElementById("auth-login-form");
  const sf = document.getElementById("auth-signup-form");
  const tl = document.getElementById("tab-login");
  const ts = document.getElementById("tab-signup");
  if (tab === "login") {
    lf.style.display = "flex"; sf.style.display = "none";
    tl.classList.add("active"); ts.classList.remove("active");
    clearMsg("login-msg");
  } else {
    lf.style.display = "none"; sf.style.display = "flex";
    tl.classList.remove("active"); ts.classList.add("active");
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
  if (username === OWNER_USERNAME) {
    if (password !== OWNER_PASSWORD) { shakeInput("login-password"); setMsg("login-msg", "Invalid credentials."); return; }
    clearKicked(OWNER_USERNAME); setSession(OWNER_USERNAME); proceedAfterAuth(OWNER_USERNAME); return;
  }
  const user = findUser(username);
  if (!user) { shakeInput("login-username"); setMsg("login-msg", "Account not found. Create one?"); return; }
  if (user.password !== password) { shakeInput("login-password"); setMsg("login-msg", "Wrong password."); return; }
  if (user.banned) { setMsg("login-msg", "This account has been banned."); return; }
  clearKicked(username); setSession(username); proceedAfterAuth(username);
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
    shakeInput("signup-username"); setMsg("signup-msg", "Username already taken."); return;
  }
  users.push({ username, password, banned: false, createdAt: Date.now() });
  saveUsers(users); setSession(username);
  setMsg("signup-msg", "Account created!", false);
  setTimeout(() => proceedAfterAuth(username), 600);
}

function doGuest() {
  const g = "Guest_" + Math.floor(Math.random() * 9000 + 1000);
  setSession(g); proceedAfterAuth(g);
}

function doLogout() { clearSession(); location.reload(); }

function proceedAfterAuth(username) {
  document.getElementById("auth-screen").classList.add("hidden");
  const vk = "mos_visited_" + username;
  if (!localStorage.getItem(vk)) { localStorage.setItem(vk, "1"); showOnboarding(username); }
  else runBoot();
}


// ══════════════════════════════════════
//  ONBOARDING
// ══════════════════════════════════════

function showOnboarding(username) {
  const ob = document.getElementById("onboarding");
  ob.classList.remove("hidden");
  const g = document.getElementById("ob-greeting");
  if (g) g.innerHTML = "Welcome, <span>" + username + "</span>";
  document.getElementById("ob-step-1").classList.add("hidden");
  document.getElementById("ob-step-2").classList.remove("hidden");
}

function obFinish() {
  const ob = document.getElementById("onboarding");
  ob.classList.add("fade-out");
  setTimeout(() => { ob.classList.add("hidden"); runBoot(); }, 600);
}


// ══════════════════════════════════════
//  BOOT SEQUENCE
// ══════════════════════════════════════

const BOOT_MESSAGES = [
  { text: "Initializing Matriarchs OS kernel…",   ok: true  },
  { text: "Loading sovereign network stack…",      ok: false },
  { text: "Mounting encrypted filesystem…",        ok: true  },
  { text: "Starting custom proxy engine…",         ok: true  },
  { text: "Registering proxy service worker…",     ok: true  },
  { text: "Calibrating relay endpoints…",          ok: true  },
  { text: "Loading desktop environment…",          ok: true  },
  { text: "System ready.",                         ok: true  },
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
        setTimeout(() => { bootEl.style.display = "none"; }, 850);
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
  if (topEl) { topEl.textContent = username.toUpperCase(); if (owner) topEl.classList.add("is-owner"); }
  const smEl = document.getElementById("sm-username");
  if (smEl)  { smEl.textContent  = username;               if (owner) smEl.classList.add("is-owner"); }
  wireDesktopIcons();
  if (owner) injectOwnerUI();
}

function wireDesktopIcons() {
  document.querySelectorAll("#desktop-icons .desktop-icon").forEach(icon => {
    const label = icon.querySelector("span")?.textContent?.trim();
    if (label === "Files"      && !icon.dataset.wired) { icon.onclick = openFiles;      icon.dataset.wired = "1"; }
    if (label === "Terminal"   && !icon.dataset.wired) { icon.onclick = openTerminal;   icon.dataset.wired = "1"; }
    if (label === "Calculator" && !icon.dataset.wired) { icon.onclick = openCalculator; icon.dataset.wired = "1"; }
  });
  document.querySelectorAll("#sm-grid .sm-app").forEach(app => {
    const label = app.querySelector("span")?.textContent?.trim();
    if (label === "Files"      && !app.dataset.wired) { app.onclick = () => { openFiles();      toggleStartMenu(); }; app.dataset.wired = "1"; }
    if (label === "Terminal"   && !app.dataset.wired) { app.onclick = () => { openTerminal();   toggleStartMenu(); }; app.dataset.wired = "1"; }
    if (label === "Calculator" && !app.dataset.wired) { app.onclick = () => { openCalculator(); toggleStartMenu(); }; app.dataset.wired = "1"; }
    if (label === "Settings"   && !app.dataset.wired) { app.onclick = () => { openSettings();   toggleStartMenu(); }; app.dataset.wired = "1"; }
  });
}

function injectOwnerUI() {
  const tbl = document.querySelector(".topbar-left");
  if (tbl && !document.getElementById("topbar-admin-btn")) {
    const b = document.createElement("span");
    b.className = "bar-menu owner-menu"; b.id = "topbar-admin-btn";
    b.textContent = "⬡ Admin"; b.onclick = () => openAdmin();
    tbl.appendChild(b);
  }
  const di = document.getElementById("desktop-icons");
  if (di && !document.getElementById("icon-admin")) {
    const ic = document.createElement("div");
    ic.className = "desktop-icon owner-icon"; ic.id = "icon-admin"; ic.onclick = openAdmin;
    ic.innerHTML = `<div class="icon-img"><svg width="32" height="32" viewBox="0 0 24 24"><use href="#ico-shield"/></svg></div><span>Admin</span>`;
    di.appendChild(ic);
  }
  const sg = document.getElementById("sm-grid");
  if (sg && !document.getElementById("sm-admin-app")) {
    const ap = document.createElement("div");
    ap.className = "sm-app owner-app"; ap.id = "sm-admin-app";
    ap.onclick = () => { openAdmin(); toggleStartMenu(); };
    ap.innerHTML = `<div class="sm-app-icon"><svg width="20" height="20" viewBox="0 0 24 24"><use href="#ico-shield"/></svg></div><span>Admin Panel</span>`;
    sg.appendChild(ap);
  }
}


// ══════════════════════════════════════
//  ADMIN PANEL
// ══════════════════════════════════════

function openAdmin() {
  const session = getSession();
  if (!isOwner(session)) return;
  const existing = document.getElementById("win-admin");
  if (existing) { existing.classList.remove("minimized"); bringToFront("win-admin"); return; }

  const win = document.createElement("div");
  win.className = "window"; win.id = "win-admin";
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
          <div class="admin-sub">Logged in as ${escHtml(session)} — Sovereign Access</div>
        </div>
        <div class="admin-stats" id="admin-stats"></div>
        <div class="admin-section-title">Registered Users</div>
        <div class="admin-users-list" id="admin-users-list"></div>
      </div>
    </div>`;
  document.getElementById("windows").appendChild(win);
  makeDraggable(win); bringToFront("win-admin");
  openWindows["win-admin"] = { title: "Admin", iconId: "shield" };
  refreshTaskbar(); renderAdminPanel();
}

function renderAdminPanel() {
  const users  = getUsers();
  const statsEl = document.getElementById("admin-stats");
  const listEl  = document.getElementById("admin-users-list");
  if (!statsEl || !listEl) return;
  const total  = users.length;
  const banned = users.filter(u => u.banned).length;
  statsEl.innerHTML = `
    <div class="admin-stat"><div class="admin-stat-num">${total}</div><div class="admin-stat-label">TOTAL USERS</div></div>
    <div class="admin-stat"><div class="admin-stat-num">${total - banned}</div><div class="admin-stat-label">ACTIVE</div></div>
    <div class="admin-stat"><div class="admin-stat-num">${banned}</div><div class="admin-stat-label">BANNED</div></div>`;
  if (!users.length) {
    listEl.innerHTML = `<div class="admin-empty">No registered accounts yet.</div>`; return;
  }
  listEl.innerHTML = users.map(user => {
    const initials    = user.username.slice(0, 2).toUpperCase();
    const isBanned    = user.banned;
    const isKicked    = isUserKicked(user.username);
    const statusText  = isBanned ? "Banned" : isKicked ? "Kicked" : "Active";
    const statusClass = isBanned || isKicked ? "banned" : "online";
    const joined      = user.createdAt ? new Date(user.createdAt).toLocaleDateString() : "Unknown";
    return `<div class="admin-user-row">
      <div class="admin-user-avatar">${initials}</div>
      <div class="admin-user-info">
        <div class="admin-user-name">${escHtml(user.username)}</div>
        <div class="admin-user-status ${statusClass}">${statusText} · Joined ${joined}</div>
      </div>
      <div class="admin-actions">
        ${isBanned
          ? `<button class="admin-action-btn unban-btn" onclick="adminUnban('${escHtml(user.username)}')">UNBAN</button>`
          : `<button class="admin-action-btn ban-btn" onclick="adminBan('${escHtml(user.username)}')">BAN</button>`}
        <button class="admin-action-btn kick-btn" onclick="adminKick('${escHtml(user.username)}')"${isBanned?" disabled":""}>KICK</button>
        <button class="admin-action-btn" style="border-color:rgba(255,107,107,0.3);color:#ff6b6b" onclick="adminDelete('${escHtml(user.username)}')">DEL</button>
      </div>
    </div>`;
  }).join("");
}

function adminBan(u) { const users = getUsers(); const user = users.find(x=>x.username===u); if(!user)return; user.banned=true; saveUsers(users); showToast(u+" banned."); renderAdminPanel(); }
function adminUnban(u) { const users = getUsers(); const user = users.find(x=>x.username===u); if(!user)return; user.banned=false; saveUsers(users); clearKicked(u); showToast(u+" unbanned."); renderAdminPanel(); }
function adminKick(u) { markKicked(u); showToast(u+" kicked."); renderAdminPanel(); }
function adminDelete(u) {
  if (!confirm(`Delete account "${u}"?`)) return;
  saveUsers(getUsers().filter(x=>x.username!==u)); clearKicked(u);
  showToast(u+"'s account deleted."); renderAdminPanel();
}

function escHtml(s) {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function showToast(msg) {
  const t = document.createElement("div");
  t.className = "kick-toast"; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.classList.add("fade-out"); setTimeout(() => t.remove(), 350); }, 2800);
}


// ══════════════════════════════════════
//  FILES APP
// ══════════════════════════════════════

const FILES_STORAGE_KEY = "mos_files";
function getFiles() { try { return JSON.parse(localStorage.getItem(FILES_STORAGE_KEY)) || getDefaultFiles(); } catch { return getDefaultFiles(); } }
function saveFiles(f) { localStorage.setItem(FILES_STORAGE_KEY, JSON.stringify(f)); }
function getDefaultFiles() {
  return [
    { id:"1", name:"README.txt",  type:"txt", content:"Welcome to Matriarchs OS!\n\nThis is your personal file system.\nCreate, edit, and delete files freely.", created:Date.now()-86400000, modified:Date.now()-86400000 },
    { id:"2", name:"Notes.txt",   type:"txt", content:"My notes go here…",  created:Date.now()-3600000,  modified:Date.now()-3600000  },
    { id:"3", name:"todo.txt",    type:"txt", content:"[ ] Set up Matriarchs OS\n[x] Create account\n[ ] Explore the browser", created:Date.now()-7200000, modified:Date.now()-7200000 },
  ];
}

function openFiles() {
  const existing = document.getElementById("win-files");
  if (existing) { existing.classList.remove("minimized"); bringToFront("win-files"); return; }
  const win = document.createElement("div");
  win.className = "window"; win.id = "win-files";
  win.style.cssText = "top:60px;left:130px;width:640px;height:460px";
  win.innerHTML = `
    <div class="window-titlebar">
      <div class="window-controls">
        <button class="wbtn close" onclick="closeWindow('win-files')"></button>
        <button class="wbtn min"   onclick="minimizeWindow('win-files')"></button>
        <button class="wbtn max"   onclick="maximizeWindow('win-files')"></button>
      </div>
      <span class="window-title">FILES</span>
    </div>
    <div class="window-body" style="flex-direction:row;overflow:hidden">
      <div class="files-sidebar">
        <div class="files-sidebar-section">LOCATIONS</div>
        <div class="files-sidebar-item active" id="files-loc-home">
          <svg width="13" height="13" viewBox="0 0 24 24"><use href="#ico-files"/></svg><span>Home</span>
        </div>
        <div class="files-sidebar-section" style="margin-top:12px">ACTIONS</div>
        <div class="files-sidebar-item" onclick="filesNewFile()">
          <svg width="13" height="13" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg><span>New File</span>
        </div>
      </div>
      <div class="files-main">
        <div class="files-toolbar">
          <span class="files-path">~/Home</span>
          <div style="flex:1"></div>
          <button class="files-toolbar-btn" onclick="filesNewFile()">+ New</button>
        </div>
        <div class="files-grid" id="files-grid"></div>
      </div>
    </div>
    <div class="files-editor" id="files-editor" style="display:none">
      <div class="files-editor-bar">
        <span class="files-editor-name" id="files-editor-name">Untitled</span>
        <div style="flex:1"></div>
        <button class="files-toolbar-btn" onclick="filesSave()">Save</button>
        <button class="files-toolbar-btn" style="margin-left:6px;color:var(--text-dim)" onclick="filesCloseEditor()">✕ Close</button>
      </div>
      <textarea class="files-editor-area" id="files-editor-area" spellcheck="false"></textarea>
    </div>`;
  document.getElementById("windows").appendChild(win);
  makeDraggable(win); bringToFront("win-files");
  openWindows["win-files"] = { title: "Files", iconId: "files" };
  refreshTaskbar(); renderFilesGrid();
}

let currentFileId = null;
function renderFilesGrid() {
  const grid = document.getElementById("files-grid"); if (!grid) return;
  const files = getFiles();
  if (!files.length) { grid.innerHTML = `<div style="grid-column:1/-1;padding:40px;text-align:center;font-family:var(--mono);font-size:11px;color:var(--text-dim)">No files yet. Click "+ New".</div>`; return; }
  grid.innerHTML = files.map(f => {
    const ext = f.name.split(".").pop().toLowerCase();
    return `<div class="files-item" ondblclick="filesOpenFile('${f.id}')" onclick="filesSelectItem(this)">
      <div class="files-item-icon">${getFileIcon(ext)}</div>
      <div class="files-item-name">${escHtml(f.name)}</div>
      <div class="files-item-meta">${new Date(f.modified).toLocaleDateString()}</div>
      <div class="files-item-actions">
        <button onclick="event.stopPropagation();filesOpenFile('${f.id}')" title="Open">✎</button>
        <button onclick="event.stopPropagation();filesDeleteFile('${f.id}')" title="Delete" style="color:#ff6b6b">✕</button>
      </div>
    </div>`;
  }).join("");
}
function getFileIcon(ext) {
  const m = { txt:`<svg width="28" height="28" viewBox="0 0 24 24"><use href="#ico-files"/></svg>`, js:`<svg width="28" height="28" viewBox="0 0 24 24"><use href="#ico-term"/></svg>`, html:`<svg width="28" height="28" viewBox="0 0 24 24"><use href="#ico-globe"/></svg>`, css:`<svg width="28" height="28" viewBox="0 0 24 24"><use href="#ico-cog"/></svg>` };
  return m[ext] || m.txt;
}
function filesSelectItem(el) { document.querySelectorAll(".files-item.selected").forEach(e=>e.classList.remove("selected")); el.classList.add("selected"); }
function filesOpenFile(id) {
  const file = getFiles().find(f=>f.id===id); if(!file) return;
  currentFileId = id;
  const editor = document.getElementById("files-editor");
  const nameEl = document.getElementById("files-editor-name");
  const areaEl = document.getElementById("files-editor-area");
  const wb     = document.querySelector("#win-files .window-body");
  if (!editor||!nameEl||!areaEl) return;
  nameEl.textContent = file.name; areaEl.value = file.content||"";
  editor.style.display="flex"; if(wb) wb.style.display="none";
}
function filesCloseEditor() {
  const editor=document.getElementById("files-editor"); const wb=document.querySelector("#win-files .window-body");
  if(editor) editor.style.display="none"; if(wb) wb.style.display="flex";
  currentFileId=null; renderFilesGrid();
}
function filesSave() {
  if(!currentFileId) return;
  const files=getFiles(); const file=files.find(f=>f.id===currentFileId); if(!file) return;
  const areaEl=document.getElementById("files-editor-area");
  file.content=areaEl?areaEl.value:""; file.modified=Date.now();
  saveFiles(files); showToast(`"${file.name}" saved.`);
}
function filesNewFile() {
  const name=prompt("File name:","Untitled.txt"); if(!name||!name.trim()) return;
  const files=getFiles();
  const f={id:Date.now().toString(),name:name.trim(),type:name.split(".").pop()||"txt",content:"",created:Date.now(),modified:Date.now()};
  files.push(f); saveFiles(files); renderFilesGrid(); filesOpenFile(f.id);
}
function filesDeleteFile(id) {
  const file=getFiles().find(f=>f.id===id); if(!file) return;
  if(!confirm(`Delete "${file.name}"?`)) return;
  saveFiles(getFiles().filter(f=>f.id!==id)); renderFilesGrid();
}


// ══════════════════════════════════════
//  CALCULATOR APP
// ══════════════════════════════════════

function openCalculator() {
  const existing = document.getElementById("win-calc");
  if (existing) { existing.classList.remove("minimized"); bringToFront("win-calc"); return; }
  const win = document.createElement("div");
  win.className = "window"; win.id = "win-calc";
  win.style.cssText = "top:80px;left:200px;width:280px;height:420px;min-width:280px;min-height:420px";
  win.innerHTML = `
    <div class="window-titlebar">
      <div class="window-controls">
        <button class="wbtn close" onclick="closeWindow('win-calc')"></button>
        <button class="wbtn min"   onclick="minimizeWindow('win-calc')"></button>
        <button class="wbtn max"   onclick="maximizeWindow('win-calc')"></button>
      </div>
      <span class="window-title">CALCULATOR</span>
    </div>
    <div class="window-body" style="overflow:hidden">
      <div class="calc-wrap">
        <div class="calc-display">
          <div class="calc-expr" id="calc-expr"></div>
          <div class="calc-val"  id="calc-val">0</div>
        </div>
        <div class="calc-grid">
          <button class="calc-btn calc-span2 calc-fn" onclick="calcClear()">AC</button>
          <button class="calc-btn calc-fn" onclick="calcToggleSign()">+/−</button>
          <button class="calc-btn calc-op" onclick="calcOp('/')">÷</button>
          <button class="calc-btn" onclick="calcNum('7')">7</button>
          <button class="calc-btn" onclick="calcNum('8')">8</button>
          <button class="calc-btn" onclick="calcNum('9')">9</button>
          <button class="calc-btn calc-op" onclick="calcOp('*')">×</button>
          <button class="calc-btn" onclick="calcNum('4')">4</button>
          <button class="calc-btn" onclick="calcNum('5')">5</button>
          <button class="calc-btn" onclick="calcNum('6')">6</button>
          <button class="calc-btn calc-op" onclick="calcOp('-')">−</button>
          <button class="calc-btn" onclick="calcNum('1')">1</button>
          <button class="calc-btn" onclick="calcNum('2')">2</button>
          <button class="calc-btn" onclick="calcNum('3')">3</button>
          <button class="calc-btn calc-op" onclick="calcOp('+')">+</button>
          <button class="calc-btn calc-span2" onclick="calcNum('0')">0</button>
          <button class="calc-btn" onclick="calcDot()">.</button>
          <button class="calc-btn calc-eq" onclick="calcEquals()">=</button>
        </div>
      </div>
    </div>`;
  document.getElementById("windows").appendChild(win);
  makeDraggable(win); bringToFront("win-calc");
  openWindows["win-calc"] = { title: "Calculator", iconId: "cog" };
  refreshTaskbar();
  win._calcKeyHandler = (e) => {
    if (!document.getElementById("win-calc")) return;
    const k = e.key;
    if (k>="0"&&k<="9") calcNum(k);
    else if(k===".") calcDot();
    else if(k==="+") calcOp("+");
    else if(k==="-") calcOp("-");
    else if(k==="*") calcOp("*");
    else if(k==="/"){e.preventDefault();calcOp("/");}
    else if(k==="Enter"||k==="=") calcEquals();
    else if(k==="Backspace") calcBackspace();
    else if(k==="Escape") calcClear();
  };
  document.addEventListener("keydown", win._calcKeyHandler);
}

let calcCurrent="0",calcPrev=null,calcOperator=null,calcNewInput=true,calcExprStr="";
const calcSymbols={"+":"+","-":"−","*":"×","/":"÷"};
function calcUpdateDisplay(){const v=document.getElementById("calc-val"),e=document.getElementById("calc-expr");if(v)v.textContent=calcCurrent.length>12?parseFloat(calcCurrent).toExponential(4):calcCurrent;if(e)e.textContent=calcExprStr;}
function calcNum(n){if(calcNewInput){calcCurrent=n==="0"?"0":n;calcNewInput=false;}else{if(calcCurrent==="0"&&n!==".")calcCurrent=n;else if(calcCurrent.length<14)calcCurrent+=n;}calcUpdateDisplay();}
function calcDot(){if(calcNewInput){calcCurrent="0.";calcNewInput=false;}else if(!calcCurrent.includes("."))calcCurrent+=".";calcUpdateDisplay();}
function calcOp(op){if(calcOperator&&!calcNewInput)calcEquals(true);calcPrev=parseFloat(calcCurrent);calcOperator=op;calcNewInput=true;calcExprStr=calcCurrent+" "+(calcSymbols[op]||op);calcUpdateDisplay();}
function calcEquals(chaining=false){if(calcPrev===null||calcOperator===null)return;const c=parseFloat(calcCurrent);let r;switch(calcOperator){case"+":r=calcPrev+c;break;case"-":r=calcPrev-c;break;case"*":r=calcPrev*c;break;case"/":r=c===0?"Error":calcPrev/c;break;default:r=c;}if(!chaining){calcExprStr=calcPrev+" "+(calcSymbols[calcOperator]||calcOperator)+" "+c+" =";calcOperator=null;calcPrev=null;}calcCurrent=r==="Error"?"Error":String(parseFloat(r.toFixed(10)));calcNewInput=true;calcUpdateDisplay();}
function calcClear(){calcCurrent="0";calcPrev=null;calcOperator=null;calcNewInput=true;calcExprStr="";calcUpdateDisplay();}
function calcToggleSign(){if(calcCurrent==="0"||calcCurrent==="Error")return;calcCurrent=calcCurrent.startsWith("-")?calcCurrent.slice(1):"-"+calcCurrent;calcUpdateDisplay();}
function calcBackspace(){if(calcNewInput||calcCurrent==="Error"){calcClear();return;}calcCurrent=calcCurrent.length>1?calcCurrent.slice(0,-1):"0";calcUpdateDisplay();}


// ══════════════════════════════════════
//  TERMINAL
// ══════════════════════════════════════

function openTerminal() {
  const existing = document.getElementById("win-terminal");
  if (existing) { existing.classList.remove("minimized"); bringToFront("win-terminal"); return; }
  const win = document.createElement("div");
  win.className = "window"; win.id = "win-terminal";
  win.style.cssText = "top:100px;left:150px;width:560px;height:340px";
  const username = getSession() || "user";
  win.innerHTML = `
    <div class="window-titlebar">
      <div class="window-controls">
        <button class="wbtn close" onclick="closeWindow('win-terminal')"></button>
        <button class="wbtn min"   onclick="minimizeWindow('win-terminal')"></button>
        <button class="wbtn max"   onclick="maximizeWindow('win-terminal')"></button>
      </div>
      <span class="window-title">TERMINAL</span>
    </div>
    <div class="window-body" style="background:#050d07">
      <div class="term-body" id="term-body">
        <div class="term-line"><span class="term-prompt">system</span> <span style="color:var(--text-dim)">Matriarchs OS v1.0.0 — Terminal</span></div>
        <div class="term-line"><span class="term-prompt">system</span> <span style="color:var(--text-dim)">Type "help" for available commands.</span></div>
        <div class="term-line" style="height:8px"></div>
      </div>
      <div class="term-input-row">
        <span class="term-prompt">${escHtml(username)}@mos</span>
        <span style="color:var(--text-dim);margin:0 4px">$</span>
        <input class="term-input" id="term-input" type="text" autocomplete="off" spellcheck="false" autofocus/>
      </div>
    </div>`;
  document.getElementById("windows").appendChild(win);
  makeDraggable(win); bringToFront("win-terminal");
  openWindows["win-terminal"] = { title: "Terminal", iconId: "term" };
  refreshTaskbar();
  const input = win.querySelector("#term-input");
  const body  = win.querySelector("#term-body");
  const CMDS = {
    help:    () => ["Available commands:","  help     — show this list","  whoami   — current user","  ls       — list files","  clear    — clear terminal","  date     — current date/time","  echo     — echo text","  version  — OS version"],
    whoami:  () => [username],
    date:    () => [new Date().toString()],
    version: () => ["Matriarchs OS v1.0.0 — Sovereign Edition"],
    clear:   () => { body.innerHTML=""; return []; },
    ls:      () => { const f=getFiles(); return f.length?f.map(x=>"  "+x.name):["(no files)"]; },
  };
  input.addEventListener("keydown", (e) => {
    if (e.key!=="Enter") return;
    const raw=input.value.trim(); input.value=""; if(!raw) return;
    const cl=document.createElement("div"); cl.className="term-line";
    cl.innerHTML=`<span class="term-prompt">${escHtml(username)}@mos</span> <span style="color:var(--text-dim)">$</span> <span style="color:var(--text)">${escHtml(raw)}</span>`;
    body.appendChild(cl);
    const parts=raw.split(""),cmd=parts[0].toLowerCase(),args=parts.slice(1).join(" ");
    let lines=cmd==="echo"?[args]:CMDS[cmd]?CMDS[cmd]()||[]:["bash: "+cmd+": command not found"];
    lines.forEach(l=>{ const le=document.createElement("div"); le.className="term-line"; le.textContent=l; body.appendChild(le); });
    body.scrollTop=body.scrollHeight;
  });
  input.focus();
  win.addEventListener("click", ()=>input.focus());
}


// ══════════════════════════════════════
//  SETTINGS
// ══════════════════════════════════════

function openSettings() { showToast("Settings coming soon."); }


// ══════════════════════════════════════
//  INIT
// ══════════════════════════════════════

window.addEventListener("DOMContentLoaded", () => {
  const session = getSession();
  if (session && isUserKicked(session))                              { clearSession(); location.reload(); return; }
  if (session && session!==OWNER_USERNAME && isUserBanned(session)) { clearSession(); location.reload(); return; }
  if (session) {
    const vk = "mos_visited_"+session;
    if (!localStorage.getItem(vk)) { localStorage.setItem(vk,"1"); document.getElementById("auth-screen").classList.add("hidden"); showOnboarding(session); }
    else { document.getElementById("auth-screen").classList.add("hidden"); runBoot(); }
  }
  document.getElementById("login-password")?.addEventListener("keydown",  e=>{ if(e.key==="Enter") doLogin(); });
  document.getElementById("login-username")?.addEventListener("keydown",  e=>{ if(e.key==="Enter") doLogin(); });
  document.getElementById("signup-confirm")?.addEventListener("keydown",  e=>{ if(e.key==="Enter") doSignup(); });
});


// ══════════════════════════════════════
//  WINDOW MANAGEMENT
// ══════════════════════════════════════

let zTop = 10;
const openWindows = {};

function bringToFront(id) { const w=document.getElementById(id); if(w) w.style.zIndex=++zTop; refreshTaskbar(); }
function closeWindow(id) {
  const w=document.getElementById(id); if(!w) return;
  if(w._calcKeyHandler) document.removeEventListener("keydown",w._calcKeyHandler);
  w.style.opacity="0"; w.style.transform="scale(0.9)";
  setTimeout(()=>{ w.remove(); delete openWindows[id]; refreshTaskbar(); },200);
}
function minimizeWindow(id) { const w=document.getElementById(id); if(!w) return; w.classList.toggle("minimized"); refreshTaskbar(); }
function maximizeWindow(id) {
  const w=document.getElementById(id); if(!w) return;
  if(w.dataset.maximized){
    w.style.top=w.dataset.origTop; w.style.left=w.dataset.origLeft;
    w.style.width=w.dataset.origW; w.style.height=w.dataset.origH;
    delete w.dataset.maximized;
  } else {
    w.dataset.origTop=w.style.top||w.offsetTop+"px"; w.dataset.origLeft=w.style.left||w.offsetLeft+"px";
    w.dataset.origW=w.style.width||w.offsetWidth+"px"; w.dataset.origH=w.style.height||w.offsetHeight+"px";
    const tbH=parseInt(getComputedStyle(document.documentElement).getPropertyValue("--taskbar-h"))||44;
    w.style.top="32px"; w.style.left="0"; w.style.width="100vw"; w.style.height=`calc(100vh - 32px - ${tbH}px)`;
    w.dataset.maximized="1";
  }
}
function makeDraggable(win) {
  const bar=win.querySelector(".window-titlebar"); if(!bar) return;
  let ox=0,oy=0,dragging=false;
  bar.addEventListener("mousedown",(e)=>{ if(e.target.classList.contains("wbtn")||win.dataset.maximized) return; dragging=true; ox=e.clientX-win.offsetLeft; oy=e.clientY-win.offsetTop; bringToFront(win.id); e.preventDefault(); });
  document.addEventListener("mousemove",(e)=>{ if(!dragging) return; win.style.left=(e.clientX-ox)+"px"; win.style.top=(e.clientY-oy)+"px"; });
  document.addEventListener("mouseup",()=>{ dragging=false; });
  win.addEventListener("mousedown",()=>bringToFront(win.id));
}


// ══════════════════════════════════════
//  TASKBAR
// ══════════════════════════════════════

function refreshTaskbar() {
  const container=document.getElementById("taskbar-apps"); if(!container) return;
  container.innerHTML="";
  for(const [id,info] of Object.entries(openWindows)){
    const win=document.getElementById(id);
    const isMin=win&&win.classList.contains("minimized");
    const isFocused=win&&parseInt(win.style.zIndex||0)===zTop;
    const btn=document.createElement("button");
    btn.className="taskbar-btn open"+(isFocused&&!isMin?" active":"");
    btn.title=info.title;
    btn.innerHTML=`<svg width="14" height="14" viewBox="0 0 24 24"><use href="#ico-${info.iconId}"/></svg><span>${info.title}</span>`;
    btn.addEventListener("click",()=>{
      if(!win) return;
      if(isMin){win.classList.remove("minimized");bringToFront(id);}
      else if(isFocused){win.classList.add("minimized");}
      else{bringToFront(id);}
      refreshTaskbar();
    });
    container.appendChild(btn);
  }
}


// ══════════════════════════════════════
//  START MENU
// ══════════════════════════════════════

let startMenuOpen=false;
function toggleStartMenu(){
  const menu=document.getElementById("start-menu"),btn=document.querySelector(".taskbar-start");
  startMenuOpen=!startMenuOpen;
  menu.classList.toggle("hidden",!startMenuOpen);
  if(btn) btn.classList.toggle("active",startMenuOpen);
}
document.addEventListener("click",(e)=>{
  if(!startMenuOpen) return;
  const menu=document.getElementById("start-menu"),btn=document.querySelector(".taskbar-start");
  if(menu&&!menu.contains(e.target)&&btn&&!btn.contains(e.target)){
    startMenuOpen=false; menu.classList.add("hidden"); btn.classList.remove("active");
  }
});


// ══════════════════════════════════════
//  BROWSER WINDOW — Custom Proxy
// ══════════════════════════════════════

function openBrowser() {
  const existing=document.getElementById("win-browser");
  if(existing){existing.classList.remove("minimized");bringToFront("win-browser");return;}

  const tpl=document.getElementById("browser-window-tpl");
  const clone=tpl.content.cloneNode(true);
  document.getElementById("windows").appendChild(clone);

  const win=document.getElementById("win-browser");
  makeDraggable(win); bringToFront("win-browser");
  openWindows["win-browser"]={title:"Browser",iconId:"globe"};
  refreshTaskbar();

  const addrEl    = document.getElementById("sj-address");
  const frameWrap = document.getElementById("sj-frame-wrap");
  const goBtn     = document.getElementById("sj-go");
  const errorEl   = document.getElementById("sj-error");
  const errCodeEl = document.getElementById("sj-error-code");

  let navHistory=[], navIdx=-1;

  function navigate(rawUrl) {
    if (!rawUrl||!rawUrl.trim()) return;
    errorEl.textContent=""; errCodeEl.textContent="";

    let url=rawUrl.trim();
    if (!url.startsWith("http://")&&!url.startsWith("https://")) {
      url=(url.includes(" ")||!url.includes("."))
        ? "https://www.google.com/search?q="+encodeURIComponent(url)
        : "https://"+url;
    }

    const proxyUrl="/proxy/?url="+encodeURIComponent(url);
    frameWrap.innerHTML="";
    const iframe=document.createElement("iframe");
    iframe.style.cssText="width:100%;height:100%;border:none;background:#fff";
    iframe.sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox";
    iframe.src=proxyUrl;
    frameWrap.appendChild(iframe);

    addrEl.value=url;
    navHistory=navHistory.slice(0,navIdx+1);
    navHistory.push(url);
    navIdx=navHistory.length-1;
    updateNavBtns();
  }

  function updateNavBtns() {
    const b=document.getElementById("sj-back"),f=document.getElementById("sj-fwd");
    if(b) b.disabled=navIdx<=0;
    if(f) f.disabled=navIdx>=navHistory.length-1;
  }

  goBtn.addEventListener("click",()=>navigate(addrEl.value));
  addrEl.addEventListener("keydown",(e)=>{if(e.key==="Enter")navigate(addrEl.value);});
  document.getElementById("sj-back")?.addEventListener("click",()=>{ if(navIdx>0){navIdx--;addrEl.value=navHistory[navIdx];const iframe=frameWrap.querySelector("iframe");if(iframe)iframe.src="/proxy/?url="+encodeURIComponent(navHistory[navIdx]);updateNavBtns();} });
  document.getElementById("sj-fwd")?.addEventListener("click",()=>{ if(navIdx<navHistory.length-1){navIdx++;addrEl.value=navHistory[navIdx];const iframe=frameWrap.querySelector("iframe");if(iframe)iframe.src="/proxy/?url="+encodeURIComponent(navHistory[navIdx]);updateNavBtns();} });
  document.getElementById("sj-reload")?.addEventListener("click",()=>{ const iframe=frameWrap.querySelector("iframe");if(iframe)iframe.src=iframe.src; });

  updateNavBtns();
}


// ══════════════════════════════════════
//  ABOUT WINDOW
// ══════════════════════════════════════

function openAbout() {
  const existing=document.getElementById("win-about");
  if(existing){existing.classList.remove("minimized");bringToFront("win-about");return;}
  const win=document.createElement("div");
  win.className="window"; win.id="win-about";
  win.innerHTML=`
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
        <div class="about-sigil"><svg width="40" height="40" viewBox="0 0 24 24"><use href="#ico-hex"/></svg></div>
        <div class="about-name">MATRIARCHS OS</div>
        <div class="about-sub">SOVEREIGN EDITION — v1.0.0</div>
        <div class="about-divider"></div>
        <div class="about-info">Custom Proxy Engine<br>Mercury Workshop</div>
      </div>
    </div>`;
  document.getElementById("windows").appendChild(win);
  makeDraggable(win); bringToFront("win-about");
  openWindows["win-about"]={title:"About",iconId:"hex"};
  refreshTaskbar();
}
