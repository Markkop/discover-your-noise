import { defaultParseSearch, defaultStringifySearch } from "@tanstack/router-core";

const LIBRARY_TAB_IDS = ["recent", "liked", "playlists"];
const SEARCH_TYPE_IDS = ["all", "playlist", "album", "artist", "track"];

let lastWrittenSearch = "";

export function readLocationSearch() {
  const search = defaultParseSearch(window.location.search);
  if (search.auth === "ok") {
    delete search.auth;
  }
  return search;
}

export function writeLocationSearch(search, { history = "replace" } = {}) {
  const next = defaultStringifySearch(search);
  const url = `${window.location.pathname}${next}${window.location.hash}`;
  if (next === lastWrittenSearch && history === "replace") return;
  lastWrittenSearch = next;
  if (history === "push") {
    window.history.pushState(null, "", url);
  } else {
    window.history.replaceState(null, "", url);
  }
}

function compactLibraryPages(pages) {
  const compact = {};
  for (const tab of LIBRARY_TAB_IDS) {
    const page = Number(pages?.[tab] ?? 0);
    if (page > 0) compact[tab] = page;
  }
  return Object.keys(compact).length > 0 ? compact : null;
}

export function buildSearchFromState(state, looksLikePlaylistUrl) {
  const search = {};
  const query = state.searchQuery.trim();
  if (query) search.q = query;

  const hasTextSearch = query && !looksLikePlaylistUrl(query);
  if (hasTextSearch) {
    if (state.searchType !== "all") search.stype = state.searchType;
    return search;
  }

  if (state.panelMode === "report" && state.report && state.analyzeContext?.path) {
    search.view = "report";
    search.analyze = state.analyzeContext;
    if (state.reportPage.genres > 0) search.gp = state.reportPage.genres;
    if (state.reportPage.artists > 0) search.ap = state.reportPage.artists;
    if (state.reportPage.tracks > 0) search.tp = state.reportPage.tracks;
    return search;
  }

  if (state.libraryTab !== "recent") search.tab = state.libraryTab;
  const pages = compactLibraryPages(state.libraryPage);
  if (pages) search.pages = pages;
  return search;
}

/**
 * @returns {'library' | 'search' | 'restore-report'}
 */
export function applySearchToState(search, state, looksLikePlaylistUrl) {
  const query = typeof search.q === "string" ? search.q.trim() : "";
  state.searchQuery = query;

  const stype = typeof search.stype === "string" ? search.stype : "all";
  state.searchType = SEARCH_TYPE_IDS.includes(stype) ? stype : "all";

  state.libraryPage = { recent: 0, liked: 0, playlists: 0 };
  state.recentBeforeByPage = [null];
  if (search.pages && typeof search.pages === "object") {
    for (const tab of LIBRARY_TAB_IDS) {
      const page = Number(search.pages[tab]);
      if (Number.isFinite(page) && page >= 0) {
        state.libraryPage[tab] = Math.floor(page);
      }
    }
  }

  state.reportPage = {
    genres: Math.max(0, Number(search.gp) || 0),
    artists: Math.max(0, Number(search.ap) || 0),
    tracks: Math.max(0, Number(search.tp) || 0),
  };

  const hasTextSearch = query && !looksLikePlaylistUrl(query);
  if (hasTextSearch) {
    state.panelMode = "library";
    state.report = null;
    state.analyzeContext = null;
    return "search";
  }

  if (search.view === "report" && search.analyze?.path) {
    state.panelMode = "report";
    state.report = null;
    state.analyzeContext = search.analyze;
    return "restore-report";
  }

  if (typeof search.tab === "string" && LIBRARY_TAB_IDS.includes(search.tab)) {
    state.libraryTab = search.tab;
  }

  state.panelMode = "library";
  state.report = null;
  state.analyzeContext = null;
  return "library";
}

export function syncUrlFromState(state, looksLikePlaylistUrl, options = {}) {
  writeLocationSearch(buildSearchFromState(state, looksLikePlaylistUrl), options);
}
