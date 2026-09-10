import { Controller, Get, Param } from "@nestjs/common";
import { AgentService } from "./agent.service";

/** Dashboard-facing read surface for the agent's quotes + hash-chained decision log. */
@Controller("agent")
export class AgentController {
  constructor(private readonly agent: AgentService) {}

  @Get("health")
  health(): Promise<unknown> {
    return this.agent.health();
  }

  @Get("quotes/:quoteId")
  quote(@Param("quoteId") quoteId: string): Promise<unknown> {
    return this.agent.quote(quoteId);
  }

  @Get("quotes/:quoteId/trace")
  trace(@Param("quoteId") quoteId: string): Promise<unknown> {
    return this.agent.trace(quoteId);
  }

  @Get("tx/:key")
  txStatus(@Param("key") key: string): Promise<unknown> {
    return this.agent.txStatus(key);
  }
}
