import {
  clearEveryNoisePersistentCache,
  configureEveryNoisePersistentCache,
  getEveryNoisePersistentCacheStats,
  readPersistentCanon,
  readPersistentDirectGenres,
  writePersistentCanon,
  writePersistentDirectGenres,
} from "./everynoise-persistent-cache.mjs";

const SPOTIFY_HOST = "open.spotify.com";
const SPOTIFY_ID_PATTERN = /^[A-Za-z0-9]{22}$/;
const EVERY_NOISE_API = "https://everynoise.com/api";
const DIRECT_BATCH_SIZE = 50;
const EVERY_NOISE_MIN_INTERVAL_MS = Number(process.env.EVERY_NOISE_MIN_INTERVAL_MS ?? 200);

const directGenreCache = new Map();
const canonCache = new Map();
let lastEveryNoiseRequestAt = 0;

export class ActionRequiredError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ActionRequiredError";
    this.details = details;
  }
}

export function parsePlaylistId(input) {
  const value = String(input ?? "").trim();
  if (SPOTIFY_ID_PATTERN.test(value)) return value;

  const uriMatch = value.match(/^spotify:playlist:([A-Za-z0-9]{22})$/);
  if (uriMatch) return uriMatch[1];

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Provide a Spotify playlist URL, URI, or 22-character playlist ID.");
  }
  if (url.hostname !== SPOTIFY_HOST) {
    throw new Error(`Expected a playlist on ${SPOTIFY_HOST}.`);
  }

  const parts = url.pathname.split("/").filter(Boolean);
  const playlistIndex = parts.indexOf("playlist");
  const id = playlistIndex >= 0 ? parts[playlistIndex + 1] : null;
  if (!id || !SPOTIFY_ID_PATTERN.test(id)) {
    throw new Error("The Spotify URL does not contain a valid playlist ID.");
  }
  return id;
}

export function decodeHtml(value) {
  const named = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return String(value)
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code) => {
      if (code[0] === "#") {
        const radix = code[1]?.toLowerCase() === "x" ? 16 : 10;
        const digits = radix === 16 ? code.slice(2) : code.slice(1);
        const point = Number.parseInt(digits, radix);
        return Number.isFinite(point) ? String.fromCodePoint(point) : entity;
      }
      return named[code.toLowerCase()] ?? entity;
    })
    .replace(/\s+/g, " ")
    .trim();
}

function extractMetaContent(html, key, value) {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const attributes = Object.fromEntries(
      [...tag.matchAll(/([\w:-]+)=["']([^"']*)["']/g)].map((match) => [
        match[1].toLowerCase(),
        match[2],
      ]),
    );
    if (attributes[key] === value && attributes.content !== undefined) {
      return decodeHtml(attributes.content);
    }
  }
  return null;
}

