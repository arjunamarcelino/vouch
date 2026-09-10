import { Injectable } from "@nestjs/common";
import { GraphService } from "../graph/graph.service";

interface ProviderRow {
  id: string;
  jobsCompleted: string;
  regressions: string;
  totalPaidOut: string;
  totalGuaranteedValue: string;
}

/**
 * Job/reputation read API. Authoritative data comes from the subgraph (onchain).
 * Any offchain operational metadata (UI titles etc.) would come from @vouch/db —
 * operational only, never money/reputation/secrets.
 */
@Injectable()
export class JobsService {
  constructor(private readonly graph: GraphService) {}

  async topProviders(): Promise<ProviderRow[]> {
    const data = await this.graph.query<{ providers: ProviderRow[] }>(
      `query Top {
        providers(first: 20, orderBy: regressions, orderDirection: desc) {
          id jobsCompleted regressions totalPaidOut totalGuaranteedValue
        }
      }`,
    );
    return data.providers;
  }
}
