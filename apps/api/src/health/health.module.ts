import { Module } from "@nestjs/common";
import { GraphModule } from "../graph/graph.module";
import { AgentModule } from "../agent/agent.module";
import { HealthController } from "./health.controller";
import { HealthService } from "./health.service";

@Module({
  imports: [GraphModule, AgentModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
