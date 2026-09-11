import { Module } from "@nestjs/common";
import { AgentController } from "./agent.controller";
import { QuotesController } from "./quotes.controller";
import { AgentService } from "./agent.service";

@Module({
  controllers: [AgentController, QuotesController],
  providers: [AgentService],
})
export class AgentModule {}
