import { test } from "node:test";
import assert from "node:assert/strict";
import { quoteGuarantee } from "./quote";
import { SCORING_FN_VERSION, type ProviderRiskFeatures } from "@vouch/shared/schemas";
import { VouchError } from "@vouch/shared/errors";
import type { ProviderRiskResult } from "../graph/client";

const PROVIDER = `0x${"1".repeat(40)}`;
const BASE = 100_000_000n; // 100 USDC (6-dec)

function features(overrides: Partial<ProviderRiskFeatures>): ProviderRiskFeatures {
  return {
    completedJobs: "10",
    upheldClaimRateBps: "0",
    recentFailureRateBps: "0",
    averageCoverageRatioBps: "50000",
    totalCoveredAmount: "200000000",
    totalPaidClaims: "0",
    sampleSize: "5",
    hasEnoughHistory: true,
    ...overrides,
  };
}

function envelope(f: Partial<ProviderRiskFeatures>, dataConfidence = "FRESH"): ProviderRiskResult {
  return {
    kind: "features",
    envelope: {
      features: features(f),
      dataConfidence: dataConfidence as "FRESH" | "DEGRADED" | "STALE",
      latestIndexedBlock: "5123987",
      asOfBlock: "5123987",
    },
  };
}

test("clean established provider gets the base cap and base premium", () => {
  const q = quoteGuarantee(envelope({}), PROVIDER, BASE);
  assert.equal(q.premiumBps, "10000");
  assert.equal(q.recommendedGuaranteeCap, "100000000");
  assert.equal(q.scoringFnVersion, SCORING_FN_VERSION);
  assert.equal(q.asOfBlock, "5123987");
});

test("higher observed risk widens the recommended cap", () => {
  const clean = quoteGuarantee(envelope({}), PROVIDER, BASE);
  const risky = quoteGuarantee(
    envelope({ upheldClaimRateBps: "2000", recentFailureRateBps: "1500" }),
    PROVIDER,
    BASE,
  );
  assert.ok(
    BigInt(risky.recommendedGuaranteeCap) > BigInt(clean.recommendedGuaranteeCap),
    "risky provider should be quoted a larger cap",
  );
});

test("premium is clamped to the 3x band", () => {
  const extreme = quoteGuarantee(
    envelope({ upheldClaimRateBps: "10000", recentFailureRateBps: "10000" }),
    PROVIDER,
    BASE,
  );
  assert.equal(extreme.premiumBps, "30000");
  assert.equal(extreme.recommendedGuaranteeCap, "300000000");
});

test("fail closed: STALE data throws instead of quoting", () => {
  assert.throws(
    () => quoteGuarantee(envelope({}, "STALE"), PROVIDER, BASE),
    (err: unknown) => err instanceof VouchError && err.code === "SUBGRAPH_STALE",
  );
});

test("new provider gets a conservative 1.5x cap, not fabricated history", () => {
  const q = quoteGuarantee(
    { kind: "new-provider", latestIndexedBlock: "5123987" },
    PROVIDER,
    BASE,
  );
  assert.equal(q.premiumBps, "15000");
  assert.equal(q.recommendedGuaranteeCap, "150000000");
  assert.equal(q.upheldClaimRateBps, "-1");
});

test("insufficient history is treated cautiously, not as a perfect record", () => {
  // undefined rates (-1) + hasEnoughHistory=false must NOT read as premium 1.0x
  const q = quoteGuarantee(
    envelope({ upheldClaimRateBps: "-1", hasEnoughHistory: false, sampleSize: "0" }),
    PROVIDER,
    BASE,
  );
  assert.equal(q.premiumBps, "15000");
});

test("no float / number fields leak into the quote", () => {
  const q = quoteGuarantee(envelope({ upheldClaimRateBps: "500" }), PROVIDER, BASE);
  for (const v of Object.values(q)) {
    assert.notEqual(typeof v, "number", "quote fields must be strings, never JS numbers");
  }
});
