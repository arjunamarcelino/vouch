import { z } from "zod";
import { VouchError } from "../errors";
import { reasonCodeSchema, confidenceLevelSchema } from "../reasonCodes";
import { hexAddress, baseUnits, uintString, ratioBpsString, hex32, hexSignature } from "./primitives";

/**
 * Runtime boundary schemas shared across web / api / agent.
 * Types are derived with `z.infer` so schemas are the single source of truth.
 *
 * Financial fields are represented as decimal STRINGS of 6-decimal USDC base
 * units (never JS number — precision) at the API boundary; contracts/subgraph
 * use uint256/BigInt. See plan §17.9. The hex/base-unit regex primitives now live
 * in `./primitives` (exported so apps/api's boundary DTOs reuse them — TS review §3).
 */

// Re-export the primitives so existing `@vouch/shared/schemas` importers keep working.
export { hexAddress, baseUnits, uintString, ratioBpsString, hex32, hexSignature } from "./primitives";
export * from "./api";

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

// ============================================================================
// v2 — full transparent pricing model + signed expiring commitment (plan §4/§5)
// ============================================================================

/** v2 scoring function version — new output shape (do NOT reuse the v1 literal — TS review §1). */
export const SCORING_FN_VERSION_V2 = "2.0.0" as const;

/** Task category — a documented closed set feeding the deterministic model (plan §4.1). */
export const taskCategorySchema = z.enum([
  "CODE_FIX",
  "FEATURE",
  "REFACTOR",
  "AUDIT",
  "OTHER",
]);
export type TaskCategory = z.infer<typeof taskCategorySchema>;

/** How a covered failure is verified — affects confidence, not price directly (plan §4.1). */
export const verificationMethodSchema = z.enum([
  "PUBLIC_TESTS",
  "PRIVATE_REGRESSION",
  "MANUAL_REVIEW",
  "HYBRID",
]);
export type VerificationMethod = z.infer<typeof verificationMethodSchema>;

/**
 * A quote REQUEST for a specific provider + proposed job (plan §4.1). Every field the deterministic
 * score reads; the exact terms are canonicalized + hashed into the quote's `jobHash` (anti-tamper §5).
 */
export const jobRequestSchema = z.object({
  provider: hexAddress,
  payer: hexAddress,
  payee: hexAddress,
  token: hexAddress,
  taskFee: baseUnits,
  requestedGuarantee: baseUnits,
  providerCollateral: baseUnits,
  coverageDurationSeconds: uintString,
  taskCategory: taskCategorySchema,
  verificationMethod: verificationMethodSchema,
});
export type JobRequest = z.infer<typeof jobRequestSchema>;

/**
 * Output of the deterministic pricing model (plan §4). PURE integer bps / base units — every field
 * capped, stamped with `asOfBlock` + `scoringFnVersion` for reproducibility, plus machine-readable
 * reason codes. The LLM may only fill `rationale`; it never sets an amount (§4.4).
 */
export const riskScoreSchema = z.object({
  provider: hexAddress,
  recommendedGuaranteeLimit: baseUnits,
  assuranceServiceFee: baseUnits,
  minProviderCollateral: baseUnits,
  premiumBps: uintString,
  exposureFactorBps: uintString,
  upheldClaimRateBps: ratioBpsString,
  recentFailureRateBps: ratioBpsString,
  confidenceLevel: confidenceLevelSchema,
  dataConfidence: dataConfidenceSchema,
  asOfBlock: uintString,
  scoringFnVersion: z.literal(SCORING_FN_VERSION_V2),
  reasonCodes: z.array(reasonCodeSchema),
  rationale: z.string(),
});
export type RiskScore = z.infer<typeof riskScoreSchema>;

/**
 * A signed, expiring quote commitment (plan §5). Wraps the score with EIP-712 commitment fields.
 * `nonce == quoteId` (single canonical replay/escrow key — security M2). `jobHash` binds the exact
 * job terms (altered-param protection). `signature` is over the EIP-712 typed data.
 */
export const quoteCommitmentSchema = z.object({
  quoteId: hex32,
  jobHash: hex32,
  nonce: hex32,
  token: hexAddress, // denomination; part of the signed struct, persisted for action-time verify
  score: riskScoreSchema,
  validAfter: uintString,
  expiresAt: uintString,
  signature: hexSignature,
});
export type QuoteCommitment = z.infer<typeof quoteCommitmentSchema>;

// ---- payment intent (crash-safe executor state machine, plan §6.4) ----

export const paymentActionSchema = z.enum(["POST_BOND", "REFUND_BOND"]);
export type PaymentAction = z.infer<typeof paymentActionSchema>;

export const paymentStatusSchema = z.enum([
  "PLANNED",
  "SUBMITTING",
  "SUBMITTED",
  "CONFIRMED",
  "FAILED",
  "ABANDONED",
]);
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

export const paymentIntentSchema = z.object({
  idempotencyKey: z.string().uuid(),
  quoteId: hex32,
  action: paymentActionSchema,
  amount: baseUnits,
  token: hexAddress,
  destination: hexAddress,
  chainId: z.number().int().positive(),
  paramsHash: hex32,
  status: paymentStatusSchema,
  providerRef: z.string().nullable(),
  txHash: z.string().nullable(),
  attempts: z.number().int().nonnegative(),
});
export type PaymentIntent = z.infer<typeof paymentIntentSchema>;

/** Circle developer-controlled-wallets transaction lifecycle (verified via Context7). */
export const transactionStatusSchema = z.enum([
  "INITIATED",
  "CLEARED",
  "QUEUED",
  "SENT",
  "CONFIRMED",
  "COMPLETE",
  "FAILED",
  "DENIED",
  "CANCELLED",
]);
export type TransactionStatus = z.infer<typeof transactionStatusSchema>;

/**
 * A hash-chained decision record (plan §9.1). `scoreInputs` lets an auditor recompute the
 * deterministic score; `reasonCodes` are enums; `recordHash`/`prevRecordHash` make the per-quote
 * chain tamper-evident. Only allowlisted fields are persisted — never raw request/config blobs
 * (security M5).
 */
export const decisionTraceSchema = z.object({
  id: z.string().uuid(),
  quoteId: hex32,
  seq: z.number().int().nonnegative(),
  correlationId: z.string(),
  outcome: z.enum(["QUOTED", "BOND_POSTED", "BOND_REFUNDED", "REJECTED"]),
  reasonCodes: z.array(reasonCodeSchema),
  scoreInputs: z.record(z.string(), z.string()),
  txHash: z.string().nullable(),
  prevRecordHash: hex32,
  recordHash: hex32,
});
export type DecisionTrace = z.infer<typeof decisionTraceSchema>;
