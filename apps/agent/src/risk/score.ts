import {
  riskScoreSchema,
  parseOrThrow,
  SCORING_FN_VERSION_V2,
  type JobRequest,
  type RiskScore,
} from "@vouch/shared/schemas";
import {
  type ReasonCode,
  type ConfidenceLevel,
} from "@vouch/shared/reasonCodes";
import { applyBpsFloor, applyBpsCeil, bigIntMin, bigIntMax, clamp } from "@vouch/shared/bigint";
import { VouchError } from "@vouch/shared/errors";
import type { ProviderRiskResult } from "../graph/client";
import { NEW_PROVIDER_FACTOR_BPS, riskExposureFactorBps } from "./exposure";

/**
 * Deterministic transparent pricing model (plan §4). Turns LIVE indexed provider history + the job's
 * characteristics into capped monetary outputs + machine-readable reason codes. This is the monetary
 * decision — it is a PURE integer function; the LLM may only explain it (rationale), never choose an
 * amount (§4.4).
 *
 * ALL BigInt basis points / 6-dec USDC base units (ADR-006; docs/solutions BigInt learning). No
 * `Number()`, `Math.*`, `toFixed`, or division-before-multiplication. Every output is CAPPED and the
 * quote is stamped with `asOfBlock` + `scoringFnVersion` so it is reproducible from chain history.
 *
 * FAIL CLOSED (plan §6): only a FRESH envelope may score — anything else throws (never a fabricated
 * quote). A genuinely new / insufficient-history provider gets a documented conservative policy.
 */

// --- documented model constants (every one BigInt; §4.2) ---
export const BASE_RISK_RATE_BPS = 200n; // 2.00% documented starting premium
// Risk translation: fraction of the observed rate that becomes premium.
const UPHELD_TO_PREMIUM_BPS = 2_000n; // upheld-claim rate contributes 20% of itself to premium
const RECENT_TO_PREMIUM_BPS = 3_000n; // recent-failure rate contributes 30% of itself
// Coverage duration: surcharge per full day beyond the 1-day baseline.
const COVERAGE_BASELINE_SECONDS = 86_400n;
const DURATION_SURCHARGE_BPS_PER_DAY = 25n;
const MAX_DURATION_SURCHARGE_BPS = 400n;
// Guarantee-to-fee ratio: surcharge above a 5x threshold.
const RATIO_THRESHOLD_BPS = 50_000n; // 5.0x
const RATIO_SURCHARGE_FACTOR_BPS = 500n; // 5% of the excess ratio
const MAX_RATIO_SURCHARGE_BPS = 400n;
// History discount: per completed job, capped.
const HISTORY_DISCOUNT_BPS_PER_JOB = 10n;
const MAX_HISTORY_DISCOUNT_BPS = 300n;
// Conservative surcharge when history is insufficient.
const INSUFFICIENT_HISTORY_SURCHARGE_BPS = 300n;
// Premium band caps.
const MIN_PREMIUM_BPS = 50n; // 0.50% floor
const MAX_PREMIUM_BPS = 2_000n; // 20.00% ceiling
// Absolute service-fee ceiling (base units) — an independent bound, not redundant with the premium
// clamp (a relative %-of-fee cap would just mirror MAX_PREMIUM_BPS). Default 10 USDC; override via
// ScoreParams for tests / policy.
const DEFAULT_MAX_SERVICE_FEE = 10_000_000n; // 10 USDC (6-dec)
// Exposure factor (guarantee-limit scaling) is the shared model in ./exposure (used by v1 quote.ts too).
// Confidence thresholds.
const HIGH_CONFIDENCE_SAMPLE = 20n;

/** Base guarantee cap (6-dec base units) and, optionally, tunable overrides for tests. */
export interface ScoreParams {
  baseGuaranteeCap: bigint;
  /** Absolute service-fee ceiling (base units). Defaults to 10 USDC. */
  maxServiceFee?: bigint;
}

function nonNeg(bps: bigint): bigint {
  return bps < 0n ? 0n : bps; // -1 (undefined) contributes no risk
}

