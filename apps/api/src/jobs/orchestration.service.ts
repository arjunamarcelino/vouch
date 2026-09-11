import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { getAddress, type Hex } from "viem";
import type { TransactionRequest, PreparableFunction, TxAction } from "@vouch/shared/schemas";
import { upsertPreparedIntent, createProvisionalJob } from "@vouch/db";
import { VouchError } from "@vouch/shared/errors";
import { ApiError } from "../common/errors";
import { ChainService, type OnchainJob } from "../common/chain/chain.service";
import { hashCallArgs } from "../common/chain/args-hash";
import {
  approveInputSchema,
  openJobInputSchema,
  submitDeliverableInputSchema,
  resolveEvaluationInputSchema,
} from "./orchestration.dto";
import { parseOrThrow } from "@vouch/shared/schemas";

const MIN_COVERAGE = 3_600n; // 1h  (AssuranceHub.MIN_COVERAGE)
const MAX_COVERAGE = 2_592_000n; // 30d (AssuranceHub.MAX_COVERAGE)

import type { PrepareCtx } from "../common/prepare";
export type { PrepareCtx }; // re-exported for existing importers (claims/controllers — review 068)

/**
 * Builds validated, UNSIGNED calldata (the API never signs). Every prepare mirrors the contract's own
 * guards so callers get typed errors instead of reverting calldata, persists a PreparedIntent that
 * `POST /transactions/track` diffs the mined tx against, and returns a TransactionRequest for the
 * wallet to sign. Entries assert `!paused`; exits do not.
 */
@Injectable()
export class OrchestrationService {
  constructor(private readonly chain: ChainService) {}

