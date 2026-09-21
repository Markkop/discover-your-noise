import "./style.css";
import {
  applySearchToState,
  readLocationSearch,
  syncUrlFromState,
} from "./url-state.mjs";

const API = (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");

const SEARCH_TYPES = [
  { id: "all", label: "All", types: ["playlist", "album", "artist", "track"] },
  { id: "playlist", label: "Playlists", types: ["playlist"] },
  { id: "album", label: "Albums", types: ["album"] },
  { id: "artist", label: "Artists", types: ["artist"] },
  { id: "track", label: "Tracks", types: ["track"] },
];

const LIBRARY_TABS = [
  { id: "recent", label: "Recently played" },
  { id: "liked", label: "Liked songs" },
  { id: "playlists", label: "Your playlists" },
];

const LIBRARY_PAGE_SIZE = 50;
const REPORT_PAGE_SIZE = 50;

function authUrl() {
  const returnTo = encodeURIComponent(window.location.href);
  return `${API}/api/auth/spotify?return_to=${returnTo}`;
}

const COPY_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;

const state = {
  me: null,
  loading: false,
  loadingLabel: "",
  progress: { pct: 0, message: "" },
  report: null,
  reportCached: false,
  analyzeContext: null,
  panelMode: "library",
  libraryTab: "recent",
  error: null,
  authRequired: null,
  searchQuery: "",
  searchType: "all",
  searchResults: null,
  searchLoading: false,
  library: { playlists: [], recent: [], liked: [] },
  libraryPage: { recent: 0, liked: 0, playlists: 0 },
  libraryMeta: {
    recent: { hasMore: false, nextBefore: null },
    liked: { total: 0, hasMore: false },
    playlists: { total: 0, hasMore: false },
  },
  recentBeforeByPage: [null],
  libraryLoading: false,
  reportPage: { genres: 0, artists: 0, tracks: 0 },
  selectedGenre: null,
  trackGenres: {},
  searchDebounce: null,
  urlDebounce: null,
};

const app = document.getElementById("app");

function syncUrl(options = {}) {
  syncUrlFromState(state, looksLikePlaylistUrl, options);
}

function applyUrlSearch(search = readLocationSearch()) {
  return applySearchToState(search, state, looksLikePlaylistUrl);
}

async function rebuildRecentCursors(targetPage) {
  state.recentBeforeByPage = [null];
  for (let page = 0; page < targetPage; page += 1) {
    const before = state.recentBeforeByPage[page];
    const beforeParam = before ? `&before=${encodeURIComponent(before)}` : "";
    const res = await api(`/api/library/recent?limit=${LIBRARY_PAGE_SIZE}${beforeParam}`);
    state.recentBeforeByPage[page + 1] = res.nextBefore ?? null;
  }
}

async function hydrateLibraryView() {
  if (!state.me?.connected) return;
  const recentPage = state.libraryPage.recent ?? 0;
  if (state.libraryTab === "recent" && recentPage > 0) {
    await rebuildRecentCursors(recentPage);
  }
  await loadLibraryTab(state.libraryTab);
}

async function hydrateFromUrl(mode) {
  if (!state.me?.connected) return;
  if (mode === "restore-report") {
    await restoreAnalysis();
    return;
  }
  if (mode === "search") {
    await performSearch();
    return;
  }
  await hydrateLibraryView();
}

async function handlePopState() {
  const mode = applyUrlSearch();
  render();
  await hydrateFromUrl(mode);
}

function pct(n, total) {
  if (!total) return "0%";
  return `${((n / total) * 100).toFixed(1)}%`;
}

function looksLikePlaylistUrl(value) {
  const v = String(value ?? "").trim();
  if (!v) return false;
  if (/^[A-Za-z0-9]{22}$/.test(v)) return true;
  if (/^spotify:playlist:[A-Za-z0-9]{22}$/i.test(v)) return true;
  return /^https?:\/\/([a-z]+\.)?spotify\.com\/(\w+\/)?playlist\/[A-Za-z0-9]{22}/i.test(v);
}

function formatDuration(ms) {
  if (!ms || ms < 0) return "—";
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok && !data.status) {
    throw new Error(data.error ?? `Request failed (${response.status})`);
  }
  return data;
}

async function loadMe() {
  state.me = await api("/api/me");
}

async function loadLibraryTab(tab = state.libraryTab) {
  if (!state.me?.connected) return;
  state.libraryLoading = true;
  render();
  try {
    const page = state.libraryPage[tab] ?? 0;
    if (tab === "recent") {
      const before = state.recentBeforeByPage[page];
      const beforeParam = before ? `&before=${encodeURIComponent(before)}` : "";
      const res = await api(`/api/library/recent?limit=${LIBRARY_PAGE_SIZE}${beforeParam}`);
      state.library.recent = res.tracks ?? [];
      state.libraryMeta.recent = {
        hasMore: Boolean(res.hasMore),
        nextBefore: res.nextBefore ?? null,
      };
    } else if (tab === "liked") {
      const offset = page * LIBRARY_PAGE_SIZE;
      const res = await api(`/api/library/liked?limit=${LIBRARY_PAGE_SIZE}&offset=${offset}`);
      state.library.liked = res.tracks ?? [];
      state.libraryMeta.liked = {
        total: res.total ?? state.library.liked.length,
        hasMore: Boolean(res.hasMore),
      };
    } else {
      const offset = page * LIBRARY_PAGE_SIZE;
      const res = await api(`/api/library/playlists?limit=${LIBRARY_PAGE_SIZE}&offset=${offset}`);
      state.library.playlists = res.playlists ?? [];
      state.libraryMeta.playlists = {
        total: res.total ?? state.library.playlists.length,
        hasMore: Boolean(res.hasMore),
      };
    }
  } catch (error) {
    state.error = error.message;
  } finally {
    state.libraryLoading = false;
    render();
  }
}

