import { Module } from "@nestjs/common";
import { JobsController } from "./jobs.controller";
import { JobsService } from "./jobs.service";
import { GraphModule } from "../graph/graph.module";

@Module({
  imports: [GraphModule],
  controllers: [JobsController],
  providers: [JobsService],
})
export class JobsModule {}
