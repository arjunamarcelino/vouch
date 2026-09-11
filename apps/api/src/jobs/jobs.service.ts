import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { parseOrThrow } from "@vouch/shared/schemas";
import { GraphService } from "../graph/graph.service";

const providerRowSchema = z.object({
  id: z.string(),
  jobsCompleted: z.string(),
  jobsInitiallyApproved: z.string(),
  claimsUpheld: z.string(),
  claimsRejected: z.string(),
  totalPayoutAmount: z.string(),
  activeGuaranteeAmount: z.string(),
  lastUpheldClaimRateBps: z.string(),
});
export type ProviderRow = z.infer<typeof providerRowSchema>;

/**
 * Job/reputation read API. Authoritative data comes from the subgraph (onchain). Any offchain
 * operational metadata would come from @vouch/db — operational only, never money/reputation/secrets.
 */
@Injectable()
export class JobsService {
  constructor(private readonly graph: GraphService) {}

  /**
   * Established providers, most-proven first. Min-sample guard (jobsInitiallyApproved_gt: 0) so a
   * brand-new zero-history provider doesn't top the list; the phantom `regressions` field is gone.
   */
  async topProviders(): Promise<ProviderRow[]> {
    // Fail closed: a lagging/stale index must 503, not serve stale reputation or read [] as clean (014).
    await this.graph.assertFresh();
    const data = await this.graph.query<{ providers: unknown[] }>(
      `query Top {
        providers(
          first: 20
          where: { jobsInitiallyApproved_gt: 0 }
          orderBy: jobsCompleted
          orderDirection: desc
        ) {
          id
          jobsCompleted
          jobsInitiallyApproved
          claimsUpheld
          claimsRejected
          totalPayoutAmount
          activeGuaranteeAmount
          lastUpheldClaimRateBps
        }
      }`,
    );
    return parseOrThrow(z.array(providerRowSchema), data.providers, "provider rows");
  }

  /**
   * One provider's proven performance, most-authoritative source (The Graph). Fail-closed on staleness
   * (assertFresh) — a lagging index must 503, never serve stale reputation. Returns null when the
   * provider has no indexed history yet.
   */
  async providerPerformance(address: string): Promise<ProviderRow | null> {
    await this.graph.assertFresh();
    const id = address.toLowerCase();
    const data = await this.graph.query<{ provider: unknown | null }>(
      `query One($id: ID!) {
        provider(id: $id) {
          id
          jobsCompleted
          jobsInitiallyApproved
          claimsUpheld
          claimsRejected
          totalPayoutAmount
          activeGuaranteeAmount
          lastUpheldClaimRateBps
        }
      }`,
      { id },
    );
    if (data.provider === null || data.provider === undefined) return null;
    return parseOrThrow(providerRowSchema, data.provider, "provider row");
  }
}
