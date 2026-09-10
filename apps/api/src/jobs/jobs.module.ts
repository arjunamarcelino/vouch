import { Module } from "@nestjs/common";
import { JobsController } from "./jobs.controller";
import { JobsService } from "./jobs.service";
import { GraphService } from "../graph/graph.service";

@Module({
  controllers: [JobsController],
  providers: [JobsService, GraphService],
})
export class JobsModule {}
