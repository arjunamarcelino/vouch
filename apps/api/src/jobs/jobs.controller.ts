import { Controller, Get } from "@nestjs/common";
import { JobsService } from "./jobs.service";

@Controller("jobs")
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get("providers")
  topProviders(): Promise<unknown> {
    return this.jobs.topProviders();
  }
}
