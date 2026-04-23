"use strict";

// ══════════════════════════════════════
//  MATRIARCHS OS — GAMES APP
//  Multi-provider game library
// ══════════════════════════════════════

// ── Server Providers ─────────────────────────────────────────────────────────

const GAME_PROVIDERS = {
  "3kho": {
    label: "3kh0",
    color: "#7a9e7e",
    fetchZones: fetch3khoZones,
  },
};

// ── 3kho provider ────────────────────────────────────────────────────────────
// games.json format: [{ "name": "...", "img": "...", "url": "..." }, ...]
// img/url may be relative paths like "/projects/slope/index.html"

const THREEKHO_BASE = "https://3kho.github.io";
const THREEKHO_JSON_URLS = [
  "https://cdn.jsdelivr.net/gh/3kho/3kho.github.io@main/config/games.json",
  "https://raw.githubusercontent.com/3kho/3kho.github.io/main/config/games.json",
];

async function fetch3khoZones() {
  let data = null;
  let lastErr = null;

  for (const url of THREEKHO_JSON_URLS) {
    try {
      const res = await fetch(url + "?t=" + Date.now());
      if (res.ok) {
        data = await res.json();
        break;
      }
    } catch (e) {
      lastErr = e;
    }
  }

  if (!data) throw new Error("Failed to fetch 3kho games: " + (lastErr?.message || "unknown"));

const resolveUrl = (u) => {
  if (!u) return null;
  if (u.startsWith("http")) return u;
  return THREEKHO_BASE + "/" + u;  // note: "/" + u, not just u
};

  return data.map((g, i) => ({
    id:          String(i),
    name:        g.title  || "Unknown",
    author:      "3kh0",
    featured:    false,
    provider:    "3kho",
    coverUrl:    resolveUrl(g.imgSrc),
    contentUrl:  null,
    externalUrl: resolveUrl(g.link),
    popularity:  0,
    tags:        [],
  }));
}

// ── Games Window ──────────────────────────────────────────────────────────────

const GAMES_STORAGE = "mos_games_favorites";
function getGameFavorites() {
  try { return JSON.parse(localStorage.getItem(GAMES_STORAGE)) || []; } catch { return []; }
}
function toggleGameFavorite(id) {
  let favs = getGameFavorites();
  if (favs.includes(id)) favs = favs.filter(x => x !== id);
  else favs.push(id);
  localStorage.setItem(GAMES_STORAGE, JSON.stringify(favs));
}

// State
let gamesAllZones  = [];
let gamesFiltered  = [];
let gamesSort      = localStorage.getItem("mos_games_sort") || "name";
let gamesFilter    = "all";
let gamesSearch    = "";
let gamesLoading   = false;
let gamesPlayingId = null;

function openGames() {
  const existing = document.getElementById("win-games");
  if (existing) { existing.classList.remove("minimized"); bringToFront("win-games"); return; }

  const win = document.createElement("div");
  win.className = "window";
  win.id = "win-games";
  win.style.cssText = "top:44px;left:100px;width:860px;height:580px;min-width:520px;min-height:360px";

  win.innerHTML = `
    <div class="window-titlebar">
      <div class="window-controls">
        <button class="wbtn close" onclick="closeWindow('win-games')"></button>
        <button class="wbtn min"   onclick="minimizeWindow('win-games')"></button>
        <button class="wbtn max"   onclick="maximizeWindow('win-games')"></button>
      </div>
      <span class="window-title">GAMES</span>
    </div>
    <div class="window-body" style="flex-direction:row;overflow:hidden;padding:0">

      <!-- Sidebar -->
      <div class="games-sidebar">
        <div class="games-sidebar-logo">
          <svg width="18" height="18" viewBox="0 0 24 24" style="color:var(--gold)">
            <path d="M6 12h4M8 10v4M15 12h.01M18 11h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <path d="M2 8a4 4 0 014-4h12a4 4 0 014 4v8a4 4 0 01-4 4H6a4 4 0 01-4-4z" fill="none" stroke="currentColor" stroke-width="1.5"/>
          </svg>
          <span>GAMES</span>
        </div>

        <div class="games-sidebar-section">LIBRARY</div>
        <div class="games-sidebar-item ${gamesFilter==='all'?'active':''}" onclick="gamesSetFilter('all')">
          <svg width="12" height="12" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>
          All Games
        </div>
        <div class="games-sidebar-item ${gamesFilter==='favorites'?'active':''}" onclick="gamesSetFilter('favorites')">
          <svg width="12" height="12" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>
          Favorites
          <span class="games-badge" id="games-fav-count">${getGameFavorites().length}</span>
        </div>

        <div class="games-sidebar-section" style="margin-top:10px">PROVIDERS</div>
        ${Object.entries(GAME_PROVIDERS).map(([key, p]) => `
          <div class="games-sidebar-item ${gamesFilter===key?'active':''}" onclick="gamesSetFilter('${key}')">
            <span class="games-provider-dot" style="background:${p.color}"></span>
            ${p.label}
          </div>
        `).join("")}

        <div style="flex:1"></div>

        <div class="games-sidebar-section">SORT BY</div>
        <select class="games-sort-select" id="games-sort-select" onchange="gamesSetSort(this.value)">
          <option value="name"     ${gamesSort==='name'    ?'selected':''}>Name (A–Z)</option>
          <option value="featured" ${gamesSort==='featured'?'selected':''}>Featured First</option>
        </select>
      </div>

      <!-- Main content -->
      <div class="games-main">
        <div class="games-topbar">
          <input
            class="games-search"
            id="games-search"
            type="text"
            placeholder="Search games…"
            autocomplete="off"
            spellcheck="false"
            oninput="gamesOnSearch(this.value)"
            value="${gamesSearch}"
          />
          <span class="games-count" id="games-count">Loading…</span>
        </div>

        <div class="games-grid" id="games-grid">
          <div class="games-loading">
            <div class="games-spinner"></div>
            <span>Loading games…</span>
          </div>
        </div>

        <!-- In-window game player -->
        <div class="games-player" id="games-player" style="display:none">
          <div class="games-player-bar">
            <button class="games-player-back" onclick="gamesClosePlayer()">
              <svg width="14" height="14" viewBox="0 0 24 24"><path d="M19 12H5M12 5l-7 7 7 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              Back
            </button>
            <span class="games-player-title" id="games-player-title">Game</span>
            <div style="flex:1"></div>
            <button class="games-player-action" onclick="gamesFullscreenPlayer()" title="Fullscreen">
              <svg width="13" height="13" viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <button class="games-player-action" onclick="gamesOpenInBrowser()" title="Open in Browser">
              <svg width="13" height="13" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </div>
          <div class="games-player-frame" id="games-player-frame"></div>
        </div>
      </div>

    </div>`;

  document.getElementById("windows").appendChild(win);
  makeDraggable(win);
  bringToFront("win-games");
  openWindows["win-games"] = { title: "Games", iconId: "games" };
  refreshTaskbar();

  gamesLoadAll();
}

