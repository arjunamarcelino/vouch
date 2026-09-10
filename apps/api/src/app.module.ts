import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { JobsModule } from "./jobs/jobs.module";
import { AgentModule } from "./agent/agent.module";

@Module({
  imports: [JobsModule, AgentModule],
  controllers: [AppController],
})
export class AppModule {}
