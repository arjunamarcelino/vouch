import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { listFeedEvents } from "@vouch/db";
import { AuthGuard } from "../auth/guards/auth.guard";

interface FeedItem {
  id: string;
  kind: string;
  jobRequestId: string | null;
  correlationId: string | null;
  payload: unknown;
  at: Date;
}

/** Dashboard activity feed (append-only, allowlisted non-secret payloads). Keyset-ordered newest-first. */
@Controller("feed")
@UseGuards(AuthGuard)
export class FeedController {
  @Get()
  async list(@Query("jobId") jobId?: string): Promise<FeedItem[]> {
    const rows = await listFeedEvents(jobId);
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      jobRequestId: r.jobRequestId,
      correlationId: r.correlationId,
      payload: r.payload,
      at: r.at,
    }));
  }
}
