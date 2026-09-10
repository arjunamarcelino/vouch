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

export interface Meta {
  block: { number: number; timestamp: number | null };
  deployment: string;
  hasIndexingErrors: boolean;
}

/** GraphQL selection for `_meta`, folded into load-bearing reads so data + freshness share a block. */
export const META_SELECTION = `_meta { block { number timestamp } deployment hasIndexingErrors }`;

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
  let body: { data?: T; errors?: unknown };
  try {
    body = (await res.json()) as { data?: T; errors?: unknown };
  } catch (cause) {
    // A 200 with a non-JSON body is still "unavailable/degraded" — keep it in the typed taxonomy.
    throw new VouchError("SUBGRAPH_UNAVAILABLE", `Subgraph returned a non-JSON body (${redactUrl(url)})`, cause);
  }
  if (body.errors) {
    throw new VouchError("SUBGRAPH_UNAVAILABLE", `Subgraph GraphQL errors (${redactUrl(url)})`, body.errors);
  }
  if (body.data === undefined || body.data === null) {
    throw new VouchError("SUBGRAPH_UNAVAILABLE", `Subgraph returned no data (${redactUrl(url)})`);
  }
  return body.data;
}

// Short-TTL chain-head cache (023): the head moves at block cadence, so re-fetching eth_blockNumber
// on every quote is wasted RPC load. TTL is far below the staleness budget, so freshness is intact.
const CHAIN_HEAD_TTL_MS = 1500;
const chainHeadCache = new Map<string, { value: bigint; expiresAt: number }>();

/** Read the chain head via JSON-RPC (short-TTL cached). Throws SUBGRAPH_LAGGING when unknowable. */
export async function getChainHead(rpcUrl: string, timeoutMs: number): Promise<bigint> {
  const cached = chainHeadCache.get(rpcUrl);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = await fetchChainHead(rpcUrl, timeoutMs);
  chainHeadCache.set(rpcUrl, { value, expiresAt: Date.now() + CHAIN_HEAD_TTL_MS });
  return value;
}

async function fetchChainHead(rpcUrl: string, timeoutMs: number): Promise<bigint> {
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
  let body: { result?: string };
  try {
    body = (await res.json()) as { result?: string };
  } catch (cause) {
    throw new VouchError("SUBGRAPH_LAGGING", "Chain head RPC returned a non-JSON body", cause);
  }
  if (!body.result) throw new VouchError("SUBGRAPH_LAGGING", "Chain head RPC returned no result");
  try {
    return BigInt(body.result);
  } catch {
    throw new VouchError("SUBGRAPH_LAGGING", "Chain head RPC returned a non-numeric result");
  }
}

const META_QUERY = `{ ${META_SELECTION} }`;

/** Convert a subgraph numeric field to bigint, keeping malformed values inside the typed taxonomy. */
function toBlockBigInt(value: unknown, what: string): bigint {
  if (value === null || value === undefined) {
    throw new VouchError("SUBGRAPH_UNAVAILABLE", `Subgraph ${what} is missing`);
  }
  try {
    return BigInt(value as string | number);
  } catch (cause) {
    throw new VouchError("SUBGRAPH_UNAVAILABLE", `Subgraph ${what} is not numeric`, cause);
  }
}

/**
 * PURE freshness decision over an already-fetched `_meta` + chain head. Throws (fail-closed) on any
 * failure; returns FRESH on success. Distinguishes "subgraph behind" (sync lag) from "chain quiet" —
 * a stale chain head alone does not refuse (architecture review HIGH). Reusable by consumers that fold
 * `_meta` into their data query (so data + freshness share one block — 015).
 */
export function checkFreshness(meta: Meta | null, chainHead: bigint, cfg: FreshnessConfig): Freshness {
  if (meta === null || meta === undefined) {
    throw new VouchError("SUBGRAPH_UNAVAILABLE", "Subgraph returned no _meta");
  }
  if (meta.hasIndexingErrors) {
    throw new VouchError("SUBGRAPH_STALE", "Subgraph reports indexing errors");
  }
  if (cfg.deploymentId && meta.deployment !== cfg.deploymentId) {
    throw new VouchError(
      "SUBGRAPH_UNAVAILABLE",
      `Subgraph deployment mismatch (expected ${cfg.deploymentId})`,
    );
  }

  const latestIndexedBlock = toBlockBigInt(meta.block.number, "_meta.block.number");
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

  // A money-moving read needs a block timestamp; a missing one can't be aged, so refuse (019).
  const metaTs = meta.block.timestamp;
  if (metaTs === null || metaTs === undefined) {
    throw new VouchError("SUBGRAPH_STALE", "Subgraph block has no timestamp");
  }
  const nowSeconds = cfg.nowSeconds ?? Math.floor(Date.now() / 1000);
  const staleness = nowSeconds - metaTs;
  // Primary: wall-clock staleness is meaningful RELATIVE to sync lag — a quiet chain (old head, zero
  // lag) must NOT refuse (architecture HIGH). Secondary: an ABSOLUTE ceiling still refuses a block
  // that's implausibly old even at lag==0, so a frozen/lying RPC (head==stale indexed) can't bypass
  // both gates (security 019). One RPC can't distinguish "quiet" from "lying" below that ceiling.
  const HARD_STALENESS_MULTIPLIER = 10;
  if (lagBlocks > 0n && staleness > cfg.maxStalenessSeconds) {
    throw new VouchError(
      "SUBGRAPH_STALE",
      `Subgraph block is ${staleness}s old (max ${cfg.maxStalenessSeconds})`,
    );
  }
  if (staleness > cfg.maxStalenessSeconds * HARD_STALENESS_MULTIPLIER) {
    throw new VouchError(
      "SUBGRAPH_STALE",
      `Subgraph block is ${staleness}s old (absolute max ${cfg.maxStalenessSeconds * HARD_STALENESS_MULTIPLIER})`,
    );
  }

  return { dataConfidence: "FRESH", latestIndexedBlock, chainHead, lagBlocks };
}

/**
 * Fetch `_meta` + chain head and assert freshness. For callers (e.g. the API health probe) that don't
 * fold `_meta` into a data query. Consumers on the hot path should fold `META_SELECTION` into their
 * query and call `checkFreshness` directly to keep data + freshness on one block (015).
 */
export async function assertFresh(url: string, cfg: FreshnessConfig): Promise<Freshness> {
  if (!cfg.rpcUrl) {
    // No RPC ⇒ lag is unverifiable ⇒ blind ⇒ refuse (security F1).
    throw new VouchError("SUBGRAPH_LAGGING", "Cannot verify freshness: RPC URL not configured");
  }
  const timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const [{ _meta }, chainHead] = await Promise.all([
    querySubgraph<{ _meta: Meta | null }>(url, META_QUERY, {}, timeoutMs),
    getChainHead(cfg.rpcUrl, timeoutMs),
  ]);
  return checkFreshness(_meta, chainHead, cfg);
}
