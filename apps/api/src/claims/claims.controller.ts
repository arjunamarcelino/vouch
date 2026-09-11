import { Body, Controller, Get, Param, Post, Req, UseGuards, UseInterceptors } from "@nestjs/common";
import { VouchError } from "@vouch/shared/errors";
import type { TransactionRequest } from "@vouch/shared/schemas";
import { ClaimsService, type ClaimStatusView } from "./claims.service";
import { ChainService, type OnchainJob } from "../common/chain/chain.service";
import { AuthGuard } from "../auth/guards/auth.guard";
import { JobPartyGuard } from "../auth/guards/job-party.guard";
import { IdempotencyInterceptor } from "../common/idempotency/idempotency.interceptor";
import { JobParty, type SessionUser } from "../auth/roles";
import type { PrepareCtx } from "../jobs/orchestration.service";

interface ClaimReq {
  user: SessionUser;
  headers: Record<string, string | string[] | undefined>;
  job?: OnchainJob;
}

function ctxOf(req: ClaimReq): PrepareCtx {
  const key = req.headers["idempotency-key"];
  return { address: req.user.address, idempotencyKey: (Array.isArray(key) ? key[0] : key) ?? "" };
}
function jobId(id: string): string {
  if (!/^\d+$/u.test(id)) throw new VouchError("VALIDATION_FAILED", "Malformed jobId");
  return id;
}

/**
 * Claim intake + CRE evaluation. `prepare` opens the claim (client-only) — which triggers the
 * confidential workflow off-chain; the API never calls CRE. `status` is participant-scoped;
 * `resolve-timeout` is the permissionless fallback (any participant). The route param uses `:jobId`.
 */
@Controller("claims")
@UseGuards(AuthGuard)
export class ClaimsController {
  constructor(
    private readonly claims: ClaimsService,
    private readonly chain: ChainService,
  ) {}

  @Post(":jobId/prepare")
  @JobParty("client")
  @UseGuards(JobPartyGuard)
  @UseInterceptors(IdempotencyInterceptor)
  openClaim(@Req() req: ClaimReq, @Param("jobId") id: string, @Body() body: unknown): Promise<TransactionRequest> {
    return this.claims.prepareOpenClaim(ctxOf(req), jobId(id), req.job!, body);
  }

  @Post(":jobId/resolve-timeout/prepare")
  @JobParty("any")
  @UseGuards(JobPartyGuard)
  @UseInterceptors(IdempotencyInterceptor)
  resolveTimeout(@Req() req: ClaimReq, @Param("jobId") id: string): Promise<TransactionRequest> {
    return this.claims.prepareResolveClaimTimeout(ctxOf(req), jobId(id), req.job!);
  }

  @Get(":jobId/status")
  @JobParty("any")
  @UseGuards(JobPartyGuard)
  status(@Req() req: ClaimReq, @Param("jobId") id: string): Promise<ClaimStatusView> {
    // Reuse the job the guard already loaded (one getJob per request — review 057).
    return this.claims.getClaimStatus(jobId(id), req.job!);
  }
}
