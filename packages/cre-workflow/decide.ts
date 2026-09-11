/**
 * Fail-closed verdict logic — the pure decision function + the untrusted
 * test-API response schema. SDK-independent (zod + no side effects).
 *
 * IMPORTANT: zod is imported from "zod" (the pinned v3, 3.25.76). The CRE SDK
 * does NOT re-export zod.
 */
import { z } from "zod";

/** The onchain `State` enum index for a job awaiting confidential resolution. */
export const CLAIM_PENDING = 5;

/**
 * Coarse, non-invertible failure code. A bounded enum (never a free string) so
 * it stays public-safe across repeated claims.
 */
export const FAILURE_CODES = [
  "NONE",
  "REGRESSION",
  "BUILD",
  "TIMEOUT",
  "OTHER",
] as const;

/**
 * The untrusted confidential test-API response. Parsed with `safeParse`; any
 * failure (extra keys, missing fields, bad types, non-finite/out-of-range
 * passRate) yields REFUSE — never a silent pass. `coverage` is intentionally
 * NOT carried.
 */
export const evalResponseSchema = z.strictObject({
  commitHash: z
    .string()
    .refine((s): s is `0x${string}` => /^0x[0-9a-fA-F]{64}$/.test(s), {
      message: "commitHash must be a 0x-prefixed 32-byte hex string",
    }),
  failureCode: z.enum(FAILURE_CODES),
  passRate: z.number().finite().min(0).max(1),
});
export type EvalResponse = z.infer<typeof evalResponseSchema>;

export type RefuseReason =
  | "READ_FAILED"
  | "NOT_CLAIM_PENDING"
  | "SECRET_MISSING"
  | "FETCH_FAILED"
  | "MALFORMED_RESPONSE"
  | "COMMIT_MISMATCH"
  | "INCONCLUSIVE";

export type Verdict =
  | { readonly kind: "PAYOUT"; readonly covered: true }
  | { readonly kind: "CLEAN_CLOSE"; readonly covered: false }
  | { readonly kind: "REFUSE"; readonly reason: RefuseReason };

export interface DecideInput {
  readonly status: number;
  readonly passRate: number;
  readonly threshold: number;
  readonly commitHash: `0x${string}`;
  readonly submissionCommitment: `0x${string}`;
  /** Present for interface fidelity; `amount` is NOT decided here. */
  readonly guaranteeAmount: bigint;
}

/**
 * Pure, fail-closed verdict. NO `now` param — the coverage window is enforced
 * onchain via `status == ClaimPending`. `amount` is secret-independent and set
 * by the caller (`guaranteeAmount` on PAYOUT, else `0`), never here.
 *
 * Truth table (first match wins):
 *   status != ClaimPending                          -> REFUSE NOT_CLAIM_PENDING
 *   threshold missing/NaN/out of (0,1]              -> REFUSE SECRET_MISSING
 *   passRate non-finite or out of [0,1]             -> REFUSE MALFORMED_RESPONSE
 *   commitHash != submissionCommitment              -> REFUSE COMMIT_MISMATCH
 *   definitive clean (passRate >= threshold)        -> CLEAN_CLOSE (covered=false)
 *   confident covered failure (passRate < threshold)-> PAYOUT (covered=true)
 *
 * The fail-OPEN hazard: an invalid threshold or passRate must NEVER fall
 * through to CLEAN_CLOSE — that would burn the client's single claim on
 * degraded input. Any doubt is REFUSE.
 */
export function decideVerdict(input: DecideInput): Verdict {
  if (input.status !== CLAIM_PENDING) {
    return { kind: "REFUSE", reason: "NOT_CLAIM_PENDING" };
  }
  // Threshold is a semi-trusted operator secret. It MUST be a finite value in
  // (0, 1]: a threshold > 1 would make every claim PAYOUT, and 0 would make
  // every claim CLEAN_CLOSE (client remedy unreachable). Out of range -> REFUSE,
  // never a silent flip of the money path. Defense-in-depth mirroring the port's
  // thresholdSchema. (todo 045)
  if (!Number.isFinite(input.threshold) || input.threshold <= 0 || input.threshold > 1) {
    return { kind: "REFUSE", reason: "SECRET_MISSING" };
  }
  if (
    !Number.isFinite(input.passRate) ||
    input.passRate < 0 ||
    input.passRate > 1
  ) {
    return { kind: "REFUSE", reason: "MALFORMED_RESPONSE" };
  }
  if (input.commitHash.toLowerCase() !== input.submissionCommitment.toLowerCase()) {
    return { kind: "REFUSE", reason: "COMMIT_MISMATCH" };
  }
  if (input.passRate >= input.threshold) {
    return { kind: "CLEAN_CLOSE", covered: false };
  }
  return { kind: "PAYOUT", covered: true };
}
