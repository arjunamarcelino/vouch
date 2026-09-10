import { test } from "node:test";
import assert from "node:assert/strict";
import { VouchError } from "@vouch/shared/errors";
import type { JobRequest } from "@vouch/shared/schemas";
import type { ProviderRiskResult } from "../graph/client";
import { scoreQuote, BASE_RISK_RATE_BPS, type ScoreParams } from "./score";

const PROVIDER = "0x1111111111111111111111111111111111111111";
const PAYER = "0x2222222222222222222222222222222222222222";
const PAYEE = "0x3333333333333333333333333333333333333333";
const USDC = "0x3600000000000000000000000000000000000000";

const PARAMS: ScoreParams = { baseGuaranteeCap: 100_000_000n }; // 100 USDC (6-dec)

function job(overrides: Partial<JobRequest> = {}): JobRequest {
  return {
    provider: PROVIDER,
    payer: PAYER,
    payee: PAYEE,
    token: USDC,
    taskFee: "20000000", // 20 USDC
    requestedGuarantee: "100000000", // 100 USDC
    providerCollateral: "100000000",
    coverageDurationSeconds: "86400", // 1 day baseline
    taskCategory: "CODE_FIX",
    verificationMethod: "PRIVATE_REGRESSION",
    ...overrides,
  };
}

function features(overrides: Record<string, unknown> = {}): ProviderRiskResult {
  return {
    kind: "features",
    envelope: {
      features: {
        completedJobs: "50",
        upheldClaimRateBps: "0",
        recentFailureRateBps: "0",
        averageCoverageRatioBps: "0",
        totalCoveredAmount: "0",
        totalPaidClaims: "0",
        sampleSize: "50",
        hasEnoughHistory: true,
        ...overrides,
      },
      dataConfidence: "FRESH",
      latestIndexedBlock: "1000",
      asOfBlock: "1000",
    },
  } as ProviderRiskResult;
}

test("clean provider with rich history: full exposure, floor-ish premium, HIGH confidence", () => {
  const s = scoreQuote(features(), job(), PARAMS);
  assert.equal(s.scoringFnVersion, "2.0.0");
  assert.equal(s.exposureFactorBps, "10000"); // no risk → full base cap
  assert.equal(s.recommendedGuaranteeLimit, "100000000");
  assert.equal(s.confidenceLevel, "HIGH");
  // base 200 - history discount (min(50*10,300)=300) then floored at MIN_PREMIUM 50
  assert.equal(s.premiumBps, "50");
  assert.ok(s.reasonCodes.includes("HISTORY_DISCOUNT_APPLIED"));
  assert.ok(s.reasonCodes.includes("PREMIUM_CAPPED"));
  assert.ok(s.reasonCodes.includes("FRESH_DATA"));
});

test("upheld-claim risk raises premium and lowers exposure", () => {
  const s = scoreQuote(features({ upheldClaimRateBps: "1000" }), job(), PARAMS);
  assert.ok(s.reasonCodes.includes("UPHELD_CLAIM_RISK"));
  // exposure reduced by upheld*2 = 2000 → 8000
  assert.equal(s.exposureFactorBps, "8000");
  assert.equal(s.recommendedGuaranteeLimit, "80000000");
  assert.ok(BigInt(s.premiumBps) > BASE_RISK_RATE_BPS - 300n); // upheld surcharge offsets discount
});

test("recent-failure risk raises premium", () => {
  const clean = scoreQuote(features(), job(), PARAMS);
  const risky = scoreQuote(features({ recentFailureRateBps: "2000" }), job(), PARAMS);
  assert.ok(risky.reasonCodes.includes("RECENT_FAILURE_RISK"));
  assert.ok(BigInt(risky.premiumBps) > BigInt(clean.premiumBps));
});

test("-1 sentinel contributes zero risk (not read as perfect or as huge)", () => {
  const s = scoreQuote(
    features({ upheldClaimRateBps: "-1", recentFailureRateBps: "-1" }),
    job(),
    PARAMS,
  );
  assert.ok(!s.reasonCodes.includes("UPHELD_CLAIM_RISK"));
  assert.ok(!s.reasonCodes.includes("RECENT_FAILURE_RISK"));
  assert.equal(s.exposureFactorBps, "10000");
});

test("long coverage duration adds a capped surcharge", () => {
  const s = scoreQuote(features(), job({ coverageDurationSeconds: String(86400 * 40) }), PARAMS);
  assert.ok(s.reasonCodes.includes("LONG_COVERAGE_SURCHARGE"));
  // 39 extra days * 25 = 975 → capped at 400
  const base = scoreQuote(features(), job(), PARAMS);
  assert.ok(BigInt(s.premiumBps) - BigInt(base.premiumBps) <= 400n);
});