function paginateItems(items, page, pageSize = REPORT_PAGE_SIZE) {
  const total = items.length;
  const start = page * pageSize;
  const slice = items.slice(start, start + pageSize);
  return {
    slice,
    total,
    hasPrev: page > 0,
    hasMore: start + pageSize < total,
    rangeStart: total === 0 ? 0 : start + 1,
    rangeEnd: start + slice.length,
  };
}

function renderPaginationControls({
  page,
  hasPrev,
  hasMore,
  rangeStart,
  rangeEnd,
  total,
  action,
}) {
  if (!hasPrev && !hasMore) return "";
  const summary =
    total != null && total > 0
      ? `${rangeStart}–${rangeEnd} of ${total}`
      : hasPrev || hasMore
        ? `Page ${page + 1}`
        : "";
  return `
    <div class="table-pagination">
      <span class="pagination-summary muted-cell">${summary}</span>
      <div class="pagination-actions">
        <button type="button" class="secondary sm" data-${action}="prev" ${hasPrev ? "" : "disabled"}>Previous</button>
        <button type="button" class="secondary sm" data-${action}="next" ${hasMore ? "" : "disabled"}>Next</button>
      </div>
    </div>`;
}

function renderLibraryPagination(tab, itemCount) {
  const page = state.libraryPage[tab] ?? 0;
  const meta = state.libraryMeta[tab] ?? {};
  const hasPrev = page > 0;
  const hasMore = Boolean(meta.hasMore);
  const rangeStart = itemCount === 0 ? 0 : page * LIBRARY_PAGE_SIZE + 1;
  const rangeEnd = page * LIBRARY_PAGE_SIZE + itemCount;
  return renderPaginationControls({
    page,
    hasPrev,
    hasMore,
    rangeStart,
    rangeEnd,
    total: meta.total,
    action: "library-page",
  });
}

async function onLibraryPageChange(direction) {
  const tab = state.libraryTab;
  const page = state.libraryPage[tab] ?? 0;
  if (direction === "next") {
    if (!state.libraryMeta[tab]?.hasMore) return;
    if (tab === "recent") {
      const nextBefore = state.libraryMeta.recent.nextBefore;
      state.recentBeforeByPage[page + 1] = nextBefore;
    }
    state.libraryPage[tab] = page + 1;
  } else if (direction === "prev" && page > 0) {
    state.libraryPage[tab] = page - 1;
  } else {
    return;
  }
  await loadLibraryTab(tab);
  syncUrl({ history: "push" });
}

