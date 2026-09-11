import { Injectable } from "@nestjs/common";
import { type Hex } from "viem";
import { parseOrThrow, commitmentInputSchema, type TransactionRequest, type ClaimStatus } from "@vouch/shared/schemas";
import { upsertPreparedIntent } from "@vouch/db";
import { ApiError } from "../common/errors";
import { ChainService, type OnchainJob } from "../common/chain/chain.service";
import { hashCallArgs } from "../common/chain/args-hash";
import type { PrepareCtx } from "../jobs/orchestration.service";

const ZERO_BYTES32 = `0x${"0".repeat(64)}` as const;

export interface ClaimStatusView {
  jobId: string;
  status: ClaimStatus;
  serviceCredit?: string;
  evaluatedAt?: string;
}

/**
 * Claim intake + CRE evaluation status. Opening a claim IS requesting confidential evaluation — the
 * CRE workflow auto-triggers off the on-chain `ClaimOpened` event; the API never invokes CRE and holds
 * no secrets. Only a bytes32 evidence COMMITMENT is ever accepted (strict schema — the secrets boundary
 * is an allowlist). Claim status respects the real contract semantics (rejected consumes the latch;
 * timeout carries a zero commitment; a covered payout may be a split).
 */
@Injectable()
export class ClaimsService {
  constructor(private readonly chain: ChainService) {}

  /** Client opens a claim (exit — NOT paused-gated). This is the confidential-evaluation request. */
  async prepareOpenClaim(ctx: PrepareCtx, jobId: string, job: OnchainJob, body: unknown): Promise<TransactionRequest> {
    const { commitment } = parseOrThrow(commitmentInputSchema, body, "claim evidence commitment");
    if (job.status !== "InitiallyApproved") {
      throw new ApiError("STATE_CONFLICT", `Job is ${job.status}; a claim can only open on an InitiallyApproved job`);
    }
    if (job.coverageEnd <= BigInt(Math.floor(Date.now() / 1000))) {
      throw new ApiError("STATE_CONFLICT", "Coverage window has closed");
    }
    if (await this.chain.claimFiled(BigInt(jobId))) {
      throw new ApiError("STATE_CONFLICT", "A claim was already filed for this job (one per coverage window)");
    }
    return this.build(ctx, jobId, "openClaim", [BigInt(jobId), commitment as Hex]);
  }

  /** Permissionless CRE-inactive fallback (any participant), once the resolution deadline has passed. */
  async prepareResolveClaimTimeout(ctx: PrepareCtx, jobId: string, job: OnchainJob): Promise<TransactionRequest> {
    if (job.status !== "ClaimPending") throw new ApiError("STATE_CONFLICT", `Job is ${job.status}; no pending claim to time out`);
    if (job.claimResolutionDeadline > BigInt(Math.floor(Date.now() / 1000))) {
      throw new ApiError("STATE_CONFLICT", "Claim resolution deadline has not passed yet");
    }
    return this.build(ctx, jobId, "resolveClaimTimeout", [BigInt(jobId)]);
  }

  /**
   * `job` is the chain-authoritative record (reused from the JobPartyGuard — no second getJob; review
   * 057). The expensive `confidentialResolution` (eth_getLogs) runs ONLY when a verdict can exist —
   * ClaimPaid, or a consumed latch — so PENDING / NONE answer with zero log scans.
   */
  async getClaimStatus(jobId: string, job: OnchainJob): Promise<ClaimStatusView> {
    const id = BigInt(jobId);

    // Awaiting the DON verdict — no event yet, skip the log scan.
    if (job.status === "ClaimPending") return { jobId, status: "PENDING" };

    // A verdict event can only exist once the job is settled (ClaimPaid) or the latch was consumed
    // (returned to InitiallyApproved with claimFiled). Otherwise there's nothing to look up.
    const consumed = job.status === "InitiallyApproved" && (await this.chain.claimFiled(id));
    if (job.status !== "ClaimPaid" && !consumed) return { jobId, status: "NONE" };

    const resolution = await this.chain.confidentialResolution(id); // may throw CRE_RESULT_MALFORMED
    if (resolution) {
      if (resolution.evidenceCommitment.toLowerCase() === ZERO_BYTES32) {
        return { jobId, status: "TIMED_OUT", evaluatedAt: resolution.evaluatedAt.toString() };
      }
      if (resolution.covered) {
        return { jobId, status: "COVERED_PAID", serviceCredit: resolution.serviceCredit.toString(), evaluatedAt: resolution.evaluatedAt.toString() };
      }
      return { jobId, status: "REJECTED_CONSUMED", evaluatedAt: resolution.evaluatedAt.toString() };
    }
    // Latch/settlement present but the event isn't indexable — derive from state (still fail-closed).
    return { jobId, status: job.status === "ClaimPaid" ? "COVERED_PAID" : "REJECTED_CONSUMED" };
  }

  private async build(ctx: PrepareCtx, jobId: string, functionName: "openClaim" | "resolveClaimTimeout", args: readonly unknown[]): Promise<TransactionRequest> {
    const action = functionName === "openClaim" ? "CLAIM" : "RESOLVE_TIMEOUT";
    const to = this.chain.hubAddress();
    const selector = this.chain.functionSelector(functionName);
    const data = this.chain.encode(functionName, args);
    const intent = await upsertPreparedIntent({
      idempotencyKey: ctx.idempotencyKey,
      scope: ctx.address,
      action,
      functionName,
      to,
      selector,
      argsHash: hashCallArgs(args),
      chainId: this.chain.chainId,
      jobId,
    });
    return { chainId: this.chain.chainId, to, data, value: "0", functionName, action, preparedId: intent.preparedId, jobId };
  }
}
