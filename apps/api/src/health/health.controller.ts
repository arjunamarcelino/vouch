import { Controller, Get, ServiceUnavailableException, UseGuards } from "@nestjs/common";
import { HealthService } from "./health.service";
import { AuthGuard } from "../auth/guards/auth.guard";

/**
 * `GET /health` — liveness (pure process check). `GET /health/integrations` — readiness: probes Arc
 * RPC, subgraph, agent, DB with per-probe timeouts; returns 503 (fail-closed) when any CRITICAL
 * integration is down, otherwise 200 with the per-integration latency/status report.
 */
@Controller("health")
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  liveness(): { status: "ok" } {
    return this.health.liveness();
  }

  @Get("integrations")
  @UseGuards(AuthGuard) // readiness (topology/latency) is authed; liveness above stays public (review 055)
  async integrations(): Promise<unknown> {
    const result = await this.health.integrations();
    if (result.status === "degraded") throw new ServiceUnavailableException(result);
    return result;
  }
}