  private async build(
    ctx: PrepareCtx,
    action: TxAction,
    functionName: PreparableFunction,
    to: string,
    args: readonly unknown[],
    ids: { jobRequestId?: string; jobId?: string } = {},
  ): Promise<TransactionRequest> {
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
      jobRequestId: ids.jobRequestId,
      jobId: ids.jobId,
    });
    return {
      chainId: this.chain.chainId,
      to,
      data,
      value: "0",
      functionName,
      action,
      preparedId: intent.preparedId,
      jobRequestId: ids.jobRequestId,
      jobId: ids.jobId,
    };
  }

  private async assertNotPaused(): Promise<void> {
    if (await this.chain.paused()) throw new ApiError("PAUSED", "Protocol is paused; try again later");
  }

  private requireState(job: OnchainJob, ...allowed: OnchainJob["status"][]): void {
    if (!allowed.includes(job.status)) {
      throw new ApiError("STATE_CONFLICT", `Job is ${job.status}; expected ${allowed.join(" or ")}`);
    }
  }

  // ---- allowance / approve (the mandatory first tx for openJob/accept) ----

  async prepareApprove(ctx: PrepareCtx, body: unknown): Promise<TransactionRequest> {
    const { amount } = parseOrThrow(approveInputSchema, body, "approve input");
    const value = BigInt(amount);
    if (value === 0n) throw new VouchError("VALIDATION_FAILED", "Approve amount must be > 0");
    const token = await this.chain.usdc();
    // approve(spender=hub, amount) — `to` is USDC (not the hub); spender is bound to the hub server-side.
    return this.build(ctx, "APPROVE", "approve", token, [this.chain.hubAddress(), value]);
  }

  // ---- create/fund job (client) ----

  async prepareOpenJob(ctx: PrepareCtx, body: unknown): Promise<TransactionRequest> {
    const input = parseOrThrow(openJobInputSchema, body, "openJob input");
    await this.assertNotPaused();

    const provider = getAddress(input.provider);
    if (provider.toLowerCase() === ctx.address) throw new ApiError("STATE_CONFLICT", "provider must differ from client (SelfDealing)");
    const taskFee = BigInt(input.taskFee);
    const guaranteeAmount = BigInt(input.guaranteeAmount);
    const serviceFee = BigInt(input.serviceFee);
    if (taskFee === 0n || guaranteeAmount === 0n) throw new VouchError("VALIDATION_FAILED", "taskFee and guarantee must be > 0 (ZeroAmount)");
    const coverage = BigInt(input.coverageDuration);
    if (coverage < MIN_COVERAGE || coverage > MAX_COVERAGE) {
      throw new ApiError("STATE_CONFLICT", `coverageDuration must be within [${MIN_COVERAGE}, ${MAX_COVERAGE}] seconds`);
    }
    const deadline = BigInt(input.submissionDeadline);
    if (deadline <= BigInt(Math.floor(Date.now() / 1000))) throw new ApiError("STATE_CONFLICT", "submissionDeadline must be in the future");

    // Client escrows taskFee + serviceFee on openJob — gate on sufficient USDC allowance to the hub.
    const escrow = taskFee + serviceFee;
    if ((await this.chain.allowance(ctx.address)) < escrow) {
      throw new ApiError("STATE_CONFLICT", "Insufficient USDC allowance — approve the hub first");
    }

    const token = await this.chain.usdc();
    const clientRequestId = randomUUID();
    await createProvisionalJob({
      clientRequestId,
      clientAddress: ctx.address,
      providerAddress: provider,
      uiTitle: input.uiTitle,
      repoRef: input.repoRef,
    });

    const args = [
      provider,
      token,
      taskFee,
      guaranteeAmount,
      serviceFee,
      deadline,
      coverage,
      input.publicCriteriaHash as Hex,
      input.privateCriteriaCommitment as Hex,
    ] as const;
    return this.build(ctx, "OPEN_JOB", "openJob", this.chain.hubAddress(), args, { jobRequestId: clientRequestId });
  }

  // ---- provider actions ----

  async prepareAcceptJob(ctx: PrepareCtx, jobId: string, job: OnchainJob): Promise<TransactionRequest> {
    await this.assertNotPaused();
    this.requireState(job, "Funded");
    if ((await this.chain.allowance(ctx.address)) < job.guaranteeAmount) {
      throw new ApiError("STATE_CONFLICT", "Insufficient USDC allowance for the guarantee — approve the hub first");
    }
    return this.build(ctx, "ACCEPT", "acceptJob", this.chain.hubAddress(), [BigInt(jobId)], { jobId });
  }

  async prepareSubmitDeliverable(ctx: PrepareCtx, jobId: string, job: OnchainJob, body: unknown): Promise<TransactionRequest> {
    const { submissionCommitment } = parseOrThrow(submitDeliverableInputSchema, body, "submitDeliverable input");
    await this.assertNotPaused();
    this.requireState(job, "AcceptedByProvider");
    return this.build(ctx, "SUBMIT", "submitDeliverable", this.chain.hubAddress(), [BigInt(jobId), submissionCommitment as Hex], { jobId });
  }

  // ---- initial evaluator (EVALUATOR_ROLE) ----

  async prepareResolveInitialEvaluation(ctx: PrepareCtx, jobId: string, job: OnchainJob, body: unknown): Promise<TransactionRequest> {
    const { approved } = parseOrThrow(resolveEvaluationInputSchema, body, "resolveInitialEvaluation input");
    await this.assertNotPaused();
    this.requireState(job, "Submitted");
    return this.build(ctx, "EVAL", "resolveInitialEvaluation", this.chain.hubAddress(), [BigInt(jobId), approved], { jobId });
  }

  // ---- exits (NOT paused-gated) ----

  async prepareCancelJob(ctx: PrepareCtx, jobId: string, job: OnchainJob): Promise<TransactionRequest> {
    this.requireState(job, "Funded");
    return this.build(ctx, "CANCEL", "cancelJob", this.chain.hubAddress(), [BigInt(jobId)], { jobId });
  }

  async prepareExpireJob(ctx: PrepareCtx, jobId: string, job: OnchainJob): Promise<TransactionRequest> {
    this.requireState(job, "AcceptedByProvider", "Submitted");
    return this.build(ctx, "EXPIRE", "expireJob", this.chain.hubAddress(), [BigInt(jobId)], { jobId });
  }

  async prepareWithdrawCollateral(ctx: PrepareCtx, jobId: string, job: OnchainJob): Promise<TransactionRequest> {
    this.requireState(job, "InitiallyApproved");
    if (job.coverageEnd > BigInt(Math.floor(Date.now() / 1000))) {
      throw new ApiError("STATE_CONFLICT", "Coverage window is still open");
    }
    return this.build(ctx, "WITHDRAW", "withdrawCollateral", this.chain.hubAddress(), [BigInt(jobId)], { jobId });
  }
}
