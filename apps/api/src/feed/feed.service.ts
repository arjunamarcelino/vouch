import { Injectable } from "@nestjs/common";
import { listFeedEventsForAddress } from "@vouch/db";

export interface FeedItem {
  id: string;
  kind: string;
  jobRequestId: string | null;
  correlationId: string | null;
  payload: unknown;
  at: Date;
}

/** Participant-scoped activity feed (controller stays thin — review 065). */
@Injectable()
export class FeedService {
  async listForCaller(address: string, jobId?: string): Promise<FeedItem[]> {
    const rows = await listFeedEventsForAddress(address, jobId);
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
