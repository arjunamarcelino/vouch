/**
 * `EvalPort` — the narrow injection seam between the pure orchestration logic
 * and the SDK-backed runtime. Tests drive `runEvaluation` with plain-object
 * mocks; the real SDK adapter lives in `workflow.ts`. SDK-independent.
 *
 * The D-A confidential fallback is just a different adapter behind this port.
 */
import { z } from "zod";
import { buildVerdictPayload } from "./encoding";
import { evidenceCommitment } from "./commitment";
import {
  CLAIM_PENDING,
  decideVerdict,
  evalResponseSchema,
  type RefuseReason,
  type Verdict,
} from "./decide";
import type { Config } from "./config";

export interface FetchReq {
  readonly url: string;
}

export interface FetchResult {
  readonly ok: boolean;
  readonly body?: unknown;
}

export interface JobView {
  readonly status: number;
  readonly guaranteeAmount: bigint;
  readonly submissionCommitment: `0x${string}`;
}

export interface TxResult {
  readonly ok: boolean;
  readonly txHash?: `0x${string}`;
}

export interface EvalPort {
  getSecret(id: string): Promise<string | undefined>;
  confidentialFetch(req: FetchReq): Promise<FetchResult>;
  getJob(jobId: bigint): Promise<JobView | null>;
  emitReport(payload: `0x${string}`): Promise<TxResult>;
  /** Monotonic evaluation timestamp in seconds. NEVER `Date.now()` in workflow. */
  now(): bigint;
}

export interface RunResult {
  readonly action: "REPORTED" | "REFUSED";
  readonly verdict: Verdict;
  readonly payload?: `0x${string}`;
}

/**
 * Threshold secret parser: rejects missing (undefined -> not a string), empty
 * / whitespace, non-finite, and out-of-range values. `z.coerce.number()` uses
 * `Number()` (accepts hex/scientific), so `.gt(0).lte(1)` — NOT the string
 * `.min(1)` length check — is what actually bounds the VALUE to (0, 1]. A
 * threshold > 1 would make every claim PAYOUT; 0 would make every claim
 * CLEAN_CLOSE. Out of range -> parse fails -> REFUSE (fail-closed). (todo 045)
 */
const thresholdSchema = z
  .string()
  .trim()
  .min(1)
  .pipe(z.coerce.number().finite().gt(0).lte(1));

function refused(reason: RefuseReason): RunResult {
  return { action: "REFUSED", verdict: { kind: "REFUSE", reason } };
}

/**
 * Pure orchestrator. Fail-closed everywhere: it emits a report ONLY on a
 * fully-validated PAYOUT or CLEAN_CLOSE, and NEVER logs a secret-derived value.
 *
 * `amount` is secret-independent: `guaranteeAmount` on PAYOUT, else `0` — never
 * derived from `passRate`.
 */
export async function runEvaluation(
  port: EvalPort,
  cfg: Config,
  jobId: bigint,
): Promise<RunResult> {
  // 1. Ground the (possibly-spoofed) trigger against onchain state.
  const job = await port.getJob(jobId);
  if (job === null) {
    return refused("READ_FAILED");
  }
  if (job.status !== CLAIM_PENDING) {
    return refused("NOT_CLAIM_PENDING");
  }

  // 2. Private pass/fail threshold (Vault DON secret). Missing/empty/NaN -> REFUSE.
  const rawThreshold = await port.getSecret("PASS_THRESHOLD");
  const thresholdParse = thresholdSchema.safeParse(rawThreshold);
  if (!thresholdParse.success) {
    return refused("SECRET_MISSING");
  }
  const threshold = thresholdParse.data;

  // 3. Confidential fetch of the private test result.
  const res = await port.confidentialFetch({ url: cfg.testApiUrl });
  if (!res.ok) {
    return refused("FETCH_FAILED");
  }

  // 4. Parse the untrusted response (strict). Any deviation -> REFUSE.
  const parsed = evalResponseSchema.safeParse(res.body);
  if (!parsed.success) {
    return refused("MALFORMED_RESPONSE");
  }

  // 5. Fail-closed verdict.
  const verdict = decideVerdict({
    status: job.status,
    failureCode: parsed.data.failureCode,
    passRate: parsed.data.passRate,
    threshold,
    commitHash: parsed.data.commitHash,
    submissionCommitment: job.submissionCommitment,
  });
  if (verdict.kind === "REFUSE") {
    // No report on any uncertainty — resolveClaimTimeout closes it onchain.
    return { action: "REFUSED", verdict };
  }

  // 6. amount is a deterministic function of the (already-public) `covered`.
  const covered = verdict.kind === "PAYOUT";
  const amount = covered ? job.guaranteeAmount : 0n;

  const chainId = BigInt(cfg.chainId);
  const hub = cfg.assuranceHubAddress;
  const evaluatedAt = port.now();

  const commitment = evidenceCommitment({
    chainId,
    hub,
    jobId,
    covered,
    amount,
    evaluatedCommit: job.submissionCommitment,
    evaluatedAt,
    workflowId: cfg.workflowId,
  });

  const payload = buildVerdictPayload({
    chainId,
    hub,
    jobId,
    covered,
    amount,
    evidenceCommitment: commitment,
    evaluatedAt,
  });

  // 7. Deliver the DON-signed report. A failed write is a loud infra error.
  const tx = await port.emitReport(payload);
  if (!tx.ok) {
    throw new Error("emitReport failed");
  }
  return { action: "REPORTED", verdict, payload };
}
