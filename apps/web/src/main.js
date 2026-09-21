import "./style.css";

const API = "";

function authUrl() {
  const returnTo = encodeURIComponent(window.location.origin);
  return `/api/auth/spotify?return_to=${returnTo}`;
}

const state = {
  me: null,
  loading: false,
  report: null,
  reportCached: false,
  reportView: "genres",
  error: null,
  authRequired: null,
};

const app = document.getElementById("app");

function pct(n, total) {
  if (!total) return "0%";
  return `${((n / total) * 100).toFixed(1)}%`;
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

function render() {
  const connected = state.me?.connected;
  const report = state.report;

  app.innerHTML = `
    <main>
      <h1>Discover Your Noise</h1>
      <p class="lead">Paste a Spotify playlist URL to see which Every Noise genres its artists represent.</p>

      <div class="card auth">
        <div class="auth-status">
          ${
            connected
              ? `Connected as <strong>${escapeHtml(state.me.displayName)}</strong>`
              : "Not connected — required for long or private playlists and liked songs."
          }
        </div>
        <div class="row">
          ${
            connected
              ? `<button class="secondary" id="logout">Logout</button>`
              : `<a href="${authUrl()}"><button type="button">Connect Spotify</button></a>`
          }
        </div>
      </div>

      <div class="card">
        <div class="row">
          <input type="url" id="playlist-url" placeholder="https://open.spotify.com/playlist/..." />
          <button id="analyze" ${state.loading ? "disabled" : ""}>
            ${state.loading ? '<span class="spinner"></span>Analyzing…' : "Analyze"}
          </button>
          <button class="secondary" id="liked" ${!connected || state.loading ? "disabled" : ""}>
            Liked (100)
          </button>
        </div>
      </div>

      ${state.error ? `<div class="banner error">${escapeHtml(state.error)}</div>` : ""}
      ${state.authRequired ? `<div class="banner warn">${escapeHtml(state.authRequired)} <a href="${authUrl()}">Connect Spotify</a></div>` : ""}

      ${report ? renderReport(report) : ""}

      <footer>
        Every Noise is largely a historical genre snapshot; newer or obscure artists may lack direct mappings.
      </footer>
    </main>
  `;

  document.getElementById("analyze")?.addEventListener("click", onAnalyze);
  document.getElementById("liked")?.addEventListener("click", onLiked);
  document.getElementById("logout")?.addEventListener("click", onLogout);
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      state.reportView = button.dataset.view;
      render();
    });
  });
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

function renderReport(report) {
  const p = report.playlist;
  const total = report.artistCount;
  const view = state.reportView;
  return `
    <div class="card">
      <h2 style="margin:0 0 0.25rem;font-size:1.2rem">${escapeHtml(p.title)}</h2>
      ${p.url ? `<p class="lead" style="margin:0 0 1rem"><a href="${escapeAttr(p.url)}" target="_blank" rel="noreferrer">${escapeHtml(p.url)}</a></p>` : ""}

      <div class="stats">
        <div class="stat"><div class="stat-label">Tracks</div><div class="stat-value">${p.expectedTrackCount ?? "—"}</div></div>
        <div class="stat"><div class="stat-label">Artists</div><div class="stat-value">${total}</div></div>
        <div class="stat"><div class="stat-label">Direct</div><div class="stat-value">${report.directArtists.length} (${pct(report.directArtists.length, total)})</div></div>
        <div class="stat"><div class="stat-label">Inferred</div><div class="stat-value">${report.inferredArtists.length} (${pct(report.inferredArtists.length, total)})</div></div>
        <div class="stat"><div class="stat-label">Unmapped</div><div class="stat-value">${report.unmappedArtists.length} (${pct(report.unmappedArtists.length, total)})</div></div>
      </div>

      <div class="view-tabs" role="tablist" aria-label="Report view">
        <button type="button" class="view-tab ${view === "genres" ? "active" : ""}" data-view="genres" role="tab" aria-selected="${view === "genres"}">Genres</button>
        <button type="button" class="view-tab ${view === "artists" ? "active" : ""}" data-view="artists" role="tab" aria-selected="${view === "artists"}">Artists</button>
      </div>

      ${state.reportCached ? `<p class="cache-note">Served from cache</p>` : ""}
      ${view === "genres" ? renderGenresTable(report) : renderArtistsTable(report)}
    </div>
  `;
}

function renderGenresTable(report) {
  return `
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Genre</th><th class="num">Direct</th><th class="num">Inferred</th><th class="num">Total</th></tr>
          </thead>
          <tbody>
            ${report.genres
              .map(
                (g) => `
              <tr>
                <td>${escapeHtml(g.genre)}</td>
                <td class="num">${g.direct}</td>
                <td class="num">${g.inferred}</td>
                <td class="num">${g.total}</td>
              </tr>`,
              )
              .join("")}
          </tbody>
        </table>
      </div>
  `;
}

function renderArtistsTable(report) {
  const artists = allArtists(report);
  return `
      <div class="table-wrap">
        <table class="artists-table">
          <thead>
            <tr>
              <th>Artist</th>
              <th>Coverage</th>
              <th class="num">Genres</th>
              <th>Every Noise genres</th>
            </tr>
          </thead>
          <tbody>
            ${artists
              .map((artist) => {
                const genres = artist.genres ?? [];
                const spotifyUrl = `https://open.spotify.com/artist/${artist.id}`;
                return `
              <tr>
                <td>
                  <a class="artist-link" href="${escapeAttr(spotifyUrl)}" target="_blank" rel="noreferrer">${escapeHtml(artist.name)}</a>
                </td>
                <td><span class="badge badge-${escapeAttr(artist.kind)}">${coverageLabel(artist.kind)}</span></td>
                <td class="num">${genres.length}</td>
                <td class="genres-cell">${genres.length ? escapeHtml(genres.join(", ")) : "—"}</td>
              </tr>`;
              })
              .join("")}
          </tbody>
        </table>
      </div>
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

async function onAnalyze() {
  const url = document.getElementById("playlist-url")?.value?.trim();
  if (!url) return;
  state.loading = true;
  state.error = null;
  state.authRequired = null;
  state.report = null;
  state.reportCached = false;
  render();
  try {
    const result = await api("/api/analyze", {
      method: "POST",
      body: JSON.stringify({ url }),
    });
    if (result.status === "auth_required") {
      state.authRequired = result.message;
    } else if (result.status === "ok") {
      state.report = result.report;
      state.reportCached = Boolean(result.cached);
    } else {
      state.error = result.error ?? "Analysis failed.";
    }
  } catch (error) {
    state.error = error.message;
  } finally {
    state.loading = false;
    render();
  }
}

async function onLiked() {
  state.loading = true;
  state.error = null;
  state.authRequired = null;
  state.report = null;
  state.reportCached = false;
  render();
  try {
    const result = await api("/api/analyze/liked", {
      method: "POST",
      body: JSON.stringify({ limit: 100 }),
    });
    if (result.status === "auth_required") {
      state.authRequired = result.message;
    } else if (result.status === "ok") {
      state.report = result.report;
      state.reportCached = Boolean(result.cached);
    } else {
      state.error = result.error ?? "Analysis failed.";
    }
  } catch (error) {
    state.error = error.message;
  } finally {
    state.loading = false;
    render();
  }
}

async function onLogout() {
  await api("/api/auth/logout", { method: "POST" });
  state.me = { connected: false };
  render();
}

async function init() {
  const params = new URLSearchParams(location.search);
  if (params.get("auth") === "ok") {
    history.replaceState({}, "", location.pathname);
  }
  await loadMe();
  render();
}

init();
