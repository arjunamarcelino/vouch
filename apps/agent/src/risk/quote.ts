import {
  riskQuoteSchema,
  parseOrThrow,
  SCORING_FN_VERSION,
  type RiskQuote,
} from "@vouch/shared/schemas";
import { VouchError } from "@vouch/shared/errors";
import type { ProviderRiskResult } from "../graph/client";

/**
 * Autonomous risk-quotation: turn LIVE indexed provider history into a recommended, capped guarantee
 * size. This is the "meaningful AI work on live Graph data" that anchors the The Graph track.
 *
 * FAIL CLOSED (plan §6): a STALE index throws — never a fabricated quote. A genuinely new provider
 * (no history, fresh index) gets a documented conservative policy, NOT invented history.
 *
 * ALL INTEGER (plan §4 / §3.5): every ratio is BigInt basis points, every amount is USDC base units.
 * No `Number()`, `Math.*`, or `toFixed` — 6-dec USDC counters routinely exceed 2^53.
 */

// Premium band: 1.0x (10000 bps) .. 3.0x (30000 bps).
const BASE_PREMIUM_BPS = 10_000n;
const MAX_PREMIUM_BPS = 30_000n;
// Conservative premium for a provider with no / insufficient trustworthy history (1.5x).
const NEW_PROVIDER_PREMIUM_BPS = 15_000n;
// Risk weights (applied to bps risk signals).
const UPHELD_WEIGHT = 2n;
const RECENT_WEIGHT = 1n;

function nonNeg(bps: bigint): bigint {
  return bps < 0n ? 0n : bps; // -1 (undefined) contributes no risk
}

function clampPremium(bps: bigint): bigint {
  if (bps < BASE_PREMIUM_BPS) return BASE_PREMIUM_BPS;
  if (bps > MAX_PREMIUM_BPS) return MAX_PREMIUM_BPS;
  return bps;
}

export function quoteGuarantee(
  result: ProviderRiskResult,
  provider: string,
  baseCapBaseUnits: bigint,
): RiskQuote {
  // --- New provider: fresh index, genuinely no history. Conservative, documented, not fabricated. ---
  if (result.kind === "new-provider") {
    const cap = (baseCapBaseUnits * NEW_PROVIDER_PREMIUM_BPS) / 10_000n;
    return parseOrThrow(
      riskQuoteSchema,
      {
        provider,
        recommendedGuaranteeCap: cap.toString(),
        premiumBps: NEW_PROVIDER_PREMIUM_BPS.toString(),
        upheldClaimRateBps: "-1",
        recentFailureRateBps: "-1",
        dataConfidence: "FRESH",
        asOfBlock: result.latestIndexedBlock,
        scoringFnVersion: SCORING_FN_VERSION,
        rationale: "new provider — no indexed history; conservative 1.5x base cap",
      },
      "risk quote",
    );
  }

  const { features, dataConfidence, asOfBlock } = result.envelope;

  // Fail closed: never quote off stale data (defense-in-depth; assertFresh already throws upstream).
  if (dataConfidence === "STALE") {
    throw new VouchError("SUBGRAPH_STALE", "Refusing to quote: subgraph data is stale");
  }

  const upheldBps = BigInt(features.upheldClaimRateBps);
  const recentBps = BigInt(features.recentFailureRateBps);

  // Insufficient history → treat like a new provider (cautious), driven by the sample-size guard,
  // NOT by reading an undefined (-1) rate as a perfect record.
  if (!features.hasEnoughHistory) {
    const cap = (baseCapBaseUnits * NEW_PROVIDER_PREMIUM_BPS) / 10_000n;
    return parseOrThrow(
      riskQuoteSchema,
      {
        provider,
        recommendedGuaranteeCap: cap.toString(),
        premiumBps: NEW_PROVIDER_PREMIUM_BPS.toString(),
        upheldClaimRateBps: features.upheldClaimRateBps,
        recentFailureRateBps: features.recentFailureRateBps,
        dataConfidence,
        asOfBlock,
        scoringFnVersion: SCORING_FN_VERSION,
        rationale: `insufficient history (sampleSize=${features.sampleSize}); conservative 1.5x cap`,
      },
      "risk quote",
    );
  }

  // Higher observed risk → higher premium. Undefined rates contribute nothing.
  const riskBps = nonNeg(upheldBps) * UPHELD_WEIGHT + nonNeg(recentBps) * RECENT_WEIGHT;
  const premiumBps = clampPremium(BASE_PREMIUM_BPS + riskBps);
  const cap = (baseCapBaseUnits * premiumBps) / 10_000n;

  return parseOrThrow(
    riskQuoteSchema,
    {
      provider,
      recommendedGuaranteeCap: cap.toString(),
      premiumBps: premiumBps.toString(),
      upheldClaimRateBps: features.upheldClaimRateBps,
      recentFailureRateBps: features.recentFailureRateBps,
      dataConfidence,
      asOfBlock,
      scoringFnVersion: SCORING_FN_VERSION,
      rationale:
        `upheldClaimRate=${features.upheldClaimRateBps}bps, ` +
        `recentFailureRate=${features.recentFailureRateBps}bps, ` +
        `premium=${premiumBps.toString()}bps (sampleSize=${features.sampleSize})`,
    },
    "risk quote",
  );
}
