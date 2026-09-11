import { Injectable } from "@nestjs/common";
import { VouchError } from "@vouch/shared/errors";
import {
  querySubgraph,
  assertFresh,
  checkFreshness,
  getChainHead,
  META_SELECTION,
  type Meta,
  type FreshnessConfig,
  type Freshness,
} from "@vouch/shared/graph";
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

  /** The `_meta { … }` selection callers must fold into a `queryFresh` data query. */
  static readonly META_SELECTION = META_SELECTION;

  /**
   * Fail-closed data read that folds freshness into ONE round-trip: the `query` MUST include
   * `${GraphService.META_SELECTION}`; this reads `_meta` + the chain head together and runs the shared
   * `checkFreshness` (throws SUBGRAPH_* on stale/lag), so data + freshness are on the same block and the
   * separate `assertFresh` round-trip is avoided (review 063).
   */
  async queryFresh<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const cfg = this.freshnessConfig();
    if (!cfg.rpcUrl) throw new VouchError("SUBGRAPH_LAGGING", "Cannot verify freshness: RPC URL not configured");
    const [data, chainHead] = await Promise.all([
      this.query<T & { _meta: Meta | null }>(query, variables),
      getChainHead(cfg.rpcUrl, cfg.timeoutMs ?? 10_000),
    ]);
    checkFreshness(data._meta, chainHead, cfg);
    return data;
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
