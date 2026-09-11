import { Module } from "@nestjs/common";
import { JobsController } from "./jobs.controller";
import { JobsService } from "./jobs.service";
import { OrchestrationController } from "./orchestration.controller";
import { AllowanceController } from "./allowance.controller";
import { OrchestrationService } from "./orchestration.service";
import { GraphModule } from "../graph/graph.module";

@Module({
  imports: [GraphModule],
  controllers: [JobsController, OrchestrationController, AllowanceController],
  providers: [JobsService, OrchestrationService],
})
export class JobsModule {}
