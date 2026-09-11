import { Controller, Get, Param, Req, UseGuards } from "@nestjs/common";
import { VouchError } from "@vouch/shared/errors";
import { listJobsForAddress } from "@vouch/db";
import { JobsService } from "./jobs.service";
import { ChainService, type OnchainJob } from "../common/chain/chain.service";
import { AuthGuard } from "../auth/guards/auth.guard";
import { JobPartyGuard } from "../auth/guards/job-party.guard";
import { JobParty, type SessionUser } from "../auth/roles";

/**
 * Job read surface. `providers` (reputation) is public and Graph-authoritative (fail-closed). `mine`
 * and `:id` are participant-scoped and CHAIN-first (getJob is instant + authoritative for lifecycle;
 * the mirror is display-only). Literal routes (`providers`, `mine`) are declared before `:id` so they
 * win over the param route.
 */
@Controller("jobs")
export class JobsController {
  constructor(
    private readonly jobs: JobsService,
    private readonly chain: ChainService,
  ) {}

  @Get("providers")
  topProviders(): Promise<unknown> {
    return this.jobs.topProviders();
  }

  @Get("mine")
  @UseGuards(AuthGuard)
  async mine(@Req() req: { user: SessionUser }): Promise<unknown> {
    const rows = await listJobsForAddress(req.user.address);
    return rows.map((r) => ({
      clientRequestId: r.clientRequestId,
      jobId: r.jobId,
      uiTitle: r.uiTitle,
      role: r.clientAddress === req.user.address ? "client" : "provider",
      cachedStatus: r.cachedStatus, // display-only mirror
      createdAt: r.createdAt,
    }));
  }

  @Get(":id")
  @JobParty("any")
  @UseGuards(AuthGuard, JobPartyGuard)
  status(@Req() req: { job?: OnchainJob }, @Param("id") id: string): unknown {
    const job = req.job;
    if (!job) throw new VouchError("VALIDATION_FAILED", "Job not loaded");
    // Chain-first authoritative status; amounts as base-unit strings (never JS number on the wire).
    return {
      jobId: id,
      source: "chain",
      status: job.status,
      client: job.client.toLowerCase(),
      provider: job.provider.toLowerCase(),
      taskFee: job.taskFee.toString(),
      guaranteeAmount: job.guaranteeAmount.toString(),
      serviceFee: job.serviceFee.toString(),
      coverageEnd: job.coverageEnd.toString(),
      submissionDeadline: job.submissionDeadline.toString(),
    };
  }
}
