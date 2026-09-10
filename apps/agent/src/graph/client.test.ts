import { test } from "node:test";
import assert from "node:assert/strict";
import { checkFreshness, type FreshnessConfig, type Meta } from "@vouch/shared/graph";
import { VouchError } from "@vouch/shared/errors";
import { recentFailureRateBps } from "./client";

// ---- recentFailureRateBps (028) ----

test("recentFailureRateBps: empty window → -1 sentinel (no recent volume)", () => {
  assert.equal(recentFailureRateBps([]), -1n);
  assert.equal(recentFailureRateBps([{ upheldFailures: "0", closedWindows: "0" }]), -1n);
});

test("recentFailureRateBps: failures over closed windows, integer-floored bps", () => {
  // 1 upheld / 3 closed = 3333 bps (floored)
  assert.equal(
    recentFailureRateBps([
      { upheldFailures: "1", closedWindows: "2" },
      { upheldFailures: "0", closedWindows: "1" },
    ]),
    3333n,
  );
  // 2 upheld / 4 closed = 5000 bps
  assert.equal(recentFailureRateBps([{ upheldFailures: "2", closedWindows: "4" }]), 5000n);
});

test("recentFailureRateBps: malformed value → typed VouchError, not a raw throw", () => {
  assert.throws(
    () => recentFailureRateBps([{ upheldFailures: "x", closedWindows: "1" }]),
    (err: unknown) => err instanceof VouchError && err.code === "SUBGRAPH_UNAVAILABLE",
  );
});

// ---- checkFreshness (the freshness gate — 019/022) ----

const CFG: FreshnessConfig = {
  rpcUrl: "http://rpc", // unused by checkFreshness (pure over meta + head)
  maxLagBlocks: 25,
  maxStalenessSeconds: 180,
  deploymentId: "Qm-expected",
  nowSeconds: 1_000_000,
};

function meta(over: Partial<Meta> & { number?: number; timestamp?: number | null }): Meta {
  return {
    block: {
      number: over.number ?? 1000,
      timestamp: over.timestamp === undefined ? 1_000_000 : over.timestamp,
    },
    deployment: over.deployment ?? "Qm-expected",
    hasIndexingErrors: over.hasIndexingErrors ?? false,
  };
}

test("checkFreshness: fresh + synced passes", () => {
  const f = checkFreshness(meta({ number: 1000 }), 1010n, CFG);
  assert.equal(f.dataConfidence, "FRESH");
  assert.equal(f.latestIndexedBlock, 1000n);
});

test("checkFreshness: refuses null _meta, indexing errors, deployment mismatch", () => {
  assert.throws(() => checkFreshness(null, 1010n, CFG), (e: unknown) => e instanceof VouchError);
  assert.throws(
    () => checkFreshness(meta({ hasIndexingErrors: true }), 1010n, CFG),
    (e: unknown) => e instanceof VouchError && e.code === "SUBGRAPH_STALE",
  );
  assert.throws(
    () => checkFreshness(meta({ deployment: "Qm-other" }), 1010n, CFG),
    (e: unknown) => e instanceof VouchError && e.code === "SUBGRAPH_UNAVAILABLE",
  );
});

test("checkFreshness: refuses when lag exceeds budget or is negative", () => {
  assert.throws(
    () => checkFreshness(meta({ number: 1000 }), 2000n, CFG), // lag 1000 > 25
    (e: unknown) => e instanceof VouchError && e.code === "SUBGRAPH_LAGGING",
  );
  assert.throws(
    () => checkFreshness(meta({ number: 1000 }), 900n, CFG), // head behind indexed
    (e: unknown) => e instanceof VouchError && e.code === "SUBGRAPH_LAGGING",
  );
});

test("checkFreshness: quiet chain (lag 0, old block) passes; wall-clock refuses only when block-behind", () => {
  // lag 0 but block ~5min old, within the absolute ceiling (180*10=1800s) → quiet chain, allowed
  const quiet = checkFreshness(meta({ number: 1000, timestamp: 1_000_000 - 300 }), 1000n, CFG);
  assert.equal(quiet.dataConfidence, "FRESH");
  // block-behind AND stale → refuse
  assert.throws(
    () => checkFreshness(meta({ number: 990, timestamp: 1_000_000 - 300 }), 1000n, CFG),
    (e: unknown) => e instanceof VouchError && e.code === "SUBGRAPH_STALE",
  );
});

test("checkFreshness: absolute staleness ceiling refuses even at lag 0 (frozen/lying RPC)", () => {
  // lag 0 but block 2000s old > 1800s absolute ceiling → refuse
  assert.throws(
    () => checkFreshness(meta({ number: 1000, timestamp: 1_000_000 - 2000 }), 1000n, CFG),
    (e: unknown) => e instanceof VouchError && e.code === "SUBGRAPH_STALE",
  );
});

test("checkFreshness: null block timestamp refuses", () => {
  assert.throws(
    () => checkFreshness(meta({ number: 1000, timestamp: null }), 1010n, CFG),
    (e: unknown) => e instanceof VouchError && e.code === "SUBGRAPH_STALE",
  );
});
