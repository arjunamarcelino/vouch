import {
  riskQuoteSchema,
  parseOrThrow,
  SCORING_FN_VERSION,
  type RiskQuote,
} from "@vouch/shared/schemas";
import { VouchError } from "@vouch/shared/errors";
import type { ProviderRiskResult } from "../graph/client";

/**
 * Autonomous risk-quotation: turn LIVE indexed provider history into a recommended guarantee EXPOSURE
 * CEILING. This is the "meaningful AI work on live Graph data" that anchors the The Graph track.
 *
 * `recommendedGuaranteeCap` is a MAX exposure: risk scales it DOWN, never up (027). A clean provider
 * earns the full base cap (exposureFactor 10000); riskier providers earn less, floored so coverage is
 * never fully withdrawn; a new / insufficient-history provider gets a conservative fraction.
 *
 * FAIL CLOSED (plan §6): only a FRESH envelope may quote — anything else throws (never a fabricated
 * quote). A genuinely new provider (fresh index, no history) gets a documented conservative policy.
 *
 * ALL INTEGER (plan §4 / §3.5): every ratio is BigInt basis points, every amount is USDC base units.
 * No `Number()`, `Math.*`, or `toFixed` — 6-dec USDC counters routinely exceed 2^53.
 */

const FULL_FACTOR_BPS = 10_000n; // clean provider → full base cap
const MIN_FACTOR_BPS = 3_000n; // riskiest provider floor → 30% of base (coverage never fully withdrawn)
// Conservative exposure for a provider with no / insufficient trustworthy history (50% of base).
const NEW_PROVIDER_FACTOR_BPS = 5_000n;
// Risk weights (bps of risk signal → bps of exposure reduction).
const UPHELD_WEIGHT = 2n;
const RECENT_WEIGHT = 1n;

function nonNeg(bps: bigint): bigint {
  return bps < 0n ? 0n : bps; // -1 (undefined) contributes no risk
}

function clampFactor(bps: bigint): bigint {
  if (bps < MIN_FACTOR_BPS) return MIN_FACTOR_BPS;
  if (bps > FULL_FACTOR_BPS) return FULL_FACTOR_BPS;
  return bps;
}

function buildQuote(
  provider: string,
  cap: bigint,
  exposureFactorBps: bigint,
  upheldClaimRateBps: string,
  recentFailureRateBps: string,
  dataConfidence: "FRESH" | "DEGRADED" | "STALE",
  asOfBlock: string,
  rationale: string,
): RiskQuote {
  return parseOrThrow(
    riskQuoteSchema,
    {
      provider,
      recommendedGuaranteeCap: cap.toString(),
      exposureFactorBps: exposureFactorBps.toString(),
      upheldClaimRateBps,
      recentFailureRateBps,
      dataConfidence,
      asOfBlock,
      scoringFnVersion: SCORING_FN_VERSION,
      rationale,
    },
    "risk quote",
  );
}

export function quoteGuarantee(
  result: ProviderRiskResult,
  provider: string,
  baseCapBaseUnits: bigint,
): RiskQuote {
  // --- New provider: fresh index, genuinely no history. Conservative, documented, not fabricated. ---
  if (result.kind === "new-provider") {
    const cap = (baseCapBaseUnits * NEW_PROVIDER_FACTOR_BPS) / 10_000n;
    return buildQuote(
      provider,
      cap,
      NEW_PROVIDER_FACTOR_BPS,
      "-1",
      "-1",
      "FRESH",
      result.latestIndexedBlock,
      "new provider — no indexed history; conservative 0.5x base exposure",
    );
  }

  const { features, dataConfidence, asOfBlock } = result.envelope;

  // Fail closed: only FRESH may quote (allowlist, not a STALE denylist — 026). Defense-in-depth;
  // getProviderRisk already throws on stale/lagging upstream.
  if (dataConfidence !== "FRESH") {
    throw new VouchError("SUBGRAPH_STALE", `Refusing to quote: dataConfidence=${dataConfidence}`);
  }

  // Insufficient history → conservative, driven by the sample-size guard, NOT by reading an undefined
  // (-1) rate as a perfect record.
  if (!features.hasEnoughHistory) {
    const cap = (baseCapBaseUnits * NEW_PROVIDER_FACTOR_BPS) / 10_000n;
    return buildQuote(
      provider,
      cap,
      NEW_PROVIDER_FACTOR_BPS,
      features.upheldClaimRateBps,
      features.recentFailureRateBps,
      dataConfidence,
      asOfBlock,
      `insufficient history (sampleSize=${features.sampleSize}); conservative 0.5x exposure`,
    );
  }

  // Higher observed risk → LOWER exposure factor (exposure ceiling). Undefined rates reduce nothing.
  const upheldBps = BigInt(features.upheldClaimRateBps);
  const recentBps = BigInt(features.recentFailureRateBps);
  const riskBps = nonNeg(upheldBps) * UPHELD_WEIGHT + nonNeg(recentBps) * RECENT_WEIGHT;
  const exposureFactorBps = clampFactor(FULL_FACTOR_BPS - riskBps);
  const cap = (baseCapBaseUnits * exposureFactorBps) / 10_000n;

  return buildQuote(
    provider,
    cap,
    exposureFactorBps,
    features.upheldClaimRateBps,
    features.recentFailureRateBps,
    dataConfidence,
    asOfBlock,
    `upheldClaimRate=${features.upheldClaimRateBps}bps, ` +
      `recentFailureRate=${features.recentFailureRateBps}bps, ` +
      `exposureFactor=${exposureFactorBps.toString()}bps (sampleSize=${features.sampleSize})`,
  );
}
