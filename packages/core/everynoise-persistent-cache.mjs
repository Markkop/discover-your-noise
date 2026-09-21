import fs from "node:fs/promises";
import path from "node:path";

const DIRECT_DIR = "direct";
const CANON_DIR = "canon";

let cacheRoot = null;

function assertArtistId(id) {
  if (!/^[A-Za-z0-9]{22}$/.test(String(id ?? ""))) {
    throw new Error("Invalid Spotify artist id for Every Noise cache.");
  }
}

function directPath(root, artistId) {
  return path.join(root, DIRECT_DIR, `${artistId}.json`);
}

function canonPath(root, artistId) {
  return path.join(root, CANON_DIR, `${artistId}.json`);
}

async function ensureLayout(root) {
  await fs.mkdir(path.join(root, DIRECT_DIR), { recursive: true });
  await fs.mkdir(path.join(root, CANON_DIR), { recursive: true });
}

async function readJsonFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return undefined;
    return parsed.filter((entry) => typeof entry === "string");
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    return undefined;
  }
}

async function writeJsonFile(filePath, value) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value)}\n`, "utf8");
  await fs.rename(tempPath, filePath);
}

export function configureEveryNoisePersistentCache(options = {}) {
  const dir = String(options.dir ?? process.env.EVERY_NOISE_CACHE_DIR ?? "").trim();
  cacheRoot = dir || null;
  return cacheRoot;
}

export function getEveryNoisePersistentCacheDir() {
  return cacheRoot;
}

export async function readPersistentDirectGenres(artistId) {
  if (!cacheRoot) return undefined;
  assertArtistId(artistId);
  return readJsonFile(directPath(cacheRoot, artistId));
}

export async function writePersistentDirectGenres(artistId, genres) {
  if (!cacheRoot) return;
  assertArtistId(artistId);
  await ensureLayout(cacheRoot);
  const list = Array.isArray(genres) ? genres.filter((g) => typeof g === "string") : [];
  await writeJsonFile(directPath(cacheRoot, artistId), list);
}

export async function readPersistentCanon(artistId) {
  if (!cacheRoot) return undefined;
  assertArtistId(artistId);
  const related = await readJsonFile(canonPath(cacheRoot, artistId));
  if (related === undefined) return undefined;
  return related.filter((id) => /^[A-Za-z0-9]{22}$/.test(id));
}

export async function writePersistentCanon(artistId, relatedIds) {
  if (!cacheRoot) return;
  assertArtistId(artistId);
  await ensureLayout(cacheRoot);
  const list = Array.isArray(relatedIds)
    ? relatedIds.filter((id) => /^[A-Za-z0-9]{22}$/.test(String(id)))
    : [];
  await writeJsonFile(canonPath(cacheRoot, artistId), list);
}

async function countFiles(dir) {
  try {
    const names = await fs.readdir(dir);
    return names.filter((name) => name.endsWith(".json")).length;
  } catch (error) {
    if (error?.code === "ENOENT") return 0;
    throw error;
  }
}

export async function getEveryNoisePersistentCacheStats() {
  if (!cacheRoot) {
    return { enabled: false, root: null, direct: 0, canon: 0, total: 0 };
  }
  const direct = await countFiles(path.join(cacheRoot, DIRECT_DIR));
  const canon = await countFiles(path.join(cacheRoot, CANON_DIR));
  return {
    enabled: true,
    root: cacheRoot,
    direct,
    canon,
    total: direct + canon,
  };
}

export async function clearEveryNoisePersistentCache() {
  if (!cacheRoot) {
    return { enabled: false, removed: 0 };
  }
  let removed = 0;
  for (const subdir of [DIRECT_DIR, CANON_DIR]) {
    const dir = path.join(cacheRoot, subdir);
    try {
      const names = await fs.readdir(dir);
      for (const name of names) {
        if (!name.endsWith(".json")) continue;
        await fs.unlink(path.join(dir, name));
        removed += 1;
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return { enabled: true, root: cacheRoot, removed };
}
