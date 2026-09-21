import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  classifyArtists,
  clearEveryNoiseMemoryCaches,
  clearEveryNoisePersistentCache,
  configureEveryNoisePersistentCache,
  getEveryNoisePersistentCacheStats,
  readPersistentDirectGenres,
} from "../packages/core/index.mjs";

const ARTIST_A = "1CsZ0ihKPWBDUERlQt8ekr";
const ARTIST_B = "4l8S3gH7kFBB9XcI7EtUoT";

test("persists direct Every Noise genres to disk and reuses them", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dyn-en-cache-"));
  configureEveryNoisePersistentCache({ dir: root });
  clearEveryNoiseMemoryCaches();

  let networkCalls = 0;
  const fetchImpl = async () => {
    networkCalls += 1;
    return {
      ok: true,
      headers: { get: () => null },
      json: async () => ({ [ARTIST_A]: ["ambient"] }),
    };
  };

  await classifyArtists([{ id: ARTIST_A, name: "A" }], fetchImpl);
  assert.equal(networkCalls, 1);
  assert.deepEqual(await readPersistentDirectGenres(ARTIST_A), ["ambient"]);

  clearEveryNoiseMemoryCaches();
  await classifyArtists([{ id: ARTIST_A, name: "A" }], fetchImpl);
  assert.equal(networkCalls, 1);

  const stats = await getEveryNoisePersistentCacheStats();
  assert.equal(stats.direct, 1);

  const cleared = await clearEveryNoisePersistentCache();
  assert.equal(cleared.removed, 1);
  configureEveryNoisePersistentCache({ dir: null });
  await fs.rm(root, { recursive: true, force: true });
});

test("persists empty direct mappings to avoid repeat lookups", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dyn-en-cache-"));
  configureEveryNoisePersistentCache({ dir: root });
  clearEveryNoiseMemoryCaches();

  let networkCalls = 0;
  const fetchImpl = async (url) => {
    networkCalls += 1;
    if (url.includes("/canon/")) {
      return {
        ok: true,
        headers: { get: () => null },
        json: async () => ({ [ARTIST_B]: [] }),
      };
    }
    return {
      ok: true,
      headers: { get: () => null },
      json: async () => ({}),
    };
  };

  await classifyArtists([{ id: ARTIST_B, name: "B" }], fetchImpl);
  assert.ok(networkCalls >= 1);

  clearEveryNoiseMemoryCaches();
  const before = networkCalls;
  await classifyArtists([{ id: ARTIST_B, name: "B" }], fetchImpl);
  assert.equal(networkCalls, before);

  configureEveryNoisePersistentCache({ dir: null });
  await fs.rm(root, { recursive: true, force: true });
});
