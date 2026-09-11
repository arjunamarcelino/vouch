import { Module } from "@nestjs/common";
import { AgentController } from "./agent.controller";
import { QuotesController } from "./quotes.controller";
import { AgentService } from "./agent.service";

@Module({
  controllers: [AgentController, QuotesController],
  providers: [AgentService],
  exports: [AgentService], // health probe reuses AgentService.health() (review 071)
})
export class AgentModule {}
