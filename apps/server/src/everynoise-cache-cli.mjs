import path from "node:path";
import {
  clearEveryNoisePersistentCache,
  configureEveryNoisePersistentCache,
  getEveryNoisePersistentCacheStats,
} from "@discover-your-noise/core";

const command = String(process.argv[2] ?? "stats").trim().toLowerCase();
configureEveryNoisePersistentCache();

async function flushRunningServerMemory() {
  const adminKey = process.env.EVERY_NOISE_CACHE_ADMIN_KEY;
  const port = process.env.PORT ?? "3001";
  if (!adminKey) return { flushed: false, reason: "EVERY_NOISE_CACHE_ADMIN_KEY not set" };
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/everynoise-cache/clear`, {
      method: "POST",
      headers: { "x-cache-admin-key": adminKey },
    });
    if (!response.ok) {
      return { flushed: false, reason: `HTTP ${response.status}` };
    }
    return { flushed: true, ...(await response.json()) };
  } catch (error) {
    return { flushed: false, reason: error.message };
  }
}

if (command === "stats") {
  const stats = await getEveryNoisePersistentCacheStats();
  console.log(JSON.stringify(stats, null, 2));
  process.exit(stats.enabled ? 0 : 1);
}

if (command === "clear") {
  const memory = await flushRunningServerMemory();
  if (memory.flushed) {
    console.log(JSON.stringify({ via: "api", ...memory }, null, 2));
    process.exit(0);
  }
  const disk = await clearEveryNoisePersistentCache();
  console.log(JSON.stringify({ disk, memory }, null, 2));
  process.exit(disk.enabled ? 0 : 1);
}

console.error(`Usage: node ${path.basename(process.argv[1])} <stats|clear>`);
process.exit(2);
