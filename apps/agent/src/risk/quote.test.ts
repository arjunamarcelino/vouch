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

test("clean established provider gets the full base cap (exposure factor 10000)", () => {
  const q = quoteGuarantee(envelope({}), PROVIDER, BASE);
  assert.equal(q.exposureFactorBps, "10000");
  assert.equal(q.recommendedGuaranteeCap, "100000000");
  assert.equal(q.scoringFnVersion, SCORING_FN_VERSION);
  assert.equal(q.asOfBlock, "5123987");
});

test("higher observed risk LOWERS the recommended exposure cap (exposure ceiling)", () => {
  const clean = quoteGuarantee(envelope({}), PROVIDER, BASE);
  const risky = quoteGuarantee(
    envelope({ upheldClaimRateBps: "2000", recentFailureRateBps: "1500" }),
    PROVIDER,
    BASE,
  );
  assert.ok(
    BigInt(risky.recommendedGuaranteeCap) < BigInt(clean.recommendedGuaranteeCap),
    "risky provider should be quoted a SMALLER exposure cap",
  );
});

test("exposure factor is floored at 3000 (30%) for the riskiest providers", () => {
  const extreme = quoteGuarantee(
    envelope({ upheldClaimRateBps: "10000", recentFailureRateBps: "10000" }),
    PROVIDER,
    BASE,
  );
  assert.equal(extreme.exposureFactorBps, "3000");
  assert.equal(extreme.recommendedGuaranteeCap, "30000000");
});

test("fail closed: non-FRESH data throws instead of quoting (allowlist FRESH)", () => {
  for (const conf of ["STALE", "DEGRADED"]) {
    assert.throws(
      () => quoteGuarantee(envelope({}, conf), PROVIDER, BASE),
      (err: unknown) => err instanceof VouchError && err.code === "SUBGRAPH_STALE",
      `expected refusal for dataConfidence=${conf}`,
    );
  }
});

test("new provider gets a conservative 0.5x cap, not fabricated history", () => {
  const q = quoteGuarantee(
    { kind: "new-provider", latestIndexedBlock: "5123987" },
    PROVIDER,
    BASE,
  );
  assert.equal(q.exposureFactorBps, "5000");
  assert.equal(q.recommendedGuaranteeCap, "50000000");
  assert.equal(q.upheldClaimRateBps, "-1");
});

test("insufficient history is treated cautiously (0.5x), not as a perfect record", () => {
  const q = quoteGuarantee(
    envelope({ upheldClaimRateBps: "-1", hasEnoughHistory: false, sampleSize: "0" }),
    PROVIDER,
    BASE,
  );
  assert.equal(q.exposureFactorBps, "5000");
});

test("undefined rates (-1) on an established provider reduce nothing (full factor)", () => {
  // hasEnoughHistory=true but rates undefined (e.g. many clean closed windows, no claims)
  const q = quoteGuarantee(
    envelope({ upheldClaimRateBps: "-1", recentFailureRateBps: "-1" }),
    PROVIDER,
    BASE,
  );
  assert.equal(q.exposureFactorBps, "10000");
});

test("no float / number fields leak into the quote", () => {
  const q = quoteGuarantee(envelope({ upheldClaimRateBps: "500" }), PROVIDER, BASE);
  for (const v of Object.values(q)) {
    assert.notEqual(typeof v, "number", "quote fields must be strings, never JS numbers");
  }
});
