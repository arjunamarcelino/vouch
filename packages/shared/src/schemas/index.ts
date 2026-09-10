import { z } from "zod";
import { VouchError } from "../errors";

/**
 * Runtime boundary schemas shared across web / api / agent.
 * Types are derived with `z.infer` so schemas are the single source of truth.
 *
 * Financial fields are represented as decimal STRINGS of 6-decimal USDC base
 * units (never JS number — precision) at the API boundary; contracts/subgraph
 * use uint256/BigInt. See plan §17.9.
 */

const hexAddress = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/u, "must be a 0x-prefixed 20-byte address");

const baseUnits = z.string().regex(/^\d+$/u, "must be an integer string of USDC base units");

/** Non-negative integer string (counts / block numbers / positive bps like a premium factor). */
const uintString = z.string().regex(/^\d+$/u, "must be a non-negative integer string");

/**
 * A ratio in basis points: a non-negative integer, or exactly `-1` (the "undefined ratio" sentinel
 * the subgraph emits on a zero denominator). Any OTHER negative is rejected so a spurious value can't
 * be silently read as zero-risk (017).
 */
const ratioBpsString = z.string().regex(/^(-1|\d+)$/u, "must be a bps integer or the -1 sentinel");

/** Parse at a boundary, mapping ZodError → typed VouchError (plan §5.1 D5). */
export function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new VouchError("VALIDATION_FAILED", `Invalid ${what}`, parsed.error.flatten());
  }
  return parsed.data;
}

/** Freshness classification the consumer stamps on every read (plan §6). */
export const dataConfidenceSchema = z.enum(["FRESH", "DEGRADED", "STALE"]);
export type DataConfidence = z.infer<typeof dataConfidenceSchema>;

/** Version of the deterministic scoring function; stamped on every quote for auditability. */
export const SCORING_FN_VERSION = "1.0.0" as const;

/**
 * Provider risk features — the documented response consumed by apps/agent (plan §3.4 / §3.5.6).
 * PURE subgraph numerics (all BigInt strings; ratios in bps, `-1` = undefined). The envelope fields
 * (dataConfidence, latestIndexedBlock, asOfBlock) are consumer-computed and live in the envelope,
 * not here. `upheldClaimRateBps` is a rate (0–10000 or -1); `averageCoverageRatioBps` may exceed
 * 10000 — so bps are NOT range-checked here beyond being integer strings.
 */
export const providerRiskFeaturesSchema = z.object({
  completedJobs: uintString,
  upheldClaimRateBps: ratioBpsString,
  recentFailureRateBps: ratioBpsString,
  averageCoverageRatioBps: ratioBpsString,
  totalCoveredAmount: baseUnits,
  totalPaidClaims: uintString,
  sampleSize: uintString,
  hasEnoughHistory: z.boolean(),
});
export type ProviderRiskFeatures = z.infer<typeof providerRiskFeaturesSchema>;

/** Envelope wrapping the features with consumer-computed freshness (plan §3.5.6). */
export const providerRiskEnvelopeSchema = z.object({
  features: providerRiskFeaturesSchema,
  dataConfidence: dataConfidenceSchema,
  latestIndexedBlock: uintString,
  asOfBlock: uintString,
});
export type ProviderRiskEnvelope = z.infer<typeof providerRiskEnvelopeSchema>;

/**
 * Output of the agent's autonomous risk-quotation. All-integer (bps + base units); NO floats.
 * Stamped with asOfBlock + scoringFnVersion so any quote is reproducible from chain history.
 *
 * `recommendedGuaranteeCap` is an EXPOSURE CEILING: the max coverage the protocol will take on this
 * provider. `exposureFactorBps` scales the base cap DOWN with observed risk (10000 = full base for a
 * clean provider; lower for riskier). cap = baseCap * exposureFactorBps / 10000 (027).
 */
export const riskQuoteSchema = z.object({
  provider: hexAddress,
  recommendedGuaranteeCap: baseUnits,
  exposureFactorBps: uintString,
  upheldClaimRateBps: ratioBpsString,
  recentFailureRateBps: ratioBpsString,
  dataConfidence: dataConfidenceSchema,
  asOfBlock: uintString,
  scoringFnVersion: z.literal(SCORING_FN_VERSION),
  rationale: z.string(),
});
export type RiskQuote = z.infer<typeof riskQuoteSchema>;
