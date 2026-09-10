import { clamp } from "@vouch/shared/bigint";

/**
 * Shared exposure-ceiling model (ADR-027) consumed by BOTH the v1 quote (`quote.ts`) and the v2 score
 * (`score.ts`) so the constants + computation can't drift between them (review 044 / pattern #4).
 *
 * The recommended guarantee cap is `baseCap * exposureFactorBps / 10000`: risk scales the factor DOWN
 * (never up), floored so coverage is never fully withdrawn; a new / insufficient-history provider gets
 * a conservative fixed fraction. All integer BigInt bps.
 */

export const FULL_FACTOR_BPS = 10_000n; // clean provider → full base cap
export const MIN_FACTOR_BPS = 3_000n; // riskiest provider floor → 30% of base
export const NEW_PROVIDER_FACTOR_BPS = 5_000n; // no / insufficient trustworthy history → 50% of base

const UPHELD_WEIGHT = 2n; // bps of upheld-claim rate → bps of exposure reduction
const RECENT_WEIGHT = 1n; // bps of recent-failure rate → bps of exposure reduction

function nonNeg(bps: bigint): bigint {
  return bps < 0n ? 0n : bps; // -1 (undefined) contributes no risk
}

/** Exposure factor for a provider WITH sufficient history: higher observed risk → lower factor. */
export function riskExposureFactorBps(upheldClaimRateBps: bigint, recentFailureRateBps: bigint): bigint {
  const riskBps = nonNeg(upheldClaimRateBps) * UPHELD_WEIGHT + nonNeg(recentFailureRateBps) * RECENT_WEIGHT;
  return clamp(FULL_FACTOR_BPS - riskBps, MIN_FACTOR_BPS, FULL_FACTOR_BPS);
}
