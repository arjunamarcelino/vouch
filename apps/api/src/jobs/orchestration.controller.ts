import { Body, Controller, Param, Post, Req, UseGuards, UseInterceptors } from "@nestjs/common";
import { VouchError } from "@vouch/shared/errors";
import type { TransactionRequest } from "@vouch/shared/schemas";
import { OrchestrationService, type PrepareCtx } from "./orchestration.service";
import { ChainService, type OnchainJob } from "../common/chain/chain.service";
import { AuthGuard } from "../auth/guards/auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { JobPartyGuard } from "../auth/guards/job-party.guard";
import { IdempotencyInterceptor } from "../common/idempotency/idempotency.interceptor";
import { Roles, JobParty, type SessionUser } from "../auth/roles";

interface PrepareReq {
  user: SessionUser;
  headers: Record<string, string | string[] | undefined>;
  job?: OnchainJob;
  params: Record<string, string | undefined>;
}

function ctxOf(req: PrepareReq): PrepareCtx {
  const key = req.headers["idempotency-key"];
  return { address: req.user.address, idempotencyKey: (Array.isArray(key) ? key[0] : key) ?? "" };
}

function requireJobId(id: string | undefined): string {
  if (!id || !/^\d+$/u.test(id)) throw new VouchError("VALIDATION_FAILED", "Malformed jobId");
  return id;
}

/**
 * Transaction-preparation endpoints. Each returns UNSIGNED calldata for the wallet to sign; the API
 * signs nothing. Guards enforce authorization early (the contract re-enforces); `@Idempotent` binds one
 * key → one prepared intent. Party-scoped routes reuse the job the JobPartyGuard already loaded.
 */
@Controller("jobs")
@UseGuards(AuthGuard)
export class OrchestrationController {
  constructor(
    private readonly orchestration: OrchestrationService,
    private readonly chain: ChainService,
  ) {}

  @Post("prepare")
  @UseInterceptors(IdempotencyInterceptor)
  openJob(@Req() req: PrepareReq, @Body() body: unknown): Promise<TransactionRequest> {
    return this.orchestration.prepareOpenJob(ctxOf(req), body);
  }

  @Post(":id/accept/prepare")
  @JobParty("provider")
  @UseGuards(JobPartyGuard)
  @UseInterceptors(IdempotencyInterceptor)
  accept(@Req() req: PrepareReq, @Param("id") id: string): Promise<TransactionRequest> {
    return this.orchestration.prepareAcceptJob(ctxOf(req), requireJobId(id), req.job!);
  }

  @Post(":id/deliverable/prepare")
  @JobParty("provider")
  @UseGuards(JobPartyGuard)
  @UseInterceptors(IdempotencyInterceptor)
  submit(@Req() req: PrepareReq, @Param("id") id: string, @Body() body: unknown): Promise<TransactionRequest> {
    return this.orchestration.prepareSubmitDeliverable(ctxOf(req), requireJobId(id), req.job!, body);
  }

  @Post(":id/evaluate/prepare")
  @Roles("EVALUATOR")
  @UseGuards(RolesGuard)
  @UseInterceptors(IdempotencyInterceptor)
  async evaluate(@Req() req: PrepareReq, @Param("id") id: string, @Body() body: unknown): Promise<TransactionRequest> {
    const jobId = requireJobId(id);
    const job = await this.chain.getJob(BigInt(jobId));
    return this.orchestration.prepareResolveInitialEvaluation(ctxOf(req), jobId, job, body);
  }

  @Post(":id/cancel/prepare")
  @JobParty("client")
  @UseGuards(JobPartyGuard)
  @UseInterceptors(IdempotencyInterceptor)
  cancel(@Req() req: PrepareReq, @Param("id") id: string): Promise<TransactionRequest> {
    return this.orchestration.prepareCancelJob(ctxOf(req), requireJobId(id), req.job!);
  }

  @Post(":id/expire/prepare")
  @UseInterceptors(IdempotencyInterceptor)
  async expire(@Req() req: PrepareReq, @Param("id") id: string): Promise<TransactionRequest> {
    const jobId = requireJobId(id);
    const job = await this.chain.getJob(BigInt(jobId));
    return this.orchestration.prepareExpireJob(ctxOf(req), jobId, job);
  }

  @Post(":id/withdraw/prepare")
  @JobParty("provider")
  @UseGuards(JobPartyGuard)
  @UseInterceptors(IdempotencyInterceptor)
  withdraw(@Req() req: PrepareReq, @Param("id") id: string): Promise<TransactionRequest> {
    return this.orchestration.prepareWithdrawCollateral(ctxOf(req), requireJobId(id), req.job!);
  }
}
