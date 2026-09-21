const store = new Map();
const DEFAULT_TTL_MS = Number(process.env.CACHE_TTL_MS ?? 3_600_000);
const MAX_ENTRIES = Number(process.env.CACHE_MAX_ENTRIES ?? 200);

export function getCache(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

export function setCache(key, value, ttlMs = DEFAULT_TTL_MS) {
  if (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function deleteCache(key) {
  return store.delete(key);
}

export async function withCache(key, fn, onProgress) {
  const cached = getCache(key);
  if (cached) {
    onProgress?.({ phase: "cache", pct: 100, message: "Served from cache." });
    return { ...cached, cached: true };
  }
  const value = await fn(onProgress);
  if (value?.status === "ok") setCache(key, value);
  return { ...value, cached: false };
}