function confidence(sampleSize: bigint, hasEnoughHistory: boolean, isNew: boolean): ConfidenceLevel {
  if (isNew || !hasEnoughHistory) return "LOW";
  return sampleSize >= HIGH_CONFIDENCE_SAMPLE ? "HIGH" : "MEDIUM";
}

interface RawFeatures {
  completedJobs: bigint;
  upheldClaimRateBps: bigint;
  recentFailureRateBps: bigint;
  sampleSize: bigint;
  hasEnoughHistory: boolean;
  asOfBlock: string;
  isNew: boolean;
}

function computeScore(f: RawFeatures, job: JobRequest, params: ScoreParams): RiskScore {
  const reasonCodes: ReasonCode[] = [];
  reasonCodes.push("FRESH_DATA");

  const taskFee = BigInt(job.taskFee);
  const requestedGuarantee = BigInt(job.requestedGuarantee);
  const coverageDurationSeconds = BigInt(job.coverageDurationSeconds);
  const upheld = nonNeg(f.upheldClaimRateBps);
  const recent = nonNeg(f.recentFailureRateBps);

  // --- premium band (multiply-before-divide throughout) ---
  let premiumBps = BASE_RISK_RATE_BPS;

  const upheldSurcharge = applyBpsFloor(upheld, UPHELD_TO_PREMIUM_BPS);
  if (upheldSurcharge > 0n) {
    premiumBps += upheldSurcharge;
    reasonCodes.push("UPHELD_CLAIM_RISK");
  }
  const recentSurcharge = applyBpsFloor(recent, RECENT_TO_PREMIUM_BPS);
  if (recentSurcharge > 0n) {
    premiumBps += recentSurcharge;
    reasonCodes.push("RECENT_FAILURE_RISK");
  }

  // Coverage-duration surcharge (per full day beyond baseline).
  const extraSeconds = bigIntMax(0n, coverageDurationSeconds - COVERAGE_BASELINE_SECONDS);
  const extraDays = extraSeconds / COVERAGE_BASELINE_SECONDS; // truncates — whole extra days only
  const durationSurcharge = bigIntMin(
    extraDays * DURATION_SURCHARGE_BPS_PER_DAY,
    MAX_DURATION_SURCHARGE_BPS,
  );
  if (durationSurcharge > 0n) {
    premiumBps += durationSurcharge;
    reasonCodes.push("LONG_COVERAGE_SURCHARGE");
  }

  // Guarantee-to-fee ratio surcharge (only when taskFee > 0 — avoid divide-by-zero).
  if (taskFee > 0n) {
    const ratioBps = (requestedGuarantee * 10_000n) / taskFee;
    if (ratioBps > RATIO_THRESHOLD_BPS) {
      const ratioSurcharge = bigIntMin(
        applyBpsFloor(ratioBps - RATIO_THRESHOLD_BPS, RATIO_SURCHARGE_FACTOR_BPS),
        MAX_RATIO_SURCHARGE_BPS,
      );
      if (ratioSurcharge > 0n) {
        premiumBps += ratioSurcharge;
        reasonCodes.push("HIGH_GUARANTEE_FEE_RATIO");
      }
    }
  }

  // History discount (sufficient completed history lowers premium).
  if (f.hasEnoughHistory && !f.isNew && f.completedJobs > 0n) {
    const discount = bigIntMin(
      f.completedJobs * HISTORY_DISCOUNT_BPS_PER_JOB,
      MAX_HISTORY_DISCOUNT_BPS,
    );
    if (discount > 0n) {
      premiumBps = bigIntMax(0n, premiumBps - discount);
      reasonCodes.push("HISTORY_DISCOUNT_APPLIED");
    }
  }

  // Conservative surcharge for insufficient / new history.
  if (f.isNew || !f.hasEnoughHistory) {
    premiumBps += INSUFFICIENT_HISTORY_SURCHARGE_BPS;
    reasonCodes.push(f.isNew ? "NEW_PROVIDER_CONSERVATIVE" : "INSUFFICIENT_HISTORY_SURCHARGE");
  }

  // Cap the premium band.
  const cappedPremium = clamp(premiumBps, MIN_PREMIUM_BPS, MAX_PREMIUM_BPS);
  if (cappedPremium !== premiumBps) reasonCodes.push("PREMIUM_CAPPED");
  premiumBps = cappedPremium;

  // --- exposure ceiling (guarantee limit) — risk scales it DOWN, never up (027) ---
  const exposureFactorBps =
    f.isNew || !f.hasEnoughHistory ? NEW_PROVIDER_FACTOR_BPS : riskExposureFactorBps(upheld, recent);
  const recommendedGuaranteeLimit = applyBpsFloor(params.baseGuaranteeCap, exposureFactorBps);

  // Oversized-guarantee guard: never cover above the computed ceiling.
  if (requestedGuarantee > recommendedGuaranteeLimit) {
    reasonCodes.push("GUARANTEE_EXCEEDS_LIMIT");
  }
  const effectiveGuarantee = bigIntMin(requestedGuarantee, recommendedGuaranteeLimit);

  // --- assurance service fee (advisory; agent never pays it — §0.1). Round UP, then cap absolute. ---
  const rawServiceFee = applyBpsCeil(taskFee, premiumBps);
  const serviceFeeCap = params.maxServiceFee ?? DEFAULT_MAX_SERVICE_FEE;
  const assuranceServiceFee = bigIntMin(rawServiceFee, serviceFeeCap);
  if (assuranceServiceFee !== rawServiceFee) reasonCodes.push("SERVICE_FEE_CAPPED");

  // --- minimum provider collateral: must back the effective guarantee (ADR-005 §3) ---
  const providerCollateral = BigInt(job.providerCollateral);
  const minProviderCollateral = effectiveGuarantee;
  if (providerCollateral < minProviderCollateral) {
    reasonCodes.push("COLLATERAL_FLOOR_APPLIED");
  }

  const confidenceLevel = confidence(f.sampleSize, f.hasEnoughHistory, f.isNew);

  return parseOrThrow(
    riskScoreSchema,
    {
      provider: job.provider,
      recommendedGuaranteeLimit: recommendedGuaranteeLimit.toString(),
      assuranceServiceFee: assuranceServiceFee.toString(),
      minProviderCollateral: minProviderCollateral.toString(),
      premiumBps: premiumBps.toString(),
      exposureFactorBps: exposureFactorBps.toString(),
      upheldClaimRateBps: f.upheldClaimRateBps.toString(),
      recentFailureRateBps: f.recentFailureRateBps.toString(),
      confidenceLevel,
      dataConfidence: "FRESH",
      asOfBlock: f.asOfBlock,
      scoringFnVersion: SCORING_FN_VERSION_V2,
      reasonCodes,
      rationale:
        `premium=${premiumBps.toString()}bps, exposureFactor=${exposureFactorBps.toString()}bps, ` +
        `confidence=${confidenceLevel} (sampleSize=${f.sampleSize.toString()}); ` +
        `reasons=${reasonCodes.join("+")}`,
    },
    "risk score",
  );
}