export function extractSpotifyPage(html, playlistUrl) {
  const trackIds = new Set(
    [...html.matchAll(/href=["']\/track\/([A-Za-z0-9]{22})["']/g)].map(
      (match) => match[1],
    ),
  );
  const artists = new Map();
  for (const match of html.matchAll(
    /href=["']\/artist\/([A-Za-z0-9]{22})["'][^>]*>([\s\S]*?)<\/a>/g,
  )) {
    const [, id, rawName] = match;
    if (!artists.has(id)) artists.set(id, decodeHtml(rawName) || id);
  }

  const description =
    extractMetaContent(html, "name", "description") ??
    extractMetaContent(html, "property", "og:description") ??
    "";
  const countMatch = description.match(/\b([\d,]+)\s+(?:items|songs)\b/i);
  const expectedTrackCount = countMatch
    ? Number.parseInt(countMatch[1].replaceAll(",", ""), 10)
    : null;
  const title =
    extractMetaContent(html, "property", "og:title") ??
    extractMetaContent(html, "name", "twitter:title") ??
    "Spotify playlist";

  return {
    playlist: { url: playlistUrl, title, expectedTrackCount },
    trackIds: [...trackIds],
    artists: [...artists].map(([id, name]) => ({ id, name })),
    isComplete: expectedTrackCount !== null && trackIds.size === expectedTrackCount,
  };
}

export function parseBrowserPayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Browser data must be a JSON object.");
  }
  const playlist = payload.playlist;
  if (!playlist || typeof playlist !== "object") {
    throw new Error("Browser data is missing playlist metadata.");
  }
  const expected = Number(playlist.expectedTrackCount);
  if (!Number.isInteger(expected) || expected < 1) {
    throw new Error("Browser data needs a positive expectedTrackCount.");
  }
  if (!Array.isArray(payload.tracks)) {
    throw new Error("Browser data is missing its tracks array.");
  }

  const tracks = new Map();
  for (const track of payload.tracks) {
    if (!track || typeof track.id !== "string" || !track.id.trim()) continue;
    if (!Array.isArray(track.artists)) continue;
    tracks.set(track.id, track);
  }
  if (tracks.size !== expected) {
    throw new ActionRequiredError(
      `Browser extraction is incomplete: captured ${tracks.size} of ${expected} tracks.`,
      { captured: tracks.size, expected },
    );
  }

  const artists = artistsFromTrackRows([...tracks.values()]);
  if (artists.length === 0) {
    throw new Error("Browser data did not contain any valid Spotify artists.");
  }
  return {
    playlist: {
      url: String(playlist.url ?? ""),
      title: String(playlist.title ?? "Spotify playlist"),
      expectedTrackCount: expected,
    },
    artists,
  };
}

export function artistsFromTrackRows(tracks) {
  const artists = new Map();
  for (const track of tracks) {
    for (const artist of track.artists ?? []) {
      if (!artist || !SPOTIFY_ID_PATTERN.test(String(artist.id ?? ""))) continue;
      const id = String(artist.id);
      if (!artists.has(id)) artists.set(id, String(artist.name ?? id).trim() || id);
    }
  }
  return [...artists].map(([id, name]) => ({ id, name }));
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function getEveryNoiseConfig() {
  return {
    batchSize: DIRECT_BATCH_SIZE,
    minIntervalMs: EVERY_NOISE_MIN_INTERVAL_MS,
  };
}

async function throttleEveryNoise() {
  const now = Date.now();
  const wait = EVERY_NOISE_MIN_INTERVAL_MS - (now - lastEveryNoiseRequestAt);
  if (wait > 0) await delay(wait);
  lastEveryNoiseRequestAt = Date.now();
}

function emitProgress(onProgress, update) {
  if (!onProgress) return;
  const pct =
    update.pct ??
    (update.total ? Math.min(100, Math.round((update.done / update.total) * 100)) : 0);
  onProgress({ ...update, pct });
}

export async function fetchJsonWithRetry(url, fetchImpl = fetch, retries = 2) {
  let attempt = 0;
  while (true) {
    let response;
    try {
      response = await fetchImpl(url, { headers: { Accept: "application/json" } });
    } catch (error) {
      if (attempt >= retries) throw error;
      await delay(250 * 2 ** attempt);
      attempt += 1;
      continue;
    }
    if (response.ok) {
      const data = await response.json();
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error(`Every Noise returned malformed data for ${url}.`);
      }
      return data;
    }

    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt >= retries) {
      throw new Error(`Every Noise request failed with HTTP ${response.status}.`);
    }
    const retryAfter = Number(response.headers.get("retry-after"));
    const wait = Number.isFinite(retryAfter)
      ? Math.max(0, retryAfter * 1000)
      : 250 * 2 ** attempt;
    await delay(wait);
    attempt += 1;
  }
}

async function everyNoiseFetch(url, fetchImpl, retries = 2) {
  await throttleEveryNoise();
  return fetchJsonWithRetry(url, fetchImpl, retries);
}

