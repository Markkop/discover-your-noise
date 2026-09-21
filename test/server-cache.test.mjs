import assert from "node:assert/strict";
import test from "node:test";

import { deleteCache, getCache, setCache, withCache } from "../apps/server/src/cache.mjs";

test("deleteCache removes a stored entry", () => {
  setCache("demo", { status: "ok", report: {} }, 60_000);
  assert.ok(getCache("demo"));
  assert.equal(deleteCache("demo"), true);
  assert.equal(getCache("demo"), null);
});

test("withCache runs again after deleteCache", async () => {
  let runs = 0;
  const run = async () => {
    runs += 1;
    return { status: "ok", report: { n: runs } };
  };

  const first = await withCache("rerun", run);
  assert.equal(first.cached, false);
  assert.equal(first.report.n, 1);

  const second = await withCache("rerun", run);
  assert.equal(second.cached, true);
  assert.equal(second.report.n, 1);

  deleteCache("rerun");
  const third = await withCache("rerun", run);
  assert.equal(third.cached, false);
  assert.equal(third.report.n, 2);
});
