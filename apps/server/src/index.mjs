import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { deleteCookie, setCookie } from "hono/cookie";
import { randomBytes } from "node:crypto";
import { networkInterfaces } from "node:os";
import {
  analyzeAlbum,
  analyzeArtist,
  analyzeLiked,
  analyzePlaylistId,
  analyzePlaylistUrl,
  analyzeRecent,
  analyzeTrack,
} from "./analyze-route.mjs";
import { streamAnalyze, wantsStream } from "./analyze-stream.mjs";
import { withCache } from "./cache.mjs";
import {
  fetchLikedTracksPage,
  fetchRecentlyPlayedPage,
  fetchUserPlaylistsPage,
  parsePlaylistId,
  searchSpotify,
} from "@discover-your-noise/core";
import {
  buildAuthorizeUrl,
  createPkcePair,
  exchangeCode,
  fetchSpotifyProfile,
  getSpotifyConfig,
  refreshAccessToken,
} from "./spotify-auth.mjs";
import {
  consumeOAuthState,
  createSession,
  deleteSession,
  getSession,
  getSessionCookieName,
  parseCookies,
  storeOAuthState,
  updateSession,
} from "./session.mjs";

const app = new Hono();
const FE_ORIGIN = process.env.FE_ORIGIN ?? "http://127.0.0.1:5173";
const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? "127.0.0.1";
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN ?? undefined;
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const COOKIE_NAME = getSessionCookieName();

function sessionCookieOptions() {
  const options = {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    maxAge: 86400,
  };
  if (IS_PRODUCTION) options.secure = true;
  if (COOKIE_DOMAIN) options.domain = COOKIE_DOMAIN;
  return options;
}

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (origin === FE_ORIGIN) return true;
  try {
    const { hostname, protocol } = new URL(origin);
    if (protocol !== "http:" && protocol !== "https:") return false;
    if (hostname === "localhost" || hostname === "127.0.0.1") return true;
    if (/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname)) return true;
  } catch {
    return false;
  }
  return false;
}

function normalizeReturnTo(value) {
  if (!value) return new URL(FE_ORIGIN);
  try {
    const url = new URL(value);
    if (!isAllowedOrigin(url.origin)) return new URL(FE_ORIGIN);
    return url;
  } catch {
    return new URL(FE_ORIGIN);
  }
}

function redirectWithAuthParam(returnTo, authValue) {
  const url = normalizeReturnTo(returnTo);
  url.searchParams.set("auth", authValue);
  return url.toString();
}

function lanAddresses() {
  const addresses = [];
  for (const iface of Object.values(networkInterfaces())) {
    for (const config of iface ?? []) {
      if (config.family !== "IPv4" || config.internal) continue;
      addresses.push(config.address);
    }
  }
  return addresses;
}

app.use(
  "/api/*",
  cors({
    origin: (origin) => (isAllowedOrigin(origin) ? origin : FE_ORIGIN),
    credentials: true,
  }),
);

function writeSessionCookie(c, sessionId) {
  setCookie(c, COOKIE_NAME, sessionId, sessionCookieOptions());
}

function eraseSessionCookie(c) {
  deleteCookie(c, COOKIE_NAME, sessionCookieOptions());
}

async function ensureAccessToken(sessionId) {
  const session = getSession(sessionId);
  if (!session?.accessToken) return null;
  if (!session.expiresAt || Date.now() < session.expiresAt - 60_000) {
    return session.accessToken;
  }
  if (!session.refreshToken) return null;
  const config = getSpotifyConfig();
  const tokens = await refreshAccessToken({
    refreshToken: session.refreshToken,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
  });
  updateSession(sessionId, {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? session.refreshToken,
    expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
  });
  return tokens.access_token;
}

function sessionIdFromRequest(c) {
  return parseCookies(c.req.header("cookie"))[COOKIE_NAME] ?? null;
}

app.get("/health", (c) => c.json({ ok: true }));

app.get("/api/me", async (c) => {
  const sessionId = sessionIdFromRequest(c);
  if (!sessionId || !getSession(sessionId)) return c.json({ connected: false });
  const token = await ensureAccessToken(sessionId);
  if (!token) return c.json({ connected: false });
  const profile = await fetchSpotifyProfile(token);
  return c.json({
    connected: true,
    displayName: profile?.display_name ?? profile?.id ?? "Spotify user",
    spotifyConfigured: getSpotifyConfig().configured,
  });
});