async function fetchGenreMap(ids, fetchImpl, onBatch) {
  const genreMap = {};
  const unique = [...new Set(ids)];
  const uncached = [];
  for (const id of unique) {
    if (directGenreCache.has(id)) continue;
    const fromDisk = await readPersistentDirectGenres(id);
    if (fromDisk !== undefined) {
      directGenreCache.set(id, fromDisk);
      continue;
    }
    uncached.push(id);
  }
  const batches = chunks(uncached, DIRECT_BATCH_SIZE);

  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    if (batch.length > 0) {
      const data = await everyNoiseFetch(
        `${EVERY_NOISE_API}/${batch.map(encodeURIComponent).join(",")}`,
        fetchImpl,
      );
      for (const id of batch) {
        const genres = Array.isArray(data[id]) ? data[id].filter(Boolean) : [];
        directGenreCache.set(id, genres);
        await writePersistentDirectGenres(id, genres);
      }
    }
    onBatch?.(index + 1, batches.length);
  }

  for (const id of unique) {
    genreMap[id] = directGenreCache.get(id) ?? [];
  }
  return genreMap;
}

export function inferGenres(relatedIds, relatedGenreMap, maximum = 10) {
  const counts = new Map();
  for (const id of relatedIds) {
    for (const genre of relatedGenreMap[id] ?? []) {
      counts.set(genre, (counts.get(genre) ?? 0) + 1);
    }
  }
  const sorted = [...counts].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  );
  const inferred = [];
  let useSingles = true;
  for (const [genre, count] of sorted) {
    if (count > 1 || useSingles) {
      inferred.push(genre);
      if (inferred.length >= maximum) break;
      if (count > 1) useSingles = false;
    }
  }
  return inferred;
}

export async function classifyArtists(artists, fetchImpl = fetch, options = {}) {
  const { onProgress } = options;
  const total = artists.length;
  if (total === 0) return [];

  emitProgress(onProgress, {
    phase: "direct",
    done: 0,
    total,
    message: "Looking up direct Every Noise mappings…",
  });

  const directBatches = chunks(artists.map((artist) => artist.id), DIRECT_BATCH_SIZE).length || 1;
  let directBatchDone = 0;
  const directGenreMap = await fetchGenreMap(
    artists.map((artist) => artist.id),
    fetchImpl,
    () => {
      directBatchDone += 1;
      emitProgress(onProgress, {
        phase: "direct",
        done: Math.min(total, Math.round((directBatchDone / directBatches) * total * 0.45)),
        total,
        message: `Direct mappings (${directBatchDone}/${directBatches} batches)…`,
      });
    },
  );

  const direct = new Map();
  const missing = [];
  for (const artist of artists) {
    const genres = [...new Set(directGenreMap[artist.id] ?? [])].filter(Boolean);
    if (genres.length > 0) direct.set(artist.id, genres);
    else missing.push(artist);
  }

  const canonByArtist = new Map();
  for (let index = 0; index < missing.length; index += 1) {
    const artist = missing[index];
    if (!canonCache.has(artist.id)) {
      const fromDisk = await readPersistentCanon(artist.id);
      if (fromDisk !== undefined) {
        canonCache.set(artist.id, fromDisk);
      } else {
        const data = await everyNoiseFetch(
          `${EVERY_NOISE_API}/canon/${encodeURIComponent(artist.id)}`,
          fetchImpl,
        );
        const related = Array.isArray(data[artist.id]) ? data[artist.id] : [];
        canonCache.set(artist.id, related);
        await writePersistentCanon(artist.id, related);
      }
    }
    const related = canonCache.get(artist.id) ?? [];
    canonByArtist.set(artist.id, related);
    emitProgress(onProgress, {
      phase: "canon",
      done: Math.round(total * 0.45 + ((index + 1) / Math.max(1, missing.length)) * total * 0.4),
      total,
      message: `Inferring from related artists (${index + 1}/${missing.length})…`,
    });
  }

  const allRelatedIds = [...new Set([...canonByArtist.values()].flat())];
  const relatedBatches = chunks(allRelatedIds, DIRECT_BATCH_SIZE).length || 1;
  let relatedBatchDone = 0;
  const relatedGenreMap = await fetchGenreMap(allRelatedIds, fetchImpl, () => {
    relatedBatchDone += 1;
    emitProgress(onProgress, {
      phase: "related",
      done: Math.round(total * 0.85 + (relatedBatchDone / relatedBatches) * total * 0.15),
      total,
      message: `Loading related artist genres (${relatedBatchDone}/${relatedBatches} batches)…`,
    });
  });

  emitProgress(onProgress, {
    phase: "done",
    done: total,
    total,
    message: "Building genre report…",
  });

  return artists.map((artist) => {
    if (direct.has(artist.id)) {
      return { ...artist, kind: "direct", genres: direct.get(artist.id) };
    }
    const genres = inferGenres(canonByArtist.get(artist.id) ?? [], relatedGenreMap);
    return {
      ...artist,
      kind: genres.length > 0 ? "inferred" : "unmapped",
      genres,
    };
  });
}

