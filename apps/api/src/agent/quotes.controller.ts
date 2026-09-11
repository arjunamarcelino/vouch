import { Body, Controller, Get, Param, Post, UseGuards, UseInterceptors } from "@nestjs/common";
import { VouchError } from "@vouch/shared/errors";
import { HEX32_RE } from "@vouch/shared/schemas";
import { AgentService } from "./agent.service";
import { AuthGuard } from "../auth/guards/auth.guard";
import { IdempotencyInterceptor } from "../common/idempotency/idempotency.interceptor";

/**
 * Quote surface — proxied to the agent's REST core (the agent owns quotes/traces; the API never touches
 * its DB). Request is idempotent; fetch carries a stale guard; explanation surfaces the hash-chained
 * decision log. All quoteId path params are strict-format-validated before interpolation (SSRF — M2).
 */
function requireQuoteId(quoteId: string): string {
  if (!HEX32_RE.test(quoteId)) throw new VouchError("VALIDATION_FAILED", "Malformed quoteId");
  return quoteId;
}

@Controller("quotes")
@UseGuards(AuthGuard)
export class QuotesController {
  constructor(private readonly agent: AgentService) {}

  @Post()
  @UseInterceptors(IdempotencyInterceptor)
  request(@Body() body: unknown): Promise<unknown> {
    return this.agent.requestQuote(body);
  }

  @Post("verify")
  verify(@Body() body: unknown): Promise<unknown> {
    return this.agent.verifyQuote(body);
  }

  @Get(":quoteId")
  fetch(@Param("quoteId") quoteId: string): Promise<unknown> {
    return this.agent.quote(requireQuoteId(quoteId));
  }

  @Get(":quoteId/explanation")
  explanation(@Param("quoteId") quoteId: string): Promise<unknown> {
    return this.agent.explanation(requireQuoteId(quoteId));
  }
}