test("high guarantee-to-fee ratio adds a surcharge", () => {
  // guarantee 100 / fee 1 = 100x >> 5x threshold
  const s = scoreQuote(features(), job({ taskFee: "1000000", requestedGuarantee: "100000000" }), PARAMS);
  assert.ok(s.reasonCodes.includes("HIGH_GUARANTEE_FEE_RATIO"));
});

test("insufficient history: conservative surcharge + reduced exposure + LOW confidence", () => {
  const s = scoreQuote(
    features({ hasEnoughHistory: false, sampleSize: "2", completedJobs: "2" }),
    job(),
    PARAMS,
  );
  assert.ok(s.reasonCodes.includes("INSUFFICIENT_HISTORY_SURCHARGE"));
  assert.equal(s.exposureFactorBps, "5000");
  assert.equal(s.recommendedGuaranteeLimit, "50000000");
  assert.equal(s.confidenceLevel, "LOW");
});

test("new provider: conservative policy, LOW confidence, uses latestIndexedBlock", () => {
  const result: ProviderRiskResult = { kind: "new-provider", latestIndexedBlock: "777" };
  const s = scoreQuote(result, job(), PARAMS);
  assert.ok(s.reasonCodes.includes("NEW_PROVIDER_CONSERVATIVE"));
  assert.equal(s.exposureFactorBps, "5000");
  assert.equal(s.confidenceLevel, "LOW");
  assert.equal(s.asOfBlock, "777");
});

test("oversized guarantee request is flagged and effective collateral floored to the ceiling", () => {
  // request 200 USDC guarantee, ceiling is 100 (clean, full factor)
  const s = scoreQuote(features(), job({ requestedGuarantee: "200000000", providerCollateral: "0" }), PARAMS);
  assert.ok(s.reasonCodes.includes("GUARANTEE_EXCEEDS_LIMIT"));
  assert.ok(s.reasonCodes.includes("COLLATERAL_FLOOR_APPLIED"));
  // minProviderCollateral = min(requested, ceiling) = 100 USDC
  assert.equal(s.minProviderCollateral, "100000000");
});

test("service fee is rounded up and capped at the absolute ceiling", () => {
  // Large task fee at max premium would yield 20 USDC fee; low absolute cap of 5 USDC bites.
  const params: ScoreParams = { baseGuaranteeCap: 100_000_000n, maxServiceFee: 5_000_000n };
  const s = scoreQuote(
    features({ upheldClaimRateBps: "10000", recentFailureRateBps: "10000" }),
    job({ taskFee: "100000000" }),
    params,
  );
  assert.equal(s.assuranceServiceFee, "5000000");
  assert.ok(s.reasonCodes.includes("SERVICE_FEE_CAPPED"));
});

test("service fee rounds UP (never truncates a charged fee to a smaller amount)", () => {
  // taskFee such that fee*premium is non-divisible by 10000 → ceil > floor
  const s = scoreQuote(features({ upheldClaimRateBps: "333" }), job({ taskFee: "20000001" }), PARAMS);
  const premium = BigInt(s.premiumBps);
  const floorFee = (20000001n * premium) / 10000n;
  assert.ok(BigInt(s.assuranceServiceFee) >= floorFee);
});

test("premium is capped at MAX_PREMIUM_BPS under extreme risk", () => {
  const s = scoreQuote(features({ upheldClaimRateBps: "10000", recentFailureRateBps: "10000" }), job(), PARAMS);
  assert.equal(s.premiumBps, "2000");
  assert.ok(s.reasonCodes.includes("PREMIUM_CAPPED"));
});

test("fails closed on non-FRESH data (never fabricates a score)", () => {
  const stale = features();
  (stale as { envelope: { dataConfidence: string } }).envelope.dataConfidence = "STALE";
  assert.throws(
    () => scoreQuote(stale, job(), PARAMS),
    (err: unknown) => err instanceof VouchError && err.code === "SUBGRAPH_STALE",
  );
});

test("all monetary outputs are integer base-unit strings (no float, no decimals)", () => {
  const s = scoreQuote(features({ upheldClaimRateBps: "333", recentFailureRateBps: "777" }), job(), PARAMS);
  for (const v of [s.recommendedGuaranteeLimit, s.assuranceServiceFee, s.minProviderCollateral]) {
    assert.match(v, /^\d+$/u);
  }
});
