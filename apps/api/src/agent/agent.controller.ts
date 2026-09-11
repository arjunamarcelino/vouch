import { Controller, Get, Param } from "@nestjs/common";
import { VouchError } from "@vouch/shared/errors";
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
    if (!/^0x[a-fA-F0-9]{64}$/u.test(key)) throw new VouchError("VALIDATION_FAILED", "Malformed key");
    return this.agent.txStatus(key);
  }
}
