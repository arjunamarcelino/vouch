import { Controller, Get, Post, Req, Body, UseGuards, UseInterceptors } from "@nestjs/common";
import type { TransactionRequest } from "@vouch/shared/schemas";
import { OrchestrationService } from "./orchestration.service";
import { ChainService } from "../common/chain/chain.service";
import { AuthGuard } from "../auth/guards/auth.guard";
import { IdempotencyInterceptor } from "../common/idempotency/idempotency.interceptor";
import { prepareCtx } from "../common/prepare";
import type { SessionUser } from "../auth/roles";

interface Req {
  user: SessionUser;
  headers: Record<string, string | string[] | undefined>;
}

/** USDC allowance to the hub (openJob/acceptJob are a 2-tx approve→action flow). */
@Controller("allowance")
@UseGuards(AuthGuard)
export class AllowanceController {
  constructor(
    private readonly orchestration: OrchestrationService,
    private readonly chain: ChainService,
  ) {}

  @Get()
  async current(@Req() req: Req): Promise<{ owner: string; spender: string; allowance: string }> {
    const allowance = await this.chain.allowance(req.user.address);
    return { owner: req.user.address, spender: this.chain.hubAddress(), allowance: allowance.toString() };
  }

  @Post("approve/prepare")
  @UseInterceptors(IdempotencyInterceptor)
  approve(@Req() req: Req, @Body() body: unknown): Promise<TransactionRequest> {
    return this.orchestration.prepareApprove(prepareCtx(req), body);
  }
}