app.get("/api/auth/spotify", (c) => {
  const config = getSpotifyConfig();
  if (!config.configured) {
    return c.json({ error: "SPOTIFY_CLIENT_ID is not configured on the server." }, 503);
  }
  const { verifier, challenge } = createPkcePair();
  const state = randomBytes(16).toString("hex");
  const returnTo = normalizeReturnTo(c.req.query("return_to")).toString();
  storeOAuthState(state, { verifier, returnTo });
  return c.redirect(
    buildAuthorizeUrl({
      clientId: config.clientId,
      redirectUri: config.redirectUri,
      state,
      challenge,
    }),
  );
});

app.get("/api/auth/callback", async (c) => {
  const config = getSpotifyConfig();
  const code = c.req.query("code");
  const state = c.req.query("state");
  const stored = state ? consumeOAuthState(state) : null;
  const returnTo = stored?.returnTo;
  if (!code || !stored) {
    return c.redirect(redirectWithAuthParam(returnTo, "failed"));
  }
  const tokens = await exchangeCode({
    code,
    verifier: stored.verifier,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: config.redirectUri,
  });
  const profile = await fetchSpotifyProfile(tokens.access_token);
  const sessionId = createSession({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    displayName: profile?.display_name ?? profile?.id,
  });
  writeSessionCookie(c, sessionId);
  return c.redirect(redirectWithAuthParam(returnTo, "ok"));
});

app.post("/api/auth/logout", (c) => {
  const cookies = parseCookies(c.req.header("cookie"));
  deleteSession(cookies[COOKIE_NAME]);
  eraseSessionCookie(c);
  return c.json({ ok: true });
});

async function handleAnalyze(c, { cacheKey, body, run }) {
  if (wantsStream(body, c.req.header("accept"))) {
    return streamAnalyze(async (onProgress) => {
      if (cacheKey) return withCache(cacheKey, run, onProgress);
      return { ...(await run(onProgress)), cached: false };
    });
  }
  try {
    const result = cacheKey
      ? await withCache(cacheKey, run)
      : { ...(await run()), cached: false };
    return c.json(result);
  } catch (error) {
    return c.json({ error: error.message }, 400);
  }
}

app.post("/api/analyze", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const url = String(body?.url ?? "").trim();
  if (!url) return c.json({ error: "url is required" }, 400);

  const sessionId = sessionIdFromRequest(c);
  const token = sessionId ? await ensureAccessToken(sessionId) : null;

  let cacheKey = null;
  try {
    cacheKey = `playlist:${parsePlaylistId(url)}`;
  } catch {
    cacheKey = null;
  }

  return handleAnalyze(c, {
    cacheKey,
    body,
    run: (onProgress) => analyzePlaylistUrl(url, token, onProgress),
  });
});

async function requireToken(c) {
  const sessionId = sessionIdFromRequest(c);
  const token = sessionId ? await ensureAccessToken(sessionId) : null;
  if (!token) {
    return { error: c.json({ status: "auth_required", message: "Connect Spotify to use this feature." }) };
  }
  return { token, sessionId };
}

app.get("/api/library/playlists", async (c) => {
  const auth = await requireToken(c);
  if (auth.error) return auth.error;
  const limit = Math.min(50, Math.max(1, Number(c.req.query("limit") ?? 50)));
  const offset = Math.max(0, Number(c.req.query("offset") ?? 0));
  try {
    const page = await fetchUserPlaylistsPage(auth.token, { limit, offset });
    return c.json(page);
  } catch (error) {
    return c.json({ error: error.message }, 400);
  }
});

app.get("/api/library/recent", async (c) => {
  const auth = await requireToken(c);
  if (auth.error) return auth.error;
  const limit = Math.min(50, Math.max(1, Number(c.req.query("limit") ?? 50)));
  const before = String(c.req.query("before") ?? "").trim() || null;
  try {
    const page = await fetchRecentlyPlayedPage(auth.token, { limit, before });
    return c.json(page);
  } catch (error) {
    return c.json({ error: error.message }, 400);
  }
});

app.get("/api/library/liked", async (c) => {
  const auth = await requireToken(c);
  if (auth.error) return auth.error;
  const limit = Math.min(50, Math.max(1, Number(c.req.query("limit") ?? 50)));
  const offset = Math.max(0, Number(c.req.query("offset") ?? 0));
  try {
    const page = await fetchLikedTracksPage(auth.token, { limit, offset });
    return c.json(page);
  } catch (error) {
    return c.json({ error: error.message }, 400);
  }
});

