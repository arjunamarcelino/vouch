import { Body, Controller, Get, Param, Post, Req, UseGuards, UseInterceptors } from "@nestjs/common";
import { z } from "zod";
import { parseOrThrow } from "@vouch/shared/schemas";
import { TransactionsService, type TrackResult } from "./transactions.service";
import { AuthGuard } from "../auth/guards/auth.guard";
import { IdempotencyInterceptor } from "../common/idempotency/idempotency.interceptor";
import type { SessionUser } from "../auth/roles";

const trackBodySchema = z
  .object({
    txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/u, "must be a 32-byte tx hash"),
    preparedId: z.string().uuid(),
  })
  .strict();

@Controller("transactions")
@UseGuards(AuthGuard)
export class TransactionsController {
  constructor(private readonly txns: TransactionsService) {}

  @Post("track")
  @UseInterceptors(IdempotencyInterceptor)
  track(@Req() req: { user: SessionUser }, @Body() body: unknown): Promise<TrackResult> {
    const { txHash, preparedId } = parseOrThrow(trackBodySchema, body, "track body");
    return this.txns.track({ address: req.user.address }, { txHash, preparedId });
  }

  @Get(":txHash")
  status(@Param("txHash") txHash: string): Promise<TrackResult> {
    return this.txns.getStatus(txHash);
  }
}
