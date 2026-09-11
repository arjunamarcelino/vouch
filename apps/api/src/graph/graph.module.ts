import { Module } from "@nestjs/common";
import { GraphService } from "./graph.service";

/** Exported GraphService (fail-closed subgraph reads) — imported by Jobs and Health. */
@Module({
  providers: [GraphService],
  exports: [GraphService],
})
export class GraphModule {}