export function buildReportData(playlist, classifications) {
  const genres = new Map();
  for (const artist of classifications) {
    for (const genre of new Set(artist.genres)) {
      const count = genres.get(genre) ?? { direct: 0, inferred: 0 };
      count[artist.kind] += 1;
      genres.set(genre, count);
    }
  }
  const rankedGenres = [...genres].map(([genre, counts]) => ({
    genre,
    ...counts,
    total: counts.direct + counts.inferred,
  }));
  rankedGenres.sort(
    (left, right) =>
      right.total - left.total ||
      right.direct - left.direct ||
      left.genre.localeCompare(right.genre),
  );
  return {
    playlist,
    artistCount: classifications.length,
    directArtists: classifications.filter((artist) => artist.kind === "direct"),
    inferredArtists: classifications.filter((artist) => artist.kind === "inferred"),
    unmappedArtists: classifications.filter((artist) => artist.kind === "unmapped"),
    genres: rankedGenres,
  };
}

function percent(count, total) {
  return total === 0 ? "0.0%" : `${((count / total) * 100).toFixed(1)}%`;
}

export function formatReport(report) {
  const lines = ["Discover Your Noise", `Playlist: ${report.playlist.title}`];
  if (report.playlist.url) lines.push(`URL: ${report.playlist.url}`);
  if (report.playlist.expectedTrackCount) {
    lines.push(`Tracks: ${report.playlist.expectedTrackCount}`);
  }
  lines.push(
    `Unique credited artists: ${report.artistCount}`,
    `Coverage: ${report.directArtists.length} direct (${percent(report.directArtists.length, report.artistCount)}), ${report.inferredArtists.length} inferred (${percent(report.inferredArtists.length, report.artistCount)}), ${report.unmappedArtists.length} unmapped (${percent(report.unmappedArtists.length, report.artistCount)})`,
    "",
    "Genres",
  );

  const genreWidth = Math.max(5, ...report.genres.map((entry) => entry.genre.length));
  lines.push(
    `${"Genre".padEnd(genreWidth)}  Direct  Inferred  Total`,
    `${"-".repeat(genreWidth)}  ------  --------  -----`,
  );
  for (const entry of report.genres) {
    lines.push(
      `${entry.genre.padEnd(genreWidth)}  ${String(entry.direct).padStart(6)}  ${String(entry.inferred).padStart(8)}  ${String(entry.total).padStart(5)}`,
    );
  }

  if (report.inferredArtists.length > 0) {
    lines.push(
      "",
      "Inferred from related artists",
      ...report.inferredArtists.map(
        (artist) => `- ${artist.name}: ${artist.genres.join(", ")}`,
      ),
    );
  }
  if (report.unmappedArtists.length > 0) {
    lines.push(
      "",
      "Unmapped artists",
      ...report.unmappedArtists.map((artist) => `- ${artist.name}`),
    );
  }
  lines.push(
    "",
    "Source note: Every Noise is largely a historical genre snapshot; newer or obscure artists may lack direct mappings.",
  );
  return lines.join("\n");
}

export async function analyzeArtists(playlist, artists, fetchImpl = fetch, options = {}) {
  const classifications = await classifyArtists(artists, fetchImpl, options);
  return buildReportData(playlist, classifications);
}

