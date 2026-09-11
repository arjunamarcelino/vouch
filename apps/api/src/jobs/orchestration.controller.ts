import { Body, Controller, Param, Post, Req, UseGuards, UseInterceptors } from "@nestjs/common";
import type { TransactionRequest } from "@vouch/shared/schemas";
import { OrchestrationService } from "./orchestration.service";
import { ChainService, type OnchainJob } from "../common/chain/chain.service";
import { AuthGuard } from "../auth/guards/auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { JobPartyGuard } from "../auth/guards/job-party.guard";
import { IdempotencyInterceptor } from "../common/idempotency/idempotency.interceptor";
import { prepareCtx, requireNumericJobId } from "../common/prepare";
import { Roles, JobParty, type SessionUser } from "../auth/roles";

interface PrepareReq {
  user: SessionUser;
  headers: Record<string, string | string[] | undefined>;
  job?: OnchainJob;
  params: Record<string, string | undefined>;
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
    return this.orchestration.prepareOpenJob(prepareCtx(req), body);
  }

  @Post(":id/accept/prepare")
  @JobParty("provider")
  @UseGuards(JobPartyGuard)
  @UseInterceptors(IdempotencyInterceptor)
  accept(@Req() req: PrepareReq, @Param("id") id: string): Promise<TransactionRequest> {
    return this.orchestration.prepareAcceptJob(prepareCtx(req), requireNumericJobId(id), req.job!);
  }

  @Post(":id/deliverable/prepare")
  @JobParty("provider")
  @UseGuards(JobPartyGuard)
  @UseInterceptors(IdempotencyInterceptor)
  submit(@Req() req: PrepareReq, @Param("id") id: string, @Body() body: unknown): Promise<TransactionRequest> {
    return this.orchestration.prepareSubmitDeliverable(prepareCtx(req), requireNumericJobId(id), req.job!, body);
  }

  @Post(":id/evaluate/prepare")
  @Roles("EVALUATOR")
  @UseGuards(RolesGuard)
  @UseInterceptors(IdempotencyInterceptor)
  async evaluate(@Req() req: PrepareReq, @Param("id") id: string, @Body() body: unknown): Promise<TransactionRequest> {
    const jobId = requireNumericJobId(id);
    const job = await this.chain.getJob(BigInt(jobId));
    return this.orchestration.prepareResolveInitialEvaluation(prepareCtx(req), jobId, job, body);
  }

  @Post(":id/cancel/prepare")
  @JobParty("client")
  @UseGuards(JobPartyGuard)
  @UseInterceptors(IdempotencyInterceptor)
  cancel(@Req() req: PrepareReq, @Param("id") id: string): Promise<TransactionRequest> {
    return this.orchestration.prepareCancelJob(prepareCtx(req), requireNumericJobId(id), req.job!);
  }

  @Post(":id/expire/prepare")
  @JobParty("any") // parity with resolve-timeout; the contract stays permissionless (review 069)
  @UseGuards(JobPartyGuard)
  @UseInterceptors(IdempotencyInterceptor)
  expire(@Req() req: PrepareReq, @Param("id") id: string): Promise<TransactionRequest> {
    return this.orchestration.prepareExpireJob(prepareCtx(req), requireNumericJobId(id), req.job!);
  }

  @Post(":id/withdraw/prepare")
  @JobParty("provider")
  @UseGuards(JobPartyGuard)
  @UseInterceptors(IdempotencyInterceptor)
  withdraw(@Req() req: PrepareReq, @Param("id") id: string): Promise<TransactionRequest> {
    return this.orchestration.prepareWithdrawCollateral(prepareCtx(req), requireNumericJobId(id), req.job!);
  }
}
