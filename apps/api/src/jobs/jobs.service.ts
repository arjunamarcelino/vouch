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
    // Fold _meta into the data query + one freshness check (review 063): data + freshness share a block
    // in ONE round-trip. Fail closed — a lagging/stale index 503s, never serves stale reputation.
    const data = await this.graph.queryFresh<{ providers: unknown[] }>(
      `query Top {
        ${GraphService.META_SELECTION}
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
    const id = address.toLowerCase();
    const data = await this.graph.queryFresh<{ provider: unknown | null }>(
      `query One($id: ID!) {
        ${GraphService.META_SELECTION}
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
