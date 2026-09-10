import { z } from "zod";

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

export const jobStatusSchema = z.enum([
  "Created",
  "TaskFunded",
  "GuaranteeLocked",
  "PublicTestsPassed",
  "TaskFeeReleased",
  "CoverageOpen",
  "RegressionProven",
  "GuaranteePaid",
  "GuaranteeReleased",
]);
export type JobStatus = z.infer<typeof jobStatusSchema>;

export const guaranteeStatusSchema = z.enum(["LOCKED", "PAID", "RELEASED"]);
export type GuaranteeStatus = z.infer<typeof guaranteeStatusSchema>;

export const jobSchema = z.object({
  jobId: z.string(),
  client: hexAddress,
  provider: hexAddress,
  taskFee: baseUnits,
  guaranteeCap: baseUnits,
  lockedCollateral: baseUnits,
  coverageDeadline: z.number().int().nonnegative(),
  status: jobStatusSchema,
});
export type Job = z.infer<typeof jobSchema>;

export const guaranteeSchema = z.object({
  guaranteeId: z.string(),
  jobId: z.string(),
  provider: hexAddress,
  amount: baseUnits,
  status: guaranteeStatusSchema,
});
export type Guarantee = z.infer<typeof guaranteeSchema>;

export const payoutSchema = z.object({
  jobId: z.string(),
  amount: baseUnits,
  recipient: hexAddress,
  at: z.number().int().nonnegative(),
});
export type Payout = z.infer<typeof payoutSchema>;

/** Provider reputation aggregate, as read from the subgraph. */
export const providerReputationSchema = z.object({
  id: hexAddress,
  jobsCompleted: z.string(),
  guaranteesLocked: z.string(),
  regressions: z.string(),
  totalPaidOut: baseUnits,
  totalGuaranteedValue: baseUnits,
});
export type ProviderReputation = z.infer<typeof providerReputationSchema>;

/** Output of the agent's autonomous risk-quotation. */
export const riskQuoteSchema = z.object({
  provider: hexAddress,
  recommendedGuaranteeCap: baseUnits,
  regressionRate: z.number().min(0).max(1),
  payoutToGuaranteeRatio: z.number().min(0),
  rationale: z.string(),
});
export type RiskQuote = z.infer<typeof riskQuoteSchema>;