async function gamesLoadAll() {
  gamesLoading = true;
  gamesAllZones = [];
  const gridEl = document.getElementById("games-grid");
  if (!gridEl) return;

  gridEl.innerHTML = `<div class="games-loading"><div class="games-spinner"></div><span>Loading games…</span></div>`;

  const results = await Promise.allSettled(
    Object.entries(GAME_PROVIDERS).map(async ([, provider]) => provider.fetchZones())
  );

  results.forEach((r) => {
    if (r.status === "fulfilled") gamesAllZones.push(...r.value);
    else console.warn("[Games] Provider failed:", r.reason);
  });

  gamesLoading = false;
  gamesApplyFilters();
}

function gamesApplyFilters() {
  let zones = [...gamesAllZones];

  if (gamesFilter === "favorites") {
    const favs = getGameFavorites();
    zones = zones.filter((z) => favs.includes(z.id));
  } else if (gamesFilter !== "all") {
    zones = zones.filter((z) => z.provider === gamesFilter);
  }

  if (gamesSearch.trim()) {
    const q = gamesSearch.toLowerCase();
    zones = zones.filter((z) => z.name.toLowerCase().includes(q));
  }

  if (gamesSort === "name") {
    zones.sort((a, b) => a.name.localeCompare(b.name));
  } else if (gamesSort === "featured") {
    zones.sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0));
  }

  gamesFiltered = zones;
  gamesRenderGrid();
}

function gamesRenderGrid() {
  const gridEl  = document.getElementById("games-grid");
  const countEl = document.getElementById("games-count");
  if (!gridEl) return;

  if (countEl) countEl.textContent = `${gamesFiltered.length} game${gamesFiltered.length !== 1 ? "s" : ""}`;

  if (!gamesFiltered.length) {
    gridEl.innerHTML = `<div class="games-empty">
      <svg width="32" height="32" viewBox="0 0 24 24" style="opacity:0.3;margin-bottom:10px">
        <path d="M6 12h4M8 10v4M15 12h.01M18 11h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <path d="M2 8a4 4 0 014-4h12a4 4 0 014 4v8a4 4 0 01-4 4H6a4 4 0 01-4-4z" fill="none" stroke="currentColor" stroke-width="1.5"/>
      </svg>
      No games found.
    </div>`;
    return;
  }

  const favs = getGameFavorites();
  gridEl.innerHTML = gamesFiltered.map((z) => {
    const isFav    = favs.includes(z.id);
    const provider = GAME_PROVIDERS[z.provider];
    return `<div class="games-card" onclick="gamesPlay('${z.id}')">
      <div class="games-card-cover">
        ${z.coverUrl
          ? `<img src="${z.coverUrl}" alt="${gamesEsc(z.name)}" loading="lazy" onerror="this.style.display='none'">`
          : `<div class="games-card-cover-placeholder">
              <svg width="28" height="28" viewBox="0 0 24 24" style="opacity:0.3">
                <path d="M6 12h4M8 10v4M15 12h.01M18 11h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                <path d="M2 8a4 4 0 014-4h12a4 4 0 014 4v8a4 4 0 01-4 4H6a4 4 0 01-4-4z" fill="none" stroke="currentColor" stroke-width="1.5"/>
              </svg>
            </div>`
        }
        <button class="games-card-fav ${isFav ? "active" : ""}" onclick="event.stopPropagation();gamesToggleFav('${z.id}')" title="${isFav ? "Remove from favorites" : "Add to favorites"}">
          <svg width="11" height="11" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z" fill="${isFav ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.5"/></svg>
        </button>
      </div>
      <div class="games-card-info">
        <div class="games-card-name">${gamesEsc(z.name)}</div>
        <div class="games-card-meta">
          <span style="color:${provider?.color || "var(--text-dim)"}">●</span>
          ${gamesEsc(z.author)}
        </div>
      </div>
    </div>`;
  }).join("");
}