app.get("/api/search", async (c) => {
  const auth = await requireToken(c);
  if (auth.error) return auth.error;
  const query = String(c.req.query("q") ?? "").trim();
  if (!query) return c.json({ playlists: [], albums: [], artists: [], tracks: [] });
  const typeParam = String(c.req.query("type") ?? "playlist,album,artist,track");
  const types = typeParam.split(",").map((value) => value.trim()).filter(Boolean);
  const limit = Math.min(20, Math.max(1, Number(c.req.query("limit") ?? 10)));
  try {
    const results = await searchSpotify(auth.token, query, types, limit);
    return c.json(results);
  } catch (error) {
    return c.json({ error: error.message }, 400);
  }
});

app.post("/api/analyze/playlist", async (c) => {
  const auth = await requireToken(c);
  if (auth.error) return auth.error;
  const body = await c.req.json().catch(() => ({}));
  const playlistId = String(body?.id ?? "").trim();
  if (!playlistId) return c.json({ error: "id is required" }, 400);
  return handleAnalyze(c, {
    cacheKey: `playlist:${playlistId}`,
    body,
    run: (onProgress) => analyzePlaylistId(playlistId, auth.token, onProgress),
  });
});

app.post("/api/analyze/recent", async (c) => {
  const auth = await requireToken(c);
  if (auth.error) return auth.error;
  const body = await c.req.json().catch(() => ({}));
  const limit = Math.min(50, Math.max(1, Number(body?.limit ?? 50)));
  return handleAnalyze(c, {
    cacheKey: `recent:${auth.sessionId}:${limit}`,
    body,
    run: (onProgress) => analyzeRecent(auth.token, limit, onProgress),
  });
});

app.post("/api/analyze/album", async (c) => {
  const auth = await requireToken(c);
  if (auth.error) return auth.error;
  const body = await c.req.json().catch(() => ({}));
  const albumId = String(body?.id ?? "").trim();
  if (!albumId) return c.json({ error: "id is required" }, 400);
  return handleAnalyze(c, {
    cacheKey: `album:${albumId}`,
    body,
    run: (onProgress) => analyzeAlbum(albumId, auth.token, onProgress),
  });
});

app.post("/api/analyze/artist", async (c) => {
  const auth = await requireToken(c);
  if (auth.error) return auth.error;
  const body = await c.req.json().catch(() => ({}));
  const artistId = String(body?.id ?? "").trim();
  if (!artistId) return c.json({ error: "id is required" }, 400);
  return handleAnalyze(c, {
    cacheKey: `artist:${artistId}`,
    body,
    run: (onProgress) => analyzeArtist(artistId, auth.token, onProgress),
  });
});

app.post("/api/analyze/track", async (c) => {
  const auth = await requireToken(c);
  if (auth.error) return auth.error;
  const body = await c.req.json().catch(() => ({}));
  const trackId = String(body?.id ?? "").trim();
  if (!trackId) return c.json({ error: "id is required" }, 400);
  return handleAnalyze(c, {
    cacheKey: `track:${trackId}`,
    body,
    run: (onProgress) => analyzeTrack(trackId, auth.token, onProgress),
  });
});

app.post("/api/analyze/liked", async (c) => {
  const sessionId = sessionIdFromRequest(c);
  const token = sessionId ? await ensureAccessToken(sessionId) : null;
  const body = await c.req.json().catch(() => ({}));
  if (!token) {
    const payload = { status: "auth_required", message: "Connect Spotify to analyze liked songs." };
    if (wantsStream(body, c.req.header("accept"))) {
      return streamAnalyze(async () => payload);
    }
    return c.json(payload);
  }
  const rawLimit = body?.limit;
  const analyzeAll = rawLimit === "all";
  const limit = analyzeAll
    ? "all"
    : Math.min(5000, Math.max(1, Number(rawLimit ?? 50)));
  const cacheKey = `liked:${sessionId}:${analyzeAll ? "all" : limit}`;
  return handleAnalyze(c, {
    cacheKey,
    body,
    run: (onProgress) => analyzeLiked(token, limit, onProgress),
  });
});

serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (info) => {
  console.log(`API http://127.0.0.1:${info.port}`);
  for (const address of lanAddresses()) {
    console.log(`API http://${address}:${info.port}`);
  }
  console.log(`Default FE origin: ${FE_ORIGIN}`);
  const config = getSpotifyConfig();
  if (!config.configured) {
    console.log("Warning: SPOTIFY_CLIENT_ID not set — OAuth and long playlists unavailable.");
  } else {
    console.log(`Spotify redirect: ${config.redirectUri}`);
  }
});
