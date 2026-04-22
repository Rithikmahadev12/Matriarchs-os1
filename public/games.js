"use strict";

// ══════════════════════════════════════
//  MATRIARCHS OS — GAMES APP
//  Multi-provider game library
// ══════════════════════════════════════

// ── Server Providers ─────────────────────────────────────────────────────────

const GAME_PROVIDERS = {
  "gn-math": {
    label: "GN-Math",
    color: "#7a9e7e",
    fetchZones: fetchGnMathZones,
  },
  // Add more providers here:
  // "cool-math": {
  //   label: "Cool Math",
  //   color: "#e07a5f",
  //   fetchZones: fetchCoolMathZones,
  // },
};

// ── GN-Math provider ─────────────────────────────────────────────────────────

const GN_COVER_URL = "https://cdn.jsdelivr.net/gh/gn-math/covers@main";
const GN_HTML_URL  = "https://cdn.jsdelivr.net/gh/gn-math/html@main";

const GN_ZONES_URLS = [
  "https://cdn.jsdelivr.net/gh/gn-math/assets@main/zones.json",
  "https://cdn.jsdelivr.net/gh/gn-math/assets@latest/zones.json",
  "https://cdn.jsdelivr.net/gh/gn-math/assets@master/zones.json",
  "https://cdn.jsdelivr.net/gh/gn-math/assets/zones.json",
];