export async function analyzePublicPlaylist(input, fetchImpl = fetch, options = {}) {
  const id = parsePlaylistId(input);
  const url = `https://${SPOTIFY_HOST}/playlist/${id}`;
  const response = await fetchImpl(url, { headers: { Accept: "text/html" } });
  if (!response.ok) {
    throw new ActionRequiredError(
      `Spotify did not expose this playlist publicly (HTTP ${response.status}). Connect Spotify to analyze private playlists.`,
      { reason: "private_or_unavailable", status: response.status },
    );
  }
  const page = extractSpotifyPage(await response.text(), url);
  if (page.playlist.expectedTrackCount === null) {
    throw new ActionRequiredError(
      "Spotify did not expose the playlist track count. Connect Spotify to analyze this playlist.",
      { reason: "no_track_count" },
    );
  }
  if (!page.isComplete) {
    throw new ActionRequiredError(
      `Spotify's public HTML contains ${page.trackIds.length} of ${page.playlist.expectedTrackCount} tracks. Connect Spotify to analyze the full playlist.`,
      {
        reason: "incomplete_html",
        captured: page.trackIds.length,
        expected: page.playlist.expectedTrackCount,
      },
    );
  }
  if (page.artists.length === 0) {
    throw new ActionRequiredError(
      "Spotify exposed no credited artists. The playlist may be private, empty, or unavailable.",
      { reason: "no_artists" },
    );
  }
  return analyzeArtists(page.playlist, page.artists, fetchImpl, options);
}

export async function analyzeFromTracks(playlist, tracks, fetchImpl = fetch, options = {}) {
  const artists = artistsFromTrackRows(tracks);
  if (artists.length === 0) {
    throw new Error("No valid artists found in track data.");
  }
  const classifications = await classifyArtists(artists, fetchImpl, options);
  const genreByArtistId = new Map(
    classifications.map((artist) => [artist.id, artist.genres ?? []]),
  );
  return {
    ...buildReportData(playlist, classifications),
    tracks: trackRowsForReport(tracks, genreByArtistId),
  };
}

export async function fetchTrackArtists(trackId, accessToken, fetchImpl = fetch) {
  const track = await spotifyApi(accessToken, `/tracks/${trackId}`, fetchImpl);
  return (track.artists ?? [])
    .filter((artist) => artist?.id)
    .map((artist) => ({ id: artist.id, name: artist.name ?? artist.id }));
}

export async function classifyTrackGenres(artists, fetchImpl = fetch, options = {}) {
  const classifications = await classifyArtists(artists, fetchImpl, options);
  const genres = new Set();
  for (const artist of classifications) {
    for (const genre of artist.genres ?? []) genres.add(genre);
  }
  return [...genres].sort((left, right) => left.localeCompare(right));
}

export async function spotifyApi(accessToken, path, fetchImpl = fetch) {
  const response = await fetchImpl(`https://api.spotify.com/v1${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Spotify API ${response.status}: ${body.slice(0, 200)}`);
  }
  return response.json();
}

export async function spotifyPaginate(accessToken, initialPath, fetchImpl = fetch) {
  const items = [];
  let url = `https://api.spotify.com/v1${initialPath}`;
  while (url) {
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Spotify API ${response.status}: ${body.slice(0, 200)}`);
    }
    const payload = await response.json();
    items.push(...(payload.items ?? []));
    url = payload.next;
  }
  return items;
}

function trackArtistEntries(track) {
  return (track.artists ?? [])
    .filter((a) => a?.id)
    .map((a) => ({ id: a.id, name: a.name ?? a.id }));
}

export function tracksFromSpotifyItems(items) {
  const tracks = [];
  for (const item of items) {
    const track = item?.track ?? item;
    if (!track?.id) continue;
    const artists = trackArtistEntries(track);
    tracks.push({
      id: track.id,
      name: track.name ?? "Unknown track",
      url: track.external_urls?.spotify ?? `https://open.spotify.com/track/${track.id}`,
      image: imageFromSpotify(track.album?.images),
      album: track.album?.name ?? "",
      durationMs: track.duration_ms ?? null,
      artists,
    });
  }
  return tracks;
}

function genresForTrackArtists(artistEntries, genreByArtistId) {
  const genres = new Set();
  for (const artist of artistEntries) {
    for (const genre of genreByArtistId.get(artist.id) ?? []) {
      genres.add(genre);
    }
  }
  return [...genres].sort((left, right) => left.localeCompare(right));
}