/** Public entrypoint: score a quote from live provider-risk data + the job request (§4). */
export function scoreQuote(
  result: ProviderRiskResult,
  job: JobRequest,
  params: ScoreParams,
): RiskScore {
  if (result.kind === "new-provider") {
    return computeScore(
      {
        completedJobs: 0n,
        upheldClaimRateBps: -1n,
        recentFailureRateBps: -1n,
        sampleSize: 0n,
        hasEnoughHistory: false,
        asOfBlock: result.latestIndexedBlock,
        isNew: true,
      },
      job,
      params,
    );
  }

  const { features, dataConfidence, asOfBlock } = result.envelope;

  // Fail closed: only FRESH may quote (allowlist, not a STALE denylist — 026).
  if (dataConfidence !== "FRESH") {
    throw new VouchError("SUBGRAPH_STALE", `Refusing to score: dataConfidence=${dataConfidence}`);
  }

  return computeScore(
    {
      completedJobs: BigInt(features.completedJobs),
      upheldClaimRateBps: BigInt(features.upheldClaimRateBps),
      recentFailureRateBps: BigInt(features.recentFailureRateBps),
      sampleSize: BigInt(features.sampleSize),
      hasEnoughHistory: features.hasEnoughHistory,
      asOfBlock,
      isNew: false,
    },
    job,
    params,
  );
}
