import { z } from "zod";
import { hexAddress, baseUnits, hexData, hex32 } from "./primitives";

/**
 * Shared API-boundary contracts (Phase-0a freeze) consumed by BOTH `apps/api` and `apps/web`.
 *
 * Kept primitive-only (imports from `./primitives`, never `./index`) so there is no import cycle —
 * `./index` re-exports this module. Enums are the single source of truth for the DB string columns
 * and the guards; the web wallet consumes `transactionRequestSchema` to know what to sign.
 */

// --- roles (session-level; CLIENT/PROVIDER are contextual per job, resolved by @JobParty) ---
export const roleSchema = z.enum(["CLIENT", "PROVIDER", "EVALUATOR", "ADMIN", "SYSTEM"]);
export type Role = z.infer<typeof roleSchema>;

/**
 * On-chain job lifecycle, mirroring the Solidity `State` enum in AssuranceHub.sol EXACTLY (ordinal =
 * array index). `getJob().status` is a `uint8`; map it through this tuple. `ClaimPending` is a STATE,
 * not an event — claim PENDING is derived (ClaimOpened seen, no terminal event).
 */
export const JOB_STATES = [
  "None", // 0
  "Funded", // 1
  "AcceptedByProvider", // 2
  "Submitted", // 3
  "InitiallyApproved", // 4
  "ClaimPending", // 5
  "ClaimPaid", // 6 terminal
  "Completed", // 7 terminal
  "Cancelled", // 8 terminal
  "Expired", // 9 terminal
] as const;
export const jobStateSchema = z.enum(JOB_STATES);
export type JobState = z.infer<typeof jobStateSchema>;
/** Map an on-chain `uint8`/bigint status to the named state (throws on out-of-range). */
export function jobStateFromOrdinal(ordinal: number | bigint): JobState {
  const i = Number(ordinal);
  const name = JOB_STATES[i];
  if (name === undefined) throw new Error(`Unknown job state ordinal: ${String(ordinal)}`);
  return name;
}

/**
 * The ONLY contract functions `apps/api` will ever prepare calldata for (positive allowlist — TS +
 * security review). `onReport`/`pause`/`setFeeRecipient`/`grantRole`/forwarder-config are denied by
 * construction. `approve` targets USDC; all others target the hub.
 */
export const preparableFunctionSchema = z.enum([
  "approve",
  "openJob",
  "acceptJob",
  "submitDeliverable",
  "resolveInitialEvaluation",
  "openClaim",
  "cancelJob",
  "expireJob",
  "withdrawCollateral",
  "resolveClaimTimeout",
]);
export type PreparableFunction = z.infer<typeof preparableFunctionSchema>;

/** Coarse action label stamped on a tracked tx / prepared intent (drives the DB CHECK + selector map). */
export const txActionSchema = z.enum([
  "APPROVE",
  "OPEN_JOB",
  "ACCEPT",
  "SUBMIT",
  "EVAL",
  "CLAIM",
  "CANCEL",
  "EXPIRE",
  "WITHDRAW",
  "RESOLVE_TIMEOUT",
]);
export type TxAction = z.infer<typeof txActionSchema>;

/**
 * Post-hash tracking lifecycle actually produced by the tracker (review 062). Pre-hash states
 * (PREPARED/ABANDONED) live on PreparedIntent. REORGED/FAILED were removed as unimplemented — no code
 * path produces them (there is no background reorg reconciler); the schema no longer promises them.
 */
export const trackedTxStatusSchema = z.enum(["PENDING", "CONFIRMED", "MISMATCH"]);
export type TrackedTxStatus = z.infer<typeof trackedTxStatusSchema>;

/** Allowlisted, non-secret activity-feed event kinds. */
export const feedEventKindSchema = z.enum([
  "JOB_CREATED",
  "JOB_FUNDED",
  "PROVIDER_ACCEPTED",
  "DELIVERABLE_SUBMITTED",
  "INITIAL_EVALUATION_RESOLVED",
  "CLAIM_OPENED",
  "CONFIDENTIAL_EVALUATION_RESOLVED",
  "GUARANTEE_PAID",
  "JOB_EXPIRED",
  "JOB_CANCELLED",
  "TX_CONFIRMED",
  "TX_MISMATCH",
  "DUPLICATE_JOB",
]);
export type FeedEventKind = z.infer<typeof feedEventKindSchema>;

/** Derived claim status surfaced to the dashboard (respects the covered=false latch + timeout 0x0). */
export const claimStatusSchema = z.enum([
  "NONE",
  "PENDING",
  "COVERED_PAID",
  "REJECTED_CONSUMED",
  "TIMED_OUT",
]);
export type ClaimStatus = z.infer<typeof claimStatusSchema>;

/** Which authority produced a read (chain is instant+authoritative; graph lags for history). */
export const readSourceSchema = z.enum(["chain", "graph"]);
export type ReadSource = z.infer<typeof readSourceSchema>;

/**
 * The unsigned transaction the API prepares for a wallet to sign (web↔api contract). Money is a
 * base-unit string; `data` is fully-encoded calldata. `meta.to` allowlist is enforced server-side
 * (hub for job/claim actions, USDC for `approve`). `preparedId` links to the persisted PreparedIntent
 * that `POST /transactions/track` diffs the mined tx against.
 */
export const transactionRequestSchema = z.object({
  chainId: z.number().int().positive(),
  to: hexAddress,
  data: hexData,
  value: baseUnits.default("0"),
  functionName: preparableFunctionSchema,
  action: txActionSchema,
  /** Opaque id of the persisted prepared intent (track binds & arg-matches against it). */
  preparedId: z.string().uuid(),
  /** Provisional client request id / on-chain jobId context, when known. */
  jobRequestId: z.string().optional(),
  jobId: z.string().optional(),
});
export type TransactionRequest = z.infer<typeof transactionRequestSchema>;

/**
 * Confidential-path input: ONLY a bytes32 commitment is ever accepted (`.strict()` rejects any extra
 * key — the secrets boundary is an allowlist, not a blocklist; a preimage/credential/URL can never
 * reach the API). Reused for openClaim evidence and deliverable submission commitments.
 */
export const commitmentInputSchema = z.object({ commitment: hex32 }).strict();
export type CommitmentInput = z.infer<typeof commitmentInputSchema>;