function trackRowsForReport(tracks, genreByArtistId) {
  return tracks.map((track) => {
    const artistEntries = Array.isArray(track.artists) ? track.artists : [];
    const artistsLabel =
      artistEntries
        .map((artist) => artist.name)
        .filter(Boolean)
        .join(", ") || "—";
    return {
      id: track.id,
      name: track.name ?? "Unknown track",
      url: track.url ?? `https://open.spotify.com/track/${track.id}`,
      image: track.image ?? null,
      artists: artistsLabel,
      album: track.album ?? "",
      durationMs: track.duration_ms ?? track.durationMs ?? null,
      genres: genresForTrackArtists(artistEntries, genreByArtistId),
    };
  });
}

export async function fetchPlaylistForAnalysis(playlistId, accessToken, fetchImpl = fetch) {
  const meta = await spotifyApi(
    accessToken,
    `/playlists/${playlistId}?fields=name,tracks.total,external_urls.spotify`,
    fetchImpl,
  );
  const total = meta.tracks?.total ?? 0;
  const items = await spotifyPaginate(
    accessToken,
    `/playlists/${playlistId}/tracks?limit=50`,
    fetchImpl,
  );
  const tracks = tracksFromSpotifyItems(items);
  return {
    playlist: {
      url: meta.external_urls?.spotify ?? `https://open.spotify.com/playlist/${playlistId}`,
      title: meta.name ?? "Spotify playlist",
      expectedTrackCount: total,
    },
    tracks,
  };
}

export async function fetchLikedForAnalysis(accessToken, limit = 100, fetchImpl = fetch) {
  const items = [];
  let url = `https://api.spotify.com/v1/me/tracks?limit=50`;
  while (url && items.length < limit) {
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Spotify API ${response.status}: ${body.slice(0, 200)}`);
    }
    const payload = await response.json();
    for (const item of payload.items ?? []) {
      if (items.length >= limit) break;
      items.push(item);
    }
    url = items.length < limit ? payload.next : null;
  }
  const tracks = tracksFromSpotifyItems(items);
  const reachedCap = items.length >= limit && limit >= 5000;
  return {
    playlist: {
      url: "",
      title: reachedCap
        ? `Liked songs (${tracks.length})`
        : `Liked songs (latest ${tracks.length})`,
      expectedTrackCount: tracks.length,
    },
    tracks,
  };
}

function imageFromSpotify(images) {
  const list = images ?? [];
  return list[0]?.url ?? null;
}

function mapSavedTrackItem(item) {
  const track = item.track ?? {};
  return {
    id: track.id,
    name: track.name ?? "Unknown track",
    url: track.external_urls?.spotify ?? "",
    image: imageFromSpotify(track.album?.images),
    artists: (track.artists ?? []).map((artist) => artist.name).filter(Boolean).join(", "),
    album: track.album?.name ?? "",
    durationMs: track.duration_ms ?? null,
    addedAt: item.added_at ?? null,
  };
}

function mapRecentTrackItem(item) {
  const track = item.track ?? {};
  return {
    id: track.id,
    name: track.name ?? "Unknown track",
    url: track.external_urls?.spotify ?? "",
    image: imageFromSpotify(track.album?.images),
    artists: (track.artists ?? []).map((artist) => artist.name).filter(Boolean).join(", "),
    album: track.album?.name ?? "",
    durationMs: track.duration_ms ?? null,
    playedAt: item.played_at ?? null,
  };
}

function mapPlaylistItem(playlist) {
  return {
    id: playlist.id,
    name: playlist.name ?? "Untitled playlist",
    url: playlist.external_urls?.spotify ?? `https://open.spotify.com/playlist/${playlist.id}`,
    image: imageFromSpotify(playlist.images),
    trackCount: playlist.tracks?.total ?? 0,
    owner: playlist.owner?.display_name ?? playlist.owner?.id ?? "",
  };
}

