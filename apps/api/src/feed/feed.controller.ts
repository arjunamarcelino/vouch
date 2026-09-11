import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { listFeedEventsForAddress } from "@vouch/db";
import { AuthGuard } from "../auth/guards/auth.guard";
import type { SessionUser } from "../auth/roles";

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
  async list(@Req() req: { user: SessionUser }, @Query("jobId") jobId?: string): Promise<FeedItem[]> {
    // Participant-scoped: only the caller's own jobs' events (closes the IDOR — review 054).
    const rows = await listFeedEventsForAddress(req.user.address, jobId);
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
