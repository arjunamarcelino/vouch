import { VouchError } from "../errors";
import type { DataConfidence } from "../schemas";

/**
 * Shared, fail-closed GraphQL client for the Vouch subgraph — the SINGLE source of truth for the
 * freshness gate so the agent and API can never disagree on what "stale" means (plan §5 / §6).
 *
 * Fail-closed rules (plan §6, security review F1/F2/F6/F9/F11):
 *  - fetch reject / timeout / non-200 / GraphQL errors / missing data → throw (never return empty).
 *  - refuse when: hasIndexingErrors; deployment ≠ expected; sync-lag (chainHead − metaBlock) exceeds
 *    the budget OR is uncomputable (RPC down / NaN / negative); wall-clock staleness exceeds budget.
 *  - never log a keyed SUBGRAPH_URL — redact to origin+path.
 */

const DEFAULT_TIMEOUT_MS = 10_000;

export interface FreshnessConfig {
  /** JSON-RPC URL used to read the chain head (eth_blockNumber). Required — no RPC ⇒ refuse. */
  rpcUrl: string | undefined;
  maxLagBlocks: number;
  maxStalenessSeconds: number;
  /** Expected deployment CID (Qm…). When set, a mismatched endpoint is refused (trust-root pin). */
  deploymentId?: string;
  /** Wall-clock now in seconds; injectable for tests. Defaults to Date.now()/1000. */
  nowSeconds?: number;
  timeoutMs?: number;
}

export interface Freshness {
  dataConfidence: DataConfidence;
  latestIndexedBlock: bigint;
  chainHead: bigint;
  lagBlocks: bigint;
}

interface Meta {
  block: { number: number; timestamp: number | null };
  deployment: string;
  hasIndexingErrors: boolean;
}

/**
 * Redact to ORIGIN only. The Graph's decentralized gateway carries the API key in the URL *path*
 * (`https://gateway.thegraph.com/api/<KEY>/subgraphs/id/<id>`), so the path — not just the query —
 * must be dropped or the key leaks into every log/error line (security 012). Returns `origin/…`.
 */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}/…`;
  } catch {
    return "<invalid-url>";
  }
}

export async function querySubgraph<T>(
  url: string,
  query: string,
  variables: Record<string, unknown> = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    // DNS failure, connection refused, timeout — the exact "unavailable" cases. Fail closed.
    throw new VouchError("SUBGRAPH_UNAVAILABLE", `Subgraph fetch failed (${redactUrl(url)})`, cause);
  }
  if (!res.ok) {
    throw new VouchError("SUBGRAPH_UNAVAILABLE", `Subgraph HTTP ${res.status} (${redactUrl(url)})`);
  }
  const body = (await res.json()) as { data?: T; errors?: unknown };
  if (body.errors) {
    throw new VouchError("SUBGRAPH_UNAVAILABLE", `Subgraph GraphQL errors (${redactUrl(url)})`, body.errors);
  }
  if (body.data === undefined || body.data === null) {
    throw new VouchError("SUBGRAPH_UNAVAILABLE", `Subgraph returned no data (${redactUrl(url)})`);
  }
  return body.data;
}

/** Read the chain head via JSON-RPC. Throws SUBGRAPH_LAGGING when the head is unknowable. */
async function getChainHead(rpcUrl: string, timeoutMs: number): Promise<bigint> {
  let res: Response;
  try {
    res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    throw new VouchError("SUBGRAPH_LAGGING", "Chain head unreadable (RPC unreachable)", cause);
  }
  if (!res.ok) throw new VouchError("SUBGRAPH_LAGGING", `Chain head RPC HTTP ${res.status}`);
  const body = (await res.json()) as { result?: string };
  if (!body.result) throw new VouchError("SUBGRAPH_LAGGING", "Chain head RPC returned no result");
  try {
    return BigInt(body.result);
  } catch {
    throw new VouchError("SUBGRAPH_LAGGING", "Chain head RPC returned a non-numeric result");
  }
}

const META_QUERY = `{ _meta { block { number timestamp } deployment hasIndexingErrors } }`;

/**
 * Assert the subgraph is fresh enough to trust for a money-moving quote. Throws (fail-closed) on any
 * failure; returns FRESH freshness on success. Distinguishes "subgraph behind" (sync lag) from
 * "chain quiet" — a stale chain head alone does not refuse (architecture review HIGH).
 */
export async function assertFresh(url: string, cfg: FreshnessConfig): Promise<Freshness> {
  if (!cfg.rpcUrl) {
    // No RPC ⇒ lag is unverifiable ⇒ blind ⇒ refuse (security F1).
    throw new VouchError("SUBGRAPH_LAGGING", "Cannot verify freshness: RPC URL not configured");
  }
  const timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const { _meta } = await querySubgraph<{ _meta: Meta | null }>(url, META_QUERY, {}, timeoutMs);
  if (_meta === null || _meta === undefined) {
    throw new VouchError("SUBGRAPH_UNAVAILABLE", "Subgraph returned no _meta");
  }
  if (_meta.hasIndexingErrors) {
    throw new VouchError("SUBGRAPH_STALE", "Subgraph reports indexing errors");
  }
  if (cfg.deploymentId && _meta.deployment !== cfg.deploymentId) {
    throw new VouchError(
      "SUBGRAPH_UNAVAILABLE",
      `Subgraph deployment mismatch (expected ${cfg.deploymentId})`,
    );
  }

  const latestIndexedBlock = BigInt(_meta.block.number);
  const chainHead = await getChainHead(cfg.rpcUrl, timeoutMs);
  const lagBlocks = chainHead - latestIndexedBlock;
  if (lagBlocks < 0n) {
    // RPC behind the indexer — inconsistent view; refuse rather than clamp (security F11).
    throw new VouchError("SUBGRAPH_LAGGING", "Chain head is behind the indexed block");
  }
  if (lagBlocks > BigInt(cfg.maxLagBlocks)) {
    throw new VouchError(
      "SUBGRAPH_LAGGING",
      `Subgraph is ${lagBlocks.toString()} blocks behind (max ${cfg.maxLagBlocks})`,
    );
  }

  // Wall-clock staleness is a secondary signal RELATIVE to sync lag: only meaningful when the
  // subgraph is also block-behind. A quiet chain (old head, zero lag) must NOT refuse.
  const nowSeconds = cfg.nowSeconds ?? Math.floor(Date.now() / 1000);
  const metaTs = _meta.block.timestamp;
  if (metaTs !== null && lagBlocks > 0n) {
    const staleness = nowSeconds - metaTs;
    if (staleness > cfg.maxStalenessSeconds) {
      throw new VouchError(
        "SUBGRAPH_STALE",
        `Subgraph block is ${staleness}s old (max ${cfg.maxStalenessSeconds})`,
      );
    }
  }

  return { dataConfidence: "FRESH", latestIndexedBlock, chainHead, lagBlocks };
}