export async function fetchUserPlaylistsPage(
  accessToken,
  { limit = 50, offset = 0 } = {},
  fetchImpl = fetch,
) {
  const capped = Math.min(50, Math.max(1, limit));
  const safeOffset = Math.max(0, offset);
  const response = await fetchImpl(
    `https://api.spotify.com/v1/me/playlists?limit=${capped}&offset=${safeOffset}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Spotify API ${response.status}: ${body.slice(0, 200)}`);
  }
  const payload = await response.json();
  const playlists = (payload.items ?? []).map(mapPlaylistItem);
  return {
    playlists,
    total: payload.total ?? playlists.length,
    hasMore: Boolean(payload.next),
    offset: payload.offset ?? safeOffset,
    limit: capped,
  };
}

export async function fetchRecentlyPlayedPage(
  accessToken,
  { limit = 50, before = null } = {},
  fetchImpl = fetch,
) {
  const capped = Math.min(50, Math.max(1, limit));
  let path = `/me/player/recently-played?limit=${capped}`;
  if (before) path += `&before=${encodeURIComponent(before)}`;
  const payload = await spotifyApi(accessToken, path, fetchImpl);
  const tracks = (payload.items ?? []).map(mapRecentTrackItem);
  const nextBefore = payload.cursors?.before ?? null;
  return {
    tracks,
    hasMore: Boolean(payload.next ?? nextBefore),
    nextBefore,
    limit: capped,
  };
}

export async function fetchLikedTracksPage(
  accessToken,
  { limit = 50, offset = 0 } = {},
  fetchImpl = fetch,
) {
  const capped = Math.min(50, Math.max(1, limit));
  const safeOffset = Math.max(0, offset);
  const response = await fetchImpl(
    `https://api.spotify.com/v1/me/tracks?limit=${capped}&offset=${safeOffset}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Spotify API ${response.status}: ${body.slice(0, 200)}`);
  }
  const payload = await response.json();
  const tracks = (payload.items ?? []).map(mapSavedTrackItem);
  return {
    tracks,
    total: payload.total ?? tracks.length,
    hasMore: Boolean(payload.next),
    offset: payload.offset ?? safeOffset,
    limit: capped,
  };
}

