import { z } from "zod";

/**
 * Machine-readable reason codes — the single source of truth for both the deterministic scoring
 * model (apps/agent `risk/score.ts`, plan §4.3) and the quote verifier (`quote/commitment.ts`, §5).
 *
 * These are RETURNED as data (in a quote's `reasonCodes[]` or a verify result's `reasonCodes[]`),
 * NEVER thrown. Thrown failures use `VouchErrorCode` (see ./errors) — the two taxonomies are kept
 * disjoint on purpose (one concept, one place; TS review §6). Enums, never free-text: greppable,
 * testable, demo-legible.
 */

/** Scoring reason codes — why the deterministic model produced the amounts it did (§4.3). */
export const SCORING_REASON_CODES = [
  "FRESH_DATA",
  "DEGRADED_DATA",
  "NEW_PROVIDER_CONSERVATIVE",
  "INSUFFICIENT_HISTORY_SURCHARGE",
  "HISTORY_DISCOUNT_APPLIED",
  "UPHELD_CLAIM_RISK",
  "RECENT_FAILURE_RISK",
  "LONG_COVERAGE_SURCHARGE",
  "HIGH_GUARANTEE_FEE_RATIO",
  "GUARANTEE_EXCEEDS_LIMIT",
  "PREMIUM_CAPPED",
  "SERVICE_FEE_CAPPED",
  "COLLATERAL_FLOOR_APPLIED",
] as const;

/** Verify reason codes — why a quote failed verification (§5). Returned by `verifyQuote`, not thrown. */
export const VERIFY_REASON_CODES = [
  "CHAIN_MISMATCH",
  "QUOTE_EXPIRED",
  "QUOTE_NOT_YET_VALID",
  "JOB_PARAMS_ALTERED",
  "BAD_SIGNER",
  "QUOTE_REPLAY",
] as const;

export const reasonCodeSchema = z.enum([...SCORING_REASON_CODES, ...VERIFY_REASON_CODES]);
export type ReasonCode = z.infer<typeof reasonCodeSchema>;

export type ScoringReasonCode = (typeof SCORING_REASON_CODES)[number];
export type VerifyReasonCode = (typeof VERIFY_REASON_CODES)[number];

/**
 * Confidence in the quote, derived from sample size + data freshness (§4.2). Its own exported enum
 * because it is referenced by the score output, the DB, the API, and the web dashboard.
 */
export const confidenceLevelSchema = z.enum(["HIGH", "MEDIUM", "LOW"]);
export type ConfidenceLevel = z.infer<typeof confidenceLevelSchema>;
