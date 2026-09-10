import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { JobsModule } from "./jobs/jobs.module";

@Module({
  imports: [JobsModule],
  controllers: [AppController],
})
export class AppModule {}