function render() {
  const connected = state.me?.connected;

  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand">
          <img class="brand-mark" src="/favicon.svg" width="36" height="36" alt="" />
          <div>
            <h1>Discover Your Noise</h1>
            <p class="tagline">Every Noise genres from your Spotify library</p>
          </div>
        </div>
        <div class="topbar-actions">
          ${
            connected
              ? `<div class="user-chip"><span class="user-dot"></span>${escapeHtml(state.me.displayName)}</div>
                 <button class="secondary sm" id="logout">Logout</button>`
              : `<a href="${authUrl()}"><button type="button" class="sm">Connect Spotify</button></a>`
          }
        </div>
      </header>

      ${connected ? renderBrowse() : renderGuest()}

      ${state.error ? `<div class="banner error">${escapeHtml(state.error)}</div>` : ""}
      ${state.authRequired ? `<div class="banner warn">${escapeHtml(state.authRequired)} <a href="${authUrl()}">Connect Spotify</a></div>` : ""}

      <footer>
        Every Noise is largely a historical genre snapshot; newer or obscure artists may lack direct mappings.
      </footer>
    </div>
    ${
      state.loading
        ? `<div class="loading-overlay" role="status" aria-live="polite">
             <div class="loading-card">
               <span class="spinner"></span>
               <div class="loading-body">
                 <span class="loading-message">${escapeHtml(state.progress.message || state.loadingLabel || "Analyzing…")}</span>
                 <div class="progress-track" aria-hidden="true">
                   <div class="progress-fill" style="width: ${Math.max(4, state.progress.pct)}%"></div>
                 </div>
                 <span class="progress-pct">${state.progress.pct}%</span>
               </div>
             </div>
           </div>`
        : ""
    }
  `;

  bindEvents();
}

function renderGuest() {
  return `
    <section class="hero card">
      <p class="lead">Connect Spotify to browse playlists, recently played tracks, and search your catalog — then analyze any collection for Every Noise genres.</p>
      <div class="search-row">
        <span class="search-icon" aria-hidden="true">⌕</span>
        <input type="text" id="search-input" placeholder="Paste a public Spotify playlist URL…" />
        <button id="analyze-url">Analyze</button>
      </div>
    </section>
  `;
}

function renderBrowse() {
  const isUrl = looksLikePlaylistUrl(state.searchQuery);
  const hasTextSearch = state.searchQuery.trim().length > 0 && !isUrl;

  return `
    <section class="browse">
      <div class="search-panel card">
        <div class="search-row">
          <span class="search-icon" aria-hidden="true">⌕</span>
          <input
            type="search"
            id="search-input"
            placeholder="Search or paste a Spotify playlist URL…"
            value="${escapeAttr(state.searchQuery)}"
            autocomplete="off"
          />
          ${state.searchQuery ? `<button class="icon-btn" id="clear-search" type="button" aria-label="Clear">×</button>` : ""}
          ${isUrl ? `<button type="button" id="analyze-url">Analyze</button>` : ""}
        </div>
        ${
          isUrl
            ? `<p class="input-hint">Playlist URL detected — press Analyze or Enter.</p>`
            : `
        <div class="filter-pills" role="tablist" aria-label="Search filters">
          ${SEARCH_TYPES.map(
            (filter) => `
            <button
              type="button"
              class="pill ${state.searchType === filter.id ? "active" : ""}"
              data-search-type="${filter.id}"
              role="tab"
              aria-selected="${state.searchType === filter.id}"
            >${filter.label}</button>`,
          ).join("")}
        </div>`
        }
      </div>

      ${hasTextSearch ? renderMainPanel("search") : renderMainPanel(state.panelMode)}
    </section>
  `;
}

function renderMainPanel(mode) {
  if (state.libraryLoading && mode === "library") {
    return `<p class="muted-note card">Loading your library…</p>`;
  }

  if (mode === "search") {
    return renderSearchPanel();
  }

  if (mode === "report" && state.report) {
    return renderReportPanel();
  }

  return renderLibraryPanel();
}

function renderLibraryTabs() {
  return `
    <nav class="library-tabs" aria-label="Library views">
      ${LIBRARY_TABS.map((tab, index) => {
        const active = state.libraryTab === tab.id;
        const prefix = index > 0 ? `<span class="tab-sep">/</span>` : "";
        return `${prefix}<button type="button" class="library-tab ${active ? "active" : ""}" data-library-tab="${tab.id}">${escapeHtml(tab.label)}</button>`;
      }).join("")}
    </nav>
  `;
}

function renderAnalyzeActions() {
  if (state.libraryTab === "recent") {
    return `
      <div class="analyze-actions">
        <button type="button" class="secondary sm" data-analyze-batch="recent" data-limit="50">Analyze 50</button>
      </div>`;
  }
  if (state.libraryTab === "liked") {
    return `
      <div class="analyze-actions">
        <button type="button" class="secondary sm" data-analyze-batch="liked" data-limit="50">Analyze 50</button>
        <button type="button" class="secondary sm" data-analyze-batch="liked" data-limit="100">Analyze 100</button>
        <button type="button" class="secondary sm" data-analyze-batch="liked" data-limit="200">Analyze 200</button>
        <button type="button" class="secondary sm" data-analyze-batch="liked" data-limit="all">All</button>
      </div>`;
  }
  return "";
}

function renderLibraryPanel() {
  const analyzeActions = renderAnalyzeActions();
  return `
    <div class="main-panel card">
      <div class="panel-head">
        ${renderLibraryTabs()}
        ${analyzeActions}
      </div>
      <div class="table-wrap">
        ${renderLibraryTable()}
      </div>
    </div>
  `;
}

function thumbInner(image, small = false) {
  return image
    ? `<img src="${escapeAttr(image)}" alt="" loading="lazy" />`
    : `<span class="cover-fallback${small ? " sm" : ""}">♫</span>`;
}

function thumbCell(image, label = "") {
  return `<td class="thumb-col desktop-only"><div class="thumb" title="${escapeAttr(label)}">${thumbInner(image)}</div></td>`;
}

function trackSubtitle(track) {
  return [track.artists, track.album].filter(Boolean).join(" · ") || "—";
}

function copyBtn(copyText, label = "text") {
  if (!copyText || copyText === "—") return "";
  return `<button type="button" class="copy-btn" data-copy-text="${escapeAttr(copyText)}" aria-label="Copy ${escapeAttr(label)}" title="Copy">${COPY_ICON}</button>`;
}

function copyableContent(innerHtml, copyText, label = "text") {
  if (!copyText || copyText === "—") return innerHtml;
  return `<span class="copyable-wrap"><span class="copyable-text">${innerHtml}</span>${copyBtn(copyText, label)}</span>`;
}

function copyableCell(innerHtml, copyText, { className = "", label = "text" } = {}) {
  const classes = ["copyable-cell", className].filter(Boolean).join(" ");
  return `<td class="${classes}">${copyableContent(innerHtml, copyText, label)}</td>`;
}

function copyableInline(innerHtml, copyText, label = "text") {
  if (!copyText || copyText === "—") return innerHtml;
  return `<span class="copyable-inline">${innerHtml}${copyBtn(copyText, label)}</span>`;
}

function renderGenreContent(trackId, presetGenres) {
  if (presetGenres !== undefined) {
    const text = presetGenres.join(", ") || "—";
    return copyableContent(escapeHtml(text), text, "genres");
  }
  if (!trackId) return `<span class="muted-cell">—</span>`;
  const entry = state.trackGenres[trackId];
  if (!entry) {
    return `<button type="button" class="secondary sm" data-analyze-track="${escapeAttr(trackId)}">Analyze</button>`;
  }
  if (entry.loading) {
    return `<span class="muted-cell"><span class="inline-spinner"></span>Analyzing…</span>`;
  }
  if (entry.error) {
    return `<button type="button" class="secondary sm" data-analyze-track="${escapeAttr(trackId)}" title="${escapeAttr(entry.error)}">Retry</button>`;
  }
  const text = (entry.genres ?? []).join(", ") || "—";
  return copyableContent(escapeHtml(text), text, "genres");
}

function playlistSubtitle(playlist) {
  const parts = [];
  if (playlist.owner) parts.push(playlist.owner);
  if (playlist.trackCount != null) parts.push(`${playlist.trackCount} tracks`);
  return parts.join(" · ") || "—";
}

function renderPlaylistRow(playlist) {
  const titleInner = playlist.url
    ? `<a class="row-link" href="${escapeAttr(playlist.url)}" target="_blank" rel="noreferrer">${escapeHtml(playlist.name)}</a>`
    : escapeHtml(playlist.name);
  const subtitle = playlistSubtitle(playlist);
  return `
    <tr class="track-row playlist-row">
      ${thumbCell(playlist.image, playlist.name)}
      <td class="col-track copyable-cell">
        <div class="track-mobile-only track-list-row">
          <div class="list-cover">${thumbInner(playlist.image, true)}</div>
          <div class="list-meta">
            <div class="list-title">${copyableContent(titleInner, playlist.name, "playlist")}</div>
            <div class="list-sub">${copyableContent(escapeHtml(subtitle), subtitle, "playlist details")}</div>
            <div class="track-genre-line">
              <button type="button" class="secondary sm" data-analyze-playlist="${escapeAttr(playlist.id)}">Analyze</button>
            </div>
          </div>
        </div>
        <div class="track-desktop-only">${copyableContent(titleInner, playlist.name, "playlist")}</div>
      </td>
      ${copyableCell(escapeHtml(playlist.owner || "—"), playlist.owner || "", {
        className: "muted-cell desktop-only col-owner",
        label: "owner",
      })}
      <td class="num muted-cell desktop-only col-tracks">${playlist.trackCount}</td>
      <td class="action-col desktop-only">
        <button type="button" class="secondary sm" data-analyze-playlist="${escapeAttr(playlist.id)}">Analyze</button>
      </td>
    </tr>`;
}

function renderTrackRow(track, { presetGenres } = {}) {
  const titleInner = track.url
    ? `<a class="row-link" href="${escapeAttr(track.url)}" target="_blank" rel="noreferrer">${escapeHtml(track.name)}</a>`
    : escapeHtml(track.name);
  const album = track.album || "—";
  const subtitle = trackSubtitle(track);
  const genrePreset = presetGenres ?? track.genres;
  return `
    <tr class="track-row">
      ${thumbCell(track.image, track.name)}
      <td class="col-track copyable-cell">
        <div class="track-mobile-only track-list-row">
          <div class="list-cover">${thumbInner(track.image, true)}</div>
          <div class="list-meta">
            <div class="list-title">${copyableContent(titleInner, track.name, "track")}</div>
            <div class="list-sub">${copyableContent(escapeHtml(subtitle), subtitle, "track details")}</div>
            <div class="track-genre-line">${renderGenreContent(track.id, genrePreset)}</div>
          </div>
        </div>
        <div class="track-desktop-only">${copyableContent(titleInner, track.name, "track")}</div>
      </td>
      ${copyableCell(escapeHtml(track.artists), track.artists, { className: "muted-cell desktop-only col-artist", label: "artist" })}
      ${copyableCell(escapeHtml(album), album, { className: "muted-cell desktop-only col-album", label: "album" })}
      <td class="num muted-cell desktop-only col-duration">${formatDuration(track.durationMs)}</td>
      <td class="genre-col desktop-only">${renderGenreContent(track.id, genrePreset)}</td>
    </tr>`;
}

function renderLibraryTable() {
  const { recent, liked, playlists } = state.library;

  if (state.libraryTab === "recent") {
    if (recent.length === 0) return `<p class="muted-note">No recently played tracks.</p>`;
    return `
      <table class="data-table tracks-table">
        <thead>
          <tr>
            <th class="thumb-col desktop-only"></th>
            <th>Track</th>
            <th class="desktop-only">Artist</th>
            <th class="desktop-only">Album</th>
            <th class="num desktop-only">Duration</th>
            <th class="desktop-only">Genre</th>
          </tr>
        </thead>
        <tbody>
          ${recent.map((track) => renderTrackRow(track)).join("")}
        </tbody>
      </table>
      ${renderLibraryPagination("recent", recent.length)}
    `;
  }

  if (state.libraryTab === "liked") {
    if (liked.length === 0) return `<p class="muted-note">No liked songs.</p>`;
    return `
      <table class="data-table tracks-table">
        <thead>
          <tr>
            <th class="thumb-col desktop-only"></th>
            <th>Track</th>
            <th class="desktop-only">Artist</th>
            <th class="desktop-only">Album</th>
            <th class="num desktop-only">Duration</th>
            <th class="desktop-only">Genre</th>
          </tr>
        </thead>
        <tbody>
          ${liked.map((track) => renderTrackRow(track)).join("")}
        </tbody>
      </table>
      ${renderLibraryPagination("liked", liked.length)}
    `;
  }

  if (playlists.length === 0) return `<p class="muted-note">No playlists found.</p>`;
  return `
    <table class="data-table tracks-table playlists-table">
      <thead>
        <tr>
          <th class="thumb-col desktop-only"></th>
          <th>Playlist</th>
          <th class="desktop-only">Owner</th>
          <th class="num desktop-only">Tracks</th>
          <th class="action-col desktop-only"></th>
        </tr>
      </thead>
      <tbody>
        ${playlists.map((playlist) => renderPlaylistRow(playlist)).join("")}
      </tbody>
    </table>
    ${renderLibraryPagination("playlists", playlists.length)}
  `;
}

function renderSearchPanel() {
  if (state.searchLoading) {
    return `<div class="main-panel card"><p class="muted-note">Searching…</p></div>`;
  }
  if (!state.searchResults) {
    return `<div class="main-panel card"><p class="muted-note">Type to search your Spotify catalog.</p></div>`;
  }

  const rows = [];
  const addRows = (items, type) => {
    for (const item of items ?? []) {
      rows.push({ item, type });
    }
  };

  if (state.searchType === "all") {
    addRows(state.searchResults.playlists, "playlist");
    addRows(state.searchResults.albums, "album");
    addRows(state.searchResults.artists, "artist");
    addRows(state.searchResults.tracks, "track");
  } else {
    const key = searchResultKey(state.searchType);
    addRows(state.searchResults[key], state.searchType);
  }

  if (rows.length === 0) {
    return `<div class="main-panel card"><p class="muted-note">No results for "${escapeHtml(state.searchQuery)}".</p></div>`;
  }

  return `
    <div class="main-panel card">
      <div class="panel-head">
        <h2 class="panel-title">Search results</h2>
        <span class="hint inline">${rows.length} items</span>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th class="thumb-col"></th>
              <th>Type</th>
              <th>Name</th>
              <th>Details</th>
              <th class="action-col"></th>
            </tr>
          </thead>
          <tbody>
            ${rows
              .map(({ item, type }) => {
                const canAnalyze = type !== "track";
                return `
              <tr>
                ${thumbCell(item.image, item.name)}
                ${copyableCell(escapeHtml(type), type, { className: "muted-cell type-cell", label: "type" })}
                ${copyableCell(
                  item.url
                    ? `<a class="row-link" href="${escapeAttr(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.name)}</a>`
                    : escapeHtml(item.name),
                  item.name,
                  { label: "name" },
                )}
                ${copyableCell(escapeHtml(item.subtitle ?? "—"), item.subtitle ?? "", {
                  className: "muted-cell",
                  label: "details",
                })}
                <td class="action-col">
                  ${
                    canAnalyze
                      ? `<button type="button" class="secondary sm" data-analyze-type="${escapeAttr(type)}" data-analyze-id="${escapeAttr(item.id)}">Analyze</button>`
                      : `<span class="muted-cell">—</span>`
                  }
                </td>
              </tr>`;
              })
              .join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderReportPanel() {
  const report = state.report;
  const p = report.playlist;
  const total = report.artistCount;
  const tracks = report.tracks ?? [];
  const tracksSection =
    tracks.length > 0
      ? `
      <section class="report-tracks-section">
        <h3 class="report-section-title">Tracks</h3>
        <div class="table-wrap">${renderReportTracksTable(report)}</div>
      </section>`
      : "";

  return `
    <div class="main-panel card report-panel">
      <div class="panel-head">
        <div class="report-title-block">
          <button type="button" class="text-btn" id="back-to-list">← Back</button>
          <h2 class="panel-title">${copyableInline(escapeHtml(p.title), p.title, "title")}</h2>
          ${p.url ? copyableInline(`<a class="report-link" href="${escapeAttr(p.url)}" target="_blank" rel="noreferrer">Open in Spotify</a>`, p.url, "link") : ""}
        </div>
      </div>

      <div class="report-meta">
        <span>${p.expectedTrackCount ?? "—"} tracks</span>
        <span>${total} artists</span>
        <span>${report.directArtists.length} direct (${pct(report.directArtists.length, total)})</span>
        <span>${report.inferredArtists.length} inferred (${pct(report.inferredArtists.length, total)})</span>
        <span>${report.unmappedArtists.length} unmapped (${pct(report.unmappedArtists.length, total)})</span>
        ${
          state.reportCached
            ? `<button type="button" class="cache-tag" id="refresh-cached-analysis" title="Clear cache and analyze again">cached</button>`
            : ""
        }
      </div>

      <div class="report-split">
        <section class="report-column">
          <div class="table-wrap">${renderGenresTable(report)}</div>
        </section>
        <section class="report-column">
          <div class="table-wrap">${renderArtistsTable(report)}</div>
        </section>
      </div>
      ${tracksSection}
    </div>
  `;
}

function searchResultKey(type) {
  const map = { playlist: "playlists", album: "albums", artist: "artists", track: "tracks" };
  return map[type] ?? "playlists";
}

function allArtists(report) {
  return [
    ...report.directArtists,
    ...report.inferredArtists,
    ...report.unmappedArtists,
  ].sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
}

function coverageLabel(kind) {
  if (kind === "direct") return "Direct";
  if (kind === "inferred") return "Inferred";
  return "Unmapped";
}

function renderSelectableGenre(genre) {
  const selected = state.selectedGenre === genre;
  return `<button type="button" class="genre-tag ${selected ? "selected" : ""}" data-select-genre="${escapeAttr(genre)}">${escapeHtml(genre)}</button>`;
}

function filteredArtists(report) {
  const artists = allArtists(report);
  if (!state.selectedGenre) return artists;
  return artists.filter((artist) => (artist.genres ?? []).includes(state.selectedGenre));
}

function filteredTracks(report) {
  const tracks = report.tracks ?? [];
  if (!state.selectedGenre) return tracks;
  return tracks.filter((track) => (track.genres ?? []).includes(state.selectedGenre));
}

function renderArtistGenresCell(genres) {
  if (!genres.length) return `<td class="muted-cell genres-cell">—</td>`;
  const tags = genres
    .map((genre, index) => {
      const sep = index > 0 ? `<span class="genre-sep">, </span>` : "";
      return `${sep}${renderSelectableGenre(genre)}`;
    })
    .join("");
  const copyText = genres.join(", ");
  return `<td class="muted-cell genres-cell copyable-cell"><span class="genre-tags">${tags}</span>${copyBtn(copyText, "genres")}</td>`;
}

function onSelectGenre(genre) {
  if (!genre) return;
  state.selectedGenre = state.selectedGenre === genre ? null : genre;
  state.reportPage.artists = 0;
  state.reportPage.tracks = 0;
  render();
}

function renderGenresTable(report) {
  const page = state.reportPage.genres;
  const { slice, total, hasPrev, hasMore, rangeStart, rangeEnd } = paginateItems(
    report.genres,
    page,
  );
  return `
    <table class="data-table">
      <thead>
        <tr><th>Genre</th><th class="num">Direct</th><th class="num">Inferred</th><th class="num">Total</th><th class="num">Share</th></tr>
      </thead>
      <tbody>
        ${slice
          .map(
            (g) => `
          <tr class="${state.selectedGenre === g.genre ? "genre-row-selected" : ""}">
            ${copyableCell(renderSelectableGenre(g.genre), g.genre, { label: "genre" })}
            <td class="num">${g.direct}</td>
            <td class="num">${g.inferred}</td>
            <td class="num">${g.total}</td>
            <td class="num muted-cell">${pct(g.total, report.artistCount)}</td>
          </tr>`,
          )
          .join("")}
      </tbody>
    </table>
    ${renderPaginationControls({
      page,
      hasPrev,
      hasMore,
      rangeStart,
      rangeEnd,
      total,
      action: "report-page-genres",
    })}
  `;
}

function renderArtistsTable(report) {
  const artists = filteredArtists(report);
  const page = state.reportPage.artists;
  const { slice, total, hasPrev, hasMore, rangeStart, rangeEnd } = paginateItems(artists, page);
  return `
    <table class="data-table artists-table">
      <thead>
        <tr>
          <th>Artist</th>
          <th>Coverage</th>
          <th class="num">Genres</th>
          <th>Every Noise genres</th>
        </tr>
      </thead>
      <tbody>
        ${slice
          .map((artist) => {
            const genres = artist.genres ?? [];
            const spotifyUrl = `https://open.spotify.com/artist/${artist.id}`;
            return `
          <tr>
            ${copyableCell(
              `<a class="row-link" href="${escapeAttr(spotifyUrl)}" target="_blank" rel="noreferrer">${escapeHtml(artist.name)}</a>`,
              artist.name,
              { label: "artist" },
            )}
            <td><span class="badge badge-${escapeAttr(artist.kind)}">${coverageLabel(artist.kind)}</span></td>
            <td class="num">${genres.length}</td>
            ${renderArtistGenresCell(genres)}
          </tr>`;
          })
          .join("")}
      </tbody>
    </table>
    ${renderPaginationControls({
      page,
      hasPrev,
      hasMore,
      rangeStart,
      rangeEnd,
      total,
      action: "report-page-artists",
    })}
  `;
}

function renderReportTracksTable(report) {
  const tracks = filteredTracks(report);
  const page = state.reportPage.tracks;
  const { slice, total, hasPrev, hasMore, rangeStart, rangeEnd } = paginateItems(tracks, page);
  if (total === 0) {
    return `<p class="muted-note">No tracks match the selected genre.</p>`;
  }
  return `
    <table class="data-table tracks-table">
      <thead>
        <tr>
          <th class="thumb-col desktop-only"></th>
          <th>Track</th>
          <th class="desktop-only">Artist</th>
          <th class="desktop-only">Album</th>
          <th class="num desktop-only">Duration</th>
          <th class="desktop-only">Genre</th>
        </tr>
      </thead>
      <tbody>
        ${slice.map((track) => renderTrackRow(track)).join("")}
      </tbody>
    </table>
    ${renderPaginationControls({
      page,
      hasPrev,
      hasMore,
      rangeStart,
      rangeEnd,
      total,
      action: "report-page-tracks",
    })}
  `;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

function parseSseChunk(chunk) {
  const lines = chunk.split("\n");
  let name = "message";
  let data = "";
  for (const line of lines) {
    if (line.startsWith("event:")) name = line.slice(6).trim();
    if (line.startsWith("data:")) data += line.slice(5).trim();
  }
  if (!data) return null;
  return { name, data: JSON.parse(data) };
}

async function analyzeStream(path, body = {}) {
  const response = await fetch(`${API}${path}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({ ...body, stream: true }),
  });

  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok && contentType.includes("application/json")) {
    const data = await response.json();
    throw new Error(data.error ?? `Request failed (${response.status})`);
  }
  if (!response.ok) {
    throw new Error(`Request failed (${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const event = parseSseChunk(chunk);
      if (!event) continue;
      if (event.name === "progress") {
        state.progress = {
          pct: event.data.pct ?? 0,
          message: event.data.message ?? "Analyzing…",
        };
        render();
      } else if (event.name === "complete") {
        result = event.data;
      } else if (event.name === "error") {
        throw new Error(event.data.error ?? "Analysis failed.");
      }
    }
  }

  if (!result) throw new Error("Analysis ended without a result.");
  return result;
}

async function runAnalysis(label, path, body = {}, { restore = false, refresh = false } = {}) {
  const { refresh: _drop, ...persistBody } = body ?? {};
  state.analyzeContext = { path, body: persistBody, label };
  state.loading = true;
  state.loadingLabel = refresh ? "Refreshing analysis…" : label;
  state.progress = { pct: 0, message: refresh ? "Refreshing analysis…" : label };
  state.error = null;
  state.authRequired = null;
  state.report = null;
  state.reportCached = false;
  state.selectedGenre = null;
  render();
  try {
    const result = await analyzeStream(path, { ...persistBody, ...(refresh ? { refresh: true } : {}) });
    if (result.status === "auth_required") {
      state.authRequired = result.message;
    } else if (result.status === "ok") {
      state.report = result.report;
      state.reportCached = Boolean(result.cached);
      if (!restore) {
        state.reportPage = { genres: 0, artists: 0, tracks: 0 };
      }
      state.panelMode = "report";
      syncUrl({ history: "push" });
    } else {
      state.error = result.error ?? "Analysis failed.";
    }
  } catch (error) {
    state.error = error.message;
  } finally {
    state.loading = false;
    state.loadingLabel = "";
    state.progress = { pct: 0, message: "" };
    render();
  }
}

async function restoreAnalysis() {
  if (!state.analyzeContext) return;
  const { label, path, body } = state.analyzeContext;
  await runAnalysis(label, path, body ?? {}, { restore: true });
}

async function onRefreshCachedAnalysis() {
  if (!state.analyzeContext || state.loading || !state.reportCached) return;
  const { label, path, body } = state.analyzeContext;
  await runAnalysis(label, path, body ?? {}, { restore: true, refresh: true });
}

async function onAnalyzeUrl() {
  const input = document.getElementById("search-input");
  const url = input?.value?.trim();
  if (!url) return;
  await runAnalysis("Analyzing playlist…", "/api/analyze", { url });
}

async function onAnalyzeBatch(kind, limit) {
  const path = kind === "liked" ? "/api/analyze/liked" : "/api/analyze/recent";
  const label =
    limit === "all"
      ? "Analyzing all liked songs…"
      : `Analyzing latest ${limit}…`;
  const body = limit === "all" ? { limit: "all" } : { limit: Number(limit) };
  await runAnalysis(label, path, body);
}

async function onAnalyzePlaylist(id) {
  await runAnalysis("Analyzing playlist…", "/api/analyze/playlist", { id });
}

async function onAnalyzeTrack(trackId) {
  if (!trackId || state.trackGenres[trackId]?.loading) return;
  state.trackGenres[trackId] = { loading: true };
  render();
  try {
    const result = await api("/api/analyze/track", {
      method: "POST",
      body: JSON.stringify({ id: trackId }),
    });
    if (result.status === "ok") {
      state.trackGenres[trackId] = { genres: result.genres ?? [] };
    } else if (result.status === "auth_required") {
      state.authRequired = result.message;
      delete state.trackGenres[trackId];
    } else {
      state.trackGenres[trackId] = { error: result.error ?? "Analysis failed." };
    }
  } catch (error) {
    state.trackGenres[trackId] = { error: error.message };
  }
  render();
}

async function onAnalyzeTyped(type, id) {
  const endpoints = {
    playlist: "/api/analyze/playlist",
    album: "/api/analyze/album",
    artist: "/api/analyze/artist",
  };
  if (type === "track") {
    state.error = "Track analysis is not supported — try the album or artist.";
    render();
    return;
  }
  await runAnalysis("Analyzing…", endpoints[type], { id });
}

async function performSearch() {
  const query = state.searchQuery.trim();
  if (!query || looksLikePlaylistUrl(query)) {
    state.searchResults = null;
    render();
    return;
  }
  const filter = SEARCH_TYPES.find((f) => f.id === state.searchType) ?? SEARCH_TYPES[0];
  state.searchLoading = true;
  state.panelMode = "library";
  render();
  try {
    const typeParam = filter.types.join(",");
    state.searchResults = await api(
      `/api/search?q=${encodeURIComponent(query)}&type=${typeParam}&limit=12`,
    );
  } catch (error) {
    state.error = error.message;
    state.searchResults = null;
  } finally {
    state.searchLoading = false;
    render();
    syncUrl();
  }
}

function scheduleSearch() {
  clearTimeout(state.searchDebounce);
  state.searchDebounce = setTimeout(performSearch, 300);
}

function scheduleUrlSync() {
  clearTimeout(state.urlDebounce);
  state.urlDebounce = setTimeout(() => syncUrl(), 200);
}

function bindEvents() {
  document.getElementById("analyze-url")?.addEventListener("click", onAnalyzeUrl);
  document.getElementById("logout")?.addEventListener("click", onLogout);
  document.querySelectorAll("[data-analyze-batch]").forEach((button) => {
    button.addEventListener("click", () =>
      onAnalyzeBatch(button.dataset.analyzeBatch, button.dataset.limit),
    );
  });
  document.getElementById("back-to-list")?.addEventListener("click", () => {
    state.panelMode = "library";
    state.report = null;
    state.analyzeContext = null;
    state.selectedGenre = null;
    render();
    syncUrl({ history: "push" });
  });
  document.getElementById("refresh-cached-analysis")?.addEventListener("click", onRefreshCachedAnalysis);

  document.getElementById("search-input")?.addEventListener("input", (event) => {
    state.searchQuery = event.target.value;
    if (looksLikePlaylistUrl(state.searchQuery)) {
      state.searchResults = null;
      render();
      scheduleUrlSync();
      return;
    }
    scheduleSearch();
    scheduleUrlSync();
  });

  document.getElementById("search-input")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && looksLikePlaylistUrl(state.searchQuery)) {
      event.preventDefault();
      onAnalyzeUrl();
    }
  });

  document.getElementById("clear-search")?.addEventListener("click", () => {
    state.searchQuery = "";
    state.searchResults = null;
    state.panelMode = "library";
    state.analyzeContext = null;
    render();
    syncUrl({ history: "push" });
  });

  document.querySelectorAll("[data-search-type]").forEach((button) => {
    button.addEventListener("click", () => {
      state.searchType = button.dataset.searchType;
      if (state.searchQuery.trim() && !looksLikePlaylistUrl(state.searchQuery)) performSearch();
      else {
        render();
        syncUrl({ history: "push" });
      }
    });
  });

  document.querySelectorAll("[data-library-tab]").forEach((button) => {
    button.addEventListener("click", async () => {
      const tab = button.dataset.libraryTab;
      state.panelMode = "library";
      state.report = null;
      state.analyzeContext = null;
      if (state.libraryTab !== tab) {
        state.libraryTab = tab;
        await loadLibraryTab(tab);
        syncUrl({ history: "push" });
        return;
      }
      render();
      syncUrl({ history: "push" });
    });
  });

  document.querySelectorAll("[data-library-page]").forEach((button) => {
    button.addEventListener("click", () => onLibraryPageChange(button.dataset.libraryPage));
  });

  document.querySelectorAll("[data-report-page-genres]").forEach((button) => {
    button.addEventListener("click", () => {
      const direction = button.dataset.reportPageGenres;
      const page = state.reportPage.genres;
      if (direction === "next" && (page + 1) * REPORT_PAGE_SIZE < (state.report?.genres?.length ?? 0)) {
        state.reportPage.genres = page + 1;
        render();
        syncUrl({ history: "push" });
      } else if (direction === "prev" && page > 0) {
        state.reportPage.genres = page - 1;
        render();
        syncUrl({ history: "push" });
      }
    });
  });

  document.querySelectorAll("[data-report-page-artists]").forEach((button) => {
    button.addEventListener("click", () => {
      const direction = button.dataset.reportPageArtists;
      const page = state.reportPage.artists;
      const total = filteredArtists(
        state.report ?? { directArtists: [], inferredArtists: [], unmappedArtists: [] },
      ).length;
      if (direction === "next" && (page + 1) * REPORT_PAGE_SIZE < total) {
        state.reportPage.artists = page + 1;
        render();
        syncUrl({ history: "push" });
      } else if (direction === "prev" && page > 0) {
        state.reportPage.artists = page - 1;
        render();
        syncUrl({ history: "push" });
      }
    });
  });

  document.querySelectorAll("[data-report-page-tracks]").forEach((button) => {
    button.addEventListener("click", () => {
      const direction = button.dataset.reportPageTracks;
      const page = state.reportPage.tracks;
      const total = filteredTracks(state.report ?? { tracks: [] }).length;
      if (direction === "next" && (page + 1) * REPORT_PAGE_SIZE < total) {
        state.reportPage.tracks = page + 1;
        render();
        syncUrl({ history: "push" });
      } else if (direction === "prev" && page > 0) {
        state.reportPage.tracks = page - 1;
        render();
        syncUrl({ history: "push" });
      }
    });
  });

  document.querySelectorAll("[data-analyze-playlist]").forEach((button) => {
    button.addEventListener("click", () => onAnalyzePlaylist(button.dataset.analyzePlaylist));
  });

  document.querySelectorAll("[data-analyze-type]").forEach((button) => {
    button.addEventListener("click", () =>
      onAnalyzeTyped(button.dataset.analyzeType, button.dataset.analyzeId),
    );
  });

  document.querySelectorAll("[data-analyze-track]").forEach((button) => {
    button.addEventListener("click", () => onAnalyzeTrack(button.dataset.analyzeTrack));
  });

  document.querySelectorAll("[data-copy-text]").forEach((button) => {
    button.addEventListener("click", () => onCopyText(button));
  });

  document.querySelectorAll("[data-select-genre]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      onSelectGenre(button.dataset.selectGenre);
    });
  });
}

async function onCopyText(button) {
  const text = button.dataset.copyText;
  if (!text) return;
  const prevTitle = button.title;
  try {
    await navigator.clipboard.writeText(text);
    button.classList.add("copied");
    button.title = "Copied!";
    setTimeout(() => {
      button.classList.remove("copied");
      button.title = prevTitle || "Copy";
    }, 1500);
  } catch {
    state.error = "Could not copy to clipboard.";
    render();
  }
}

async function onLogout() {
  await api("/api/auth/logout", { method: "POST" });
  state.me = { connected: false };
  state.library = { playlists: [], recent: [], liked: [] };
  state.searchResults = null;
  state.searchQuery = "";
  state.panelMode = "library";
  state.report = null;
  state.analyzeContext = null;
  state.trackGenres = {};
  render();
  syncUrl();
}

async function init() {
  const mode = applyUrlSearch();
  await loadMe();
  render();
  if (state.me?.connected) {
    await hydrateFromUrl(mode);
  }
  syncUrl();
  window.addEventListener("popstate", () => {
    void handlePopState();
  });
}

init();