function gamesPlay(id) {
  const zone = gamesAllZones.find((z) => z.id === id);
  if (!zone) return;

  const url = zone.externalUrl || zone.contentUrl;
  if (!url) return;

  const playerEl    = document.getElementById("games-player");
  const frameWrapEl = document.getElementById("games-player-frame");
  const titleEl     = document.getElementById("games-player-title");
  const gridEl      = document.getElementById("games-grid");
  const topbarEl    = document.querySelector("#win-games .games-topbar");
  if (!playerEl || !frameWrapEl) return;

  titleEl.textContent = zone.name;
  gamesPlayingId = id;

  frameWrapEl.innerHTML = `<div class="games-player-loading"><div class="games-spinner"></div><span>Loading ${gamesEsc(zone.name)}…</span></div>`;
  playerEl.style.display = "flex";
  gridEl.style.display   = "none";
  if (topbarEl) topbarEl.style.display = "none";

  // Embed via iframe — 3kho games are hosted on GitHub Pages
  const iframe = document.createElement("iframe");
  iframe.style.cssText = "width:100%;height:100%;border:none;background:#000";
  iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads allow-pointer-lock");
  iframe.setAttribute("allow", "autoplay; fullscreen; encrypted-media; pointer-lock");

  iframe.onload = () => {
    // Clear loading overlay once iframe signals it loaded
    const loader = frameWrapEl.querySelector(".games-player-loading");
    if (loader) loader.remove();
  };

  frameWrapEl.innerHTML = "";
  frameWrapEl.appendChild(iframe);
  iframe.src = url;
}

function gamesClosePlayer() {
  const playerEl    = document.getElementById("games-player");
  const gridEl      = document.getElementById("games-grid");
  const topbarEl    = document.querySelector("#win-games .games-topbar");
  const frameWrapEl = document.getElementById("games-player-frame");
  if (playerEl)    playerEl.style.display = "none";
  if (gridEl)      gridEl.style.display   = "grid";
  if (topbarEl)    topbarEl.style.display  = "";
  if (frameWrapEl) frameWrapEl.innerHTML   = "";
  gamesPlayingId = null;
}

function gamesFullscreenPlayer() {
  const iframe = document.querySelector("#games-player-frame iframe");
  if (!iframe) return;
  (iframe.requestFullscreen || iframe.mozRequestFullScreen || iframe.webkitRequestFullscreen || (() => {})).call(iframe);
}

function gamesOpenInBrowser() {
  if (!gamesPlayingId) return;
  const zone = gamesAllZones.find((z) => z.id === gamesPlayingId);
  if (!zone) return;
  const url = zone.externalUrl || zone.contentUrl;
  if (!url) return;
  openBrowser();
  setTimeout(() => {
    const addr = document.getElementById("sj-address");
    if (addr) { addr.value = url; document.getElementById("sj-go")?.click(); }
  }, 120);
}

function gamesSetFilter(f) {
  gamesFilter = f;
  document.querySelectorAll(".games-sidebar-item").forEach((el) => {
    const onclick = el.getAttribute("onclick") || "";
    el.classList.toggle("active", onclick.includes(`'${f}'`));
  });
  gamesApplyFilters();
}

function gamesSetSort(val) {
  gamesSort = val;
  localStorage.setItem("mos_games_sort", val);
  gamesApplyFilters();
}

function gamesOnSearch(val) {
  gamesSearch = val;
  gamesApplyFilters();
}

function gamesToggleFav(id) {
  toggleGameFavorite(id);
  const badge = document.getElementById("games-fav-count");
  if (badge) badge.textContent = getGameFavorites().length;
  const gridEl = document.getElementById("games-grid");
  const scrollTop = gridEl?.scrollTop || 0;
  gamesRenderGrid();
  if (gridEl) gridEl.scrollTop = scrollTop;
}

function gamesEsc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