export async function fetchUserPlaylists(accessToken, limit = 50, fetchImpl = fetch) {
  const items = [];
  let url = `https://api.spotify.com/v1/me/playlists?limit=50`;
  while (url && items.length < limit) {
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Spotify API ${response.status}: ${body.slice(0, 200)}`);
    }
    const payload = await response.json();
    for (const item of payload.items ?? []) {
      if (items.length >= limit) break;
      items.push(item);
    }
    url = items.length < limit ? payload.next : null;
  }
  return items.map(mapPlaylistItem);
}

export async function fetchRecentlyPlayed(accessToken, limit = 20, fetchImpl = fetch) {
  const { tracks } = await fetchRecentlyPlayedPage(accessToken, { limit }, fetchImpl);
  return tracks;
}

export async function fetchLikedTracks(accessToken, limit = 50, fetchImpl = fetch) {
  const capped = Math.min(50, Math.max(1, limit));
  const items = [];
  let url = `https://api.spotify.com/v1/me/tracks?limit=50`;
  while (url && items.length < capped) {
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Spotify API ${response.status}: ${body.slice(0, 200)}`);
    }
    const payload = await response.json();
    for (const item of payload.items ?? []) {
      if (items.length >= capped) break;
      items.push(item);
    }
    url = items.length < capped ? payload.next : null;
  }
  return items.map(mapSavedTrackItem);
}

export async function fetchRecentForAnalysis(accessToken, limit = 50, fetchImpl = fetch) {
  const capped = Math.min(50, Math.max(1, limit));
  const payload = await spotifyApi(
    accessToken,
    `/me/player/recently-played?limit=${capped}`,
    fetchImpl,
  );
  const items = payload.items ?? [];
  const tracks = tracksFromSpotifyItems(items);
  return {
    playlist: {
      url: "",
      title: `Recently played (latest ${tracks.length})`,
      expectedTrackCount: tracks.length,
    },
    tracks,
  };
}

function mapSearchPlaylist(item) {
  return {
    id: item.id,
    type: "playlist",
    name: item.name ?? "Untitled playlist",
    url: item.external_urls?.spotify ?? "",
    image: imageFromSpotify(item.images),
    subtitle: `${item.tracks?.total ?? 0} tracks · ${item.owner?.display_name ?? ""}`.trim(),
  };
}

function mapSearchAlbum(item) {
  return {
    id: item.id,
    type: "album",
    name: item.name ?? "Untitled album",
    url: item.external_urls?.spotify ?? "",
    image: imageFromSpotify(item.images),
    subtitle: (item.artists ?? []).map((artist) => artist.name).filter(Boolean).join(", "),
  };
}

function mapSearchArtist(item) {
  return {
    id: item.id,
    type: "artist",
    name: item.name ?? "Unknown artist",
    url: item.external_urls?.spotify ?? "",
    image: imageFromSpotify(item.images),
    subtitle: `${item.followers?.total ?? 0} followers`,
  };
}

function mapSearchTrack(item) {
  return {
    id: item.id,
    type: "track",
    name: item.name ?? "Unknown track",
    url: item.external_urls?.spotify ?? "",
    image: imageFromSpotify(item.album?.images),
    subtitle: (item.artists ?? []).map((artist) => artist.name).filter(Boolean).join(", "),
  };
}

export async function searchSpotify(accessToken, query, types = ["playlist"], limit = 10, fetchImpl = fetch) {
  const trimmed = String(query ?? "").trim();
  if (!trimmed) return { playlists: [], albums: [], artists: [], tracks: [] };
  const capped = Math.min(20, Math.max(1, limit));
  const typeParam = types.join(",");
  const payload = await spotifyApi(
    accessToken,
    `/search?q=${encodeURIComponent(trimmed)}&type=${typeParam}&limit=${capped}`,
    fetchImpl,
  );
  return {
    playlists: (payload.playlists?.items ?? []).filter(Boolean).map(mapSearchPlaylist),
    albums: (payload.albums?.items ?? []).filter(Boolean).map(mapSearchAlbum),
    artists: (payload.artists?.items ?? []).filter(Boolean).map(mapSearchArtist),
    tracks: (payload.tracks?.items ?? []).filter(Boolean).map(mapSearchTrack),
  };
}

export async function fetchAlbumTracksForAnalysis(albumId, accessToken, fetchImpl = fetch) {
  const meta = await spotifyApi(
    accessToken,
    `/albums/${albumId}?fields=name,total_tracks,external_urls.spotify,images`,
    fetchImpl,
  );
  const items = await spotifyPaginate(
    accessToken,
    `/albums/${albumId}/tracks?limit=50`,
    fetchImpl,
  );
  const tracks = tracksFromSpotifyItems(items);
  return {
    playlist: {
      url: meta.external_urls?.spotify ?? `https://open.spotify.com/album/${albumId}`,
      title: meta.name ?? "Spotify album",
      expectedTrackCount: meta.total_tracks ?? tracks.length,
    },
    tracks,
  };
}

export async function fetchArtistTopTracksForAnalysis(artistId, accessToken, fetchImpl = fetch) {
  const meta = await spotifyApi(accessToken, `/artists/${artistId}`, fetchImpl);
  const payload = await spotifyApi(
    accessToken,
    `/artists/${artistId}/top-tracks?market=from_token`,
    fetchImpl,
  );
  const tracks = tracksFromSpotifyItems(payload.tracks ?? []);
  return {
    playlist: {
      url: meta.external_urls?.spotify ?? `https://open.spotify.com/artist/${artistId}`,
      title: `${meta.name ?? "Artist"} — top tracks`,
      expectedTrackCount: tracks.length,
    },
    tracks,
  };
}

export function clearEveryNoiseMemoryCaches() {
  directGenreCache.clear();
  canonCache.clear();
}

export {
  clearEveryNoisePersistentCache,
  configureEveryNoisePersistentCache,
  getEveryNoisePersistentCacheDir,
  getEveryNoisePersistentCacheStats,
  readPersistentDirectGenres,
} from "./everynoise-persistent-cache.mjs";
