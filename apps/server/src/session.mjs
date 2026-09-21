import { randomBytes } from "node:crypto";

const sessions = new Map();
const oauthStates = new Map();

const SESSION_COOKIE = "dyn_session";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export function getSessionCookieName() {
  return SESSION_COOKIE;
}

export function createSession(data) {
  const id = randomBytes(24).toString("hex");
  sessions.set(id, { ...data, createdAt: Date.now() });
  return id;
}

export function getSession(id) {
  if (!id) return null;
  const session = sessions.get(id);
  if (!session) return null;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(id);
    return null;
  }
  return session;
}

export function updateSession(id, patch) {
  const session = getSession(id);
  if (!session) return null;
  Object.assign(session, patch);
  sessions.set(id, session);
  return session;
}

export function deleteSession(id) {
  sessions.delete(id);
}

export function storeOAuthState(state, payload) {
  oauthStates.set(state, { ...payload, createdAt: Date.now() });
}

export function consumeOAuthState(state) {
  const entry = oauthStates.get(state);
  oauthStates.delete(state);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > 10 * 60 * 1000) return null;
  return entry;
}

export function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name) cookies[name] = decodeURIComponent(rest.join("="));
  }
  return cookies;
}
