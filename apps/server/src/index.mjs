import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { deleteCookie, setCookie } from "hono/cookie";
import { randomBytes } from "node:crypto";
import { networkInterfaces } from "node:os";
import { analyzeLiked, analyzePlaylistUrl } from "./analyze-route.mjs";
import { withCache } from "./cache.mjs";
import { parsePlaylistId } from "@discover-your-noise/core";
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
const COOKIE_NAME = getSessionCookieName();

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
  if (!value) return FE_ORIGIN;
  try {
    const url = new URL(value);
    if (!isAllowedOrigin(url.origin)) return FE_ORIGIN;
    return url.origin;
  } catch {
    return FE_ORIGIN;
  }
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
  setCookie(c, COOKIE_NAME, sessionId, {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    maxAge: 86400,
  });
}

function eraseSessionCookie(c) {
  deleteCookie(c, COOKIE_NAME, { path: "/" });
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
  const returnTo = normalizeReturnTo(c.req.query("return_to"));
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
  const returnTo = normalizeReturnTo(stored?.returnTo);
  if (!code || !stored) {
    return c.redirect(`${returnTo}?auth=failed`);
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
  return c.redirect(`${returnTo}?auth=ok`);
});

app.post("/api/auth/logout", (c) => {
  const cookies = parseCookies(c.req.header("cookie"));
  deleteSession(cookies[COOKIE_NAME]);
  eraseSessionCookie(c);
  return c.json({ ok: true });
});

app.post("/api/analyze", async (c) => {
  const body = await c.req.json();
  const url = String(body?.url ?? "").trim();
  if (!url) return c.json({ error: "url is required" }, 400);

  const sessionId = sessionIdFromRequest(c);
  const token = sessionId ? await ensureAccessToken(sessionId) : null;

  try {
    let cacheKey = null;
    try {
      cacheKey = `playlist:${parsePlaylistId(url)}`;
    } catch {
      cacheKey = null;
    }
    const result = cacheKey
      ? await withCache(cacheKey, () => analyzePlaylistUrl(url, token))
      : { ...(await analyzePlaylistUrl(url, token)), cached: false };
    return c.json(result);
  } catch (error) {
    return c.json({ error: error.message }, 400);
  }
});

app.post("/api/analyze/liked", async (c) => {
  const sessionId = sessionIdFromRequest(c);
  const token = sessionId ? await ensureAccessToken(sessionId) : null;
  if (!token) {
    return c.json({ status: "auth_required", message: "Connect Spotify to analyze liked songs." });
  }
  const body = await c.req.json().catch(() => ({}));
  const limit = Math.min(100, Math.max(1, Number(body?.limit ?? 100)));
  try {
    const result = await withCache(`liked:${sessionId}:${limit}`, () => analyzeLiked(token, limit));
    return c.json(result);
  } catch (error) {
    return c.json({ error: error.message }, 400);
  }
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
