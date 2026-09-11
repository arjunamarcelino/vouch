import { Controller, Get, Param } from "@nestjs/common";
import { VouchError } from "@vouch/shared/errors";
import { HEX32_RE } from "@vouch/shared/schemas";
import { AgentService } from "./agent.service";

/** Agent liveness + payment-intent (tx) status passthrough. Quotes live under /quotes (QuotesController). */
@Controller("agent")
export class AgentController {
  constructor(private readonly agent: AgentService) {}

  @Get("health")
  health(): Promise<unknown> {
    return this.agent.health();
  }

  @Get("tx/:key")
  txStatus(@Param("key") key: string): Promise<unknown> {
    // Strict-format the passthrough param before it reaches the agent URL (SSRF/path-traversal — M2).
    if (!HEX32_RE.test(key)) throw new VouchError("VALIDATION_FAILED", "Malformed key");
    return this.agent.txStatus(key);
  }
}
