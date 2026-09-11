import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { FeedService, type FeedItem } from "./feed.service";
import { AuthGuard } from "../auth/guards/auth.guard";
import type { SessionUser } from "../auth/roles";

/** Dashboard activity feed — participant-scoped (review 054), newest-first. */
@Controller("feed")
@UseGuards(AuthGuard)
export class FeedController {
  constructor(private readonly feed: FeedService) {}

  @Get()
  list(@Req() req: { user: SessionUser }, @Query("jobId") jobId?: string): Promise<FeedItem[]> {
    return this.feed.listForCaller(req.user.address, jobId);
  }
}
