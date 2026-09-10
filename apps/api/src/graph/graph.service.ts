import { Injectable } from "@nestjs/common";
import { VouchError } from "@vouch/shared/errors";
import { querySubgraph, assertFresh, type FreshnessConfig, type Freshness } from "@vouch/shared/graph";
import { loadEnv } from "../config/env";

/**
 * Reads the authoritative reputation/financial read-model from The Graph. Onchain + subgraph are
 * authoritative; this service never writes financial state. Fail-closed via the shared gate — the
 * same freshness policy the agent uses (plan §5 / §6).
 */
@Injectable()
export class GraphService {
  private readonly env = loadEnv();

  private requireUrl(): string {
    if (!this.env.SUBGRAPH_URL) {
      throw new VouchError("CHAIN_NOT_CONFIGURED", "SUBGRAPH_URL not configured");
    }
    return this.env.SUBGRAPH_URL;
  }

  private freshnessConfig(): FreshnessConfig {
    return {
      rpcUrl: this.env.ARC_RPC_URL,
      maxLagBlocks: this.env.SUBGRAPH_MAX_LAG_BLOCKS,
      maxStalenessSeconds: this.env.SUBGRAPH_MAX_STALENESS_SECONDS,
      deploymentId: this.env.SUBGRAPH_DEPLOYMENT_ID,
    };
  }

  /** Raw query (throws typed VouchError on any transport/GraphQL failure). */
  async query<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    return querySubgraph<T>(this.requireUrl(), query, variables);
  }

  /** Assert the index is fresh enough for a money-moving read; throws (fail-closed) otherwise. */
  async assertFresh(): Promise<Freshness> {
    return assertFresh(this.requireUrl(), this.freshnessConfig());
  }

  /** Liveness/health for monitoring — returns freshness or throws. */
  async health(): Promise<Freshness> {
    return this.assertFresh();
  }
}
