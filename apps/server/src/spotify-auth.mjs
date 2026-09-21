import { createHash, randomBytes } from "node:crypto";

const SCOPES = [
  "playlist-read-private",
  "playlist-read-collaborative",
  "user-library-read",
  "user-read-private",
  "user-read-email",
].join(" ");

function b64url(buffer) {
  return buffer.toString("base64url");
}

export function createPkcePair() {
  const verifier = b64url(randomBytes(32));
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function getSpotifyConfig() {
  const clientId = process.env.SPOTIFY_CLIENT_ID ?? "";
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET ?? "";
  const redirectUri =
    process.env.SPOTIFY_REDIRECT_URI ?? "http://127.0.0.1:3001/api/auth/callback";
  return { clientId, clientSecret, redirectUri, configured: Boolean(clientId) };
}

export function buildAuthorizeUrl({ clientId, redirectUri, state, challenge }) {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: SCOPES,
    state,
    code_challenge_method: "S256",
    code_challenge: challenge,
  });
  return `https://accounts.spotify.com/authorize?${params}`;
}

export async function exchangeCode({ code, verifier, clientId, clientSecret, redirectUri }) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier,
  });
  if (clientSecret) body.set("client_secret", clientSecret);

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Spotify token exchange failed: ${text.slice(0, 200)}`);
  }
  return response.json();
}

export async function refreshAccessToken({ refreshToken, clientId, clientSecret }) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  });
  if (clientSecret) body.set("client_secret", clientSecret);

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Spotify refresh failed: ${text.slice(0, 200)}`);
  }
  return response.json();
}

export async function fetchSpotifyProfile(accessToken) {
  const response = await fetch("https://api.spotify.com/v1/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return null;
  return response.json();
}