async function fetchGnMathZones() {
  // Try to get the latest commit SHA for cache-busting
  let zonesUrl = GN_ZONES_URLS[Math.floor(Math.random() * GN_ZONES_URLS.length)];
  try {
    const shaRes = await Promise.race([
      fetch("https://api.github.com/repos/gn-math/assets/commits?t=" + Date.now()),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 5000)),
    ]);
    if (shaRes.ok) {
      const shaJson = await shaRes.json();
      const sha = shaJson?.[0]?.sha;
      // jsdelivr requires short SHAs (8 chars), not full 40-char SHAs
      if (sha) zonesUrl = `https://cdn.jsdelivr.net/gh/gn-math/assets@${sha.slice(0, 8)}/zones.json`;
    }
  } catch (_) {}

  const res = await fetch(zonesUrl + "?t=" + Date.now());
  if (!res.ok) throw new Error("Failed to fetch zones (" + res.status + ")");
  const zones = await res.json();

  // Fetch popularity data (best-effort)
  let popularity = {};
  try {
    const popRes = await fetch(
      "https://data.jsdelivr.com/v1/stats/packages/gh/gn-math/html@main/files?period=year"
    );
    if (popRes.ok) {
      const popData = await popRes.json();
      popData.forEach((file) => {
        const m = file.name.match(/\/(\d+)\.html$/);
        if (m) popularity[parseInt(m[1])] = file.hits?.total || 0;
      });
    }
  } catch (_) {}

  return zones.map((z) => ({
    id:       String(z.id),
    name:     z.name || "Unknown",
    author:   z.author || "Unknown",
    authorLink: z.authorLink || null,
    featured: !!z.featured,
    provider: "gn-math",
    // Resolve cover URL
    coverUrl: z.cover
      ? z.cover.replace("{COVER_URL}", GN_COVER_URL).replace("{HTML_URL}", GN_HTML_URL)
      : null,
    // Raw content URL (HTML)
    contentUrl: z.url && !z.url.startsWith("http")
      ? z.url.replace("{COVER_URL}", GN_COVER_URL).replace("{HTML_URL}", GN_HTML_URL)
      : null,
    // External URL (open in browser)
    externalUrl: z.url && z.url.startsWith("http") ? z.url : null,
    popularity: popularity[z.id] || 0,
    tags: z.tags || [],
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
function isGameFavorite(id) { return getGameFavorites().includes(id); }

// State
let gamesAllZones   = [];   // all loaded zones across providers
let gamesFiltered   = [];   // after search/sort/filter
let gamesSort       = localStorage.getItem("mos_games_sort") || "popular";
let gamesFilter     = "all"; // "all" | "favorites" | provider key
let gamesSearch     = "";
let gamesLoading    = false;
let gamesPlayingId  = null; // id of currently playing game

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
          <option value="popular"  ${gamesSort==='popular' ?'selected':''}>Most Popular</option>
          <option value="name"     ${gamesSort==='name'    ?'selected':''}>Name (A–Z)</option>
          <option value="id"       ${gamesSort==='id'      ?'selected':''}>Newest First</option>
          <option value="featured" ${gamesSort==='featured'?'selected':''}>Featured First</option>
        </select>
      </div>

      <!-- Main content -->
      <div class="games-main">
        <!-- Top bar -->
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

        <!-- Grid -->
        <div class="games-grid" id="games-grid">
          <div class="games-loading" id="games-loading">
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

  // Load games
  gamesLoadAll();
}

async function gamesLoadAll() {
  gamesLoading = true;
  gamesAllZones = [];
  const gridEl = document.getElementById("games-grid");
  if (!gridEl) return;

  gridEl.innerHTML = `<div class="games-loading"><div class="games-spinner"></div><span>Loading games…</span></div>`;

  const results = await Promise.allSettled(
    Object.entries(GAME_PROVIDERS).map(async ([key, provider]) => {
      const zones = await provider.fetchZones();
      return zones;
    })
  );

  results.forEach((r) => {
    if (r.status === "fulfilled") gamesAllZones.push(...r.value);
  });

  gamesLoading = false;
  gamesApplyFilters();
}

function gamesApplyFilters() {
  let zones = [...gamesAllZones];

  // Filter by provider/favorites
  if (gamesFilter === "favorites") {
    const favs = getGameFavorites();
    zones = zones.filter((z) => favs.includes(z.id));
  } else if (gamesFilter !== "all") {
    zones = zones.filter((z) => z.provider === gamesFilter);
  }

  // Search
  if (gamesSearch.trim()) {
    const q = gamesSearch.toLowerCase();
    zones = zones.filter(
      (z) => z.name.toLowerCase().includes(q) || z.author.toLowerCase().includes(q)
    );
  }

  // Sort
  if (gamesSort === "popular") {
    zones.sort((a, b) => b.popularity - a.popularity);
  } else if (gamesSort === "name") {
    zones.sort((a, b) => a.name.localeCompare(b.name));
  } else if (gamesSort === "id") {
    zones.sort((a, b) => parseInt(b.id) - parseInt(a.id));
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

  if (countEl) countEl.textContent = `${gamesFiltered.length} game${gamesFiltered.length!==1?"s":""}`;

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
    const isFav = favs.includes(z.id);
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
        ${z.featured ? `<div class="games-card-badge">⬡ Featured</div>` : ""}
        <button class="games-card-fav ${isFav?"active":""}" onclick="event.stopPropagation();gamesToggleFav('${z.id}')" title="${isFav?"Remove from favorites":"Add to favorites"}">
          <svg width="11" height="11" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z" fill="${isFav?"currentColor":"none"}" stroke="currentColor" stroke-width="1.5"/></svg>
        </button>
      </div>
      <div class="games-card-info">
        <div class="games-card-name">${gamesEsc(z.name)}</div>
        <div class="games-card-meta">
          <span style="color:${provider?.color||"var(--text-dim)"}">●</span>
          ${gamesEsc(z.author)}
        </div>
      </div>
    </div>`;
  }).join("");

  // Lazy load images with IntersectionObserver
  const imgs = gridEl.querySelectorAll("img[loading=lazy]");
  if ("IntersectionObserver" in window) {
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          const img = e.target;
          obs.unobserve(img);
        }
      });
    }, { rootMargin: "200px" });
    imgs.forEach((img) => obs.observe(img));
  }
}

async function gamesPlay(id) {
  const zone = gamesAllZones.find((z) => z.id === id);
  if (!zone) return;

  // If it's an external link, open in the OS browser
  if (zone.externalUrl) {
    openBrowser();
    setTimeout(() => {
      const addr = document.getElementById("sj-address");
      if (addr) {
        addr.value = zone.externalUrl;
        document.getElementById("sj-go")?.click();
      }
    }, 120);
    return;
  }

  // Otherwise load the game HTML inline
  const playerEl     = document.getElementById("games-player");
  const frameWrapEl  = document.getElementById("games-player-frame");
  const titleEl      = document.getElementById("games-player-title");
  const gridEl       = document.getElementById("games-grid");
  const topbarEl     = document.querySelector("#win-games .games-topbar");
  if (!playerEl || !frameWrapEl) return;

  titleEl.textContent = zone.name;
  gamesPlayingId = id;

  // Show loading state
  frameWrapEl.innerHTML = `<div class="games-player-loading"><div class="games-spinner"></div><span>Loading ${gamesEsc(zone.name)}…</span></div>`;
  playerEl.style.display = "flex";
  gridEl.style.display   = "none";
  if (topbarEl) topbarEl.style.display = "none";

  try {
    // Fetch through our proxy to avoid CORS issues
    const proxyUrl = "/proxy/fetch?url=" + encodeURIComponent(zone.contentUrl + "?t=" + Date.now());
    const res  = await fetch(proxyUrl);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const html = await res.text();

    const iframe = document.createElement("iframe");
    iframe.style.cssText = "width:100%;height:100%;border:none;background:#000";
    iframe.sandbox = "allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads allow-pointer-lock";
    iframe.setAttribute("allow", "autoplay; fullscreen; encrypted-media; pointer-lock");
    frameWrapEl.innerHTML = "";
    frameWrapEl.appendChild(iframe);

    iframe.contentDocument.open();
    iframe.contentDocument.write(html);
    iframe.contentDocument.close();

    // Re-run any scripts the write() may have missed
    iframe.contentDocument.querySelectorAll("script").forEach((old) => {
      const s = iframe.contentDocument.createElement("script");
      if (old.src) s.src = old.src;
      else s.textContent = old.textContent;
      iframe.contentDocument.body?.appendChild(s);
    });

  } catch (err) {
    frameWrapEl.innerHTML = `<div class="games-player-loading" style="color:#ff6b6b">
      Failed to load game: ${gamesEsc(err.message)}<br>
      <button onclick="gamesPlay('${id}')" style="margin-top:12px;background:var(--gold);color:#000;border:none;border-radius:5px;padding:6px 16px;font-family:var(--mono);font-size:11px;cursor:pointer">Retry</button>
    </div>`;
  }
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
  // Update active state in sidebar
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
  // Update badge
  const badge = document.getElementById("games-fav-count");
  if (badge) badge.textContent = getGameFavorites().length;
  // Re-render without losing scroll
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
