import {
  parseOrThrow,
  providerRiskFeaturesSchema,
  type ProviderRiskEnvelope,
} from "@vouch/shared/schemas";
import {
  checkFreshness,
  getChainHead,
  querySubgraph,
  META_SELECTION,
  type FreshnessConfig,
  type Meta,
} from "@vouch/shared/graph";
import { VouchError } from "@vouch/shared/errors";

/**
 * Live-data access for the risk agent. Fail-closed: freshness is asserted (throws SUBGRAPH_STALE /
 * LAGGING / UNAVAILABLE) BEFORE any provider read, so a lagging/empty index can never masquerade as
 * clean history. "New provider" is a typed return, only ever after freshness passes (plan §5.3/§6).
 */

export type ProviderRiskResult =
  | { kind: "features"; envelope: ProviderRiskEnvelope }
  | { kind: "new-provider"; latestIndexedBlock: string };

const TRAILING_DAYS = 30;
const SECONDS_PER_DAY = 86_400;
// first: 31 (not 30) is a deliberate boundary guard: a partial day-bucket at the window edge can slip
// in without skewing the ratio (both numerator and denominator include it). (031)

// Single request: _meta rides with the data so freshness + data share ONE block (015). Reads the
// CURRENT denormalized risk view off Provider (no snapshot-partition sort — 023). No @derivedFrom
// list selections; every list is bounded.
const RISK_QUERY = `
  query ProviderRisk($id: ID!, $since: BigInt!) {
    ${META_SELECTION}
    protocols(first: 1) { totalJobs }
    provider(id: $id) {
      id
      jobsCompleted
      totalCoveredAmount
      claimsUpheld
      lastUpheldClaimRateBps
      lastAverageCoverageRatioBps
      lastSampleSize
      lastHasEnoughHistory
      dailyMetrics(where: { dayStartTimestamp_gte: $since }, orderBy: dayStartTimestamp, orderDirection: desc, first: 31) {
        upheldFailures
        closedWindows
      }
    }
  }
`;

interface RawDaily {
  upheldFailures: string;
  closedWindows: string;
}
interface RawProvider {
  id: string;
  jobsCompleted: string;
  totalCoveredAmount: string;
  claimsUpheld: string;
  lastUpheldClaimRateBps: string;
  lastAverageCoverageRatioBps: string;
  lastSampleSize: string;
  lastHasEnoughHistory: boolean;
  dailyMetrics: RawDaily[];
}

/** Convert a subgraph numeric string to bigint, mapping malformed values to the typed taxonomy. */
function toBigIntOrThrow(value: string, what: string): bigint {
  try {
    return BigInt(value);
  } catch (cause) {
    throw new VouchError("SUBGRAPH_UNAVAILABLE", `Subgraph ${what} is not numeric`, cause);
  }
}

/**
 * Trailing-window recent-failure rate in bps = recent upheld failures / recent CLOSED windows
 * (failures over recent volume), BigInt (num*10000/den; -1 when no recent volume). (028)
 * Exported for unit testing (022).
 */
export function recentFailureRateBps(daily: RawDaily[]): bigint {
  let upheld = 0n;
  let closed = 0n;
  for (const d of daily) {
    upheld += toBigIntOrThrow(d.upheldFailures, "dailyMetric.upheldFailures");
    closed += toBigIntOrThrow(d.closedWindows, "dailyMetric.closedWindows");
  }
  if (closed === 0n) return -1n;
  return (upheld * 10_000n) / closed;
}

export async function getProviderRisk(
  url: string,
  provider: string,
  freshness: FreshnessConfig,
): Promise<ProviderRiskResult> {
  if (!freshness.rpcUrl) {
    // No RPC ⇒ lag unverifiable ⇒ blind ⇒ refuse (security F1), same as assertFresh.
    throw new VouchError("SUBGRAPH_LAGGING", "Cannot verify freshness: RPC URL not configured");
  }
  const nowSeconds = freshness.nowSeconds ?? Math.floor(Date.now() / 1000);
  const since = (nowSeconds - TRAILING_DAYS * SECONDS_PER_DAY).toString();

  // One subgraph request (data + _meta) and the chain head fetched CONCURRENTLY (015 / 023).
  const [data, chainHead] = await Promise.all([
    querySubgraph<{
      _meta: Meta | null;
      protocols: { totalJobs: string }[];
      provider: RawProvider | null;
    }>(url, RISK_QUERY, { id: provider.toLowerCase(), since }, freshness.timeoutMs),
    getChainHead(freshness.rpcUrl, freshness.timeoutMs ?? 10_000),
  ]);

  // Fail closed on the _meta that came back WITH the data (same block) — throws if stale/lagging.
  const fresh = checkFreshness(data._meta, chainHead, freshness);
  const latestIndexedBlock = fresh.latestIndexedBlock.toString();

  // Data-presence guard (013): a fresh index that has indexed ZERO jobs is empty/wrong-contract, not
  // a source of "new provider" truth — refuse rather than quote a phantom-clean population.
  const proto = data.protocols.length > 0 ? data.protocols[0] : undefined;
  const totalJobs = proto ? toBigIntOrThrow(proto.totalJobs, "protocol.totalJobs") : 0n;
  if (totalJobs === 0n) {
    throw new VouchError("SUBGRAPH_UNAVAILABLE", "Subgraph has indexed no jobs (empty or wrong index)");
  }

  // Genuinely absent AND the index is fresh ⇒ new provider. Never "blind".
  if (data.provider === null || data.provider === undefined) {
    return { kind: "new-provider", latestIndexedBlock };
  }

  const p = data.provider;
  const features = parseOrThrow(
    providerRiskFeaturesSchema,
    {
      completedJobs: p.jobsCompleted,
      upheldClaimRateBps: p.lastUpheldClaimRateBps,
      recentFailureRateBps: recentFailureRateBps(p.dailyMetrics).toString(),
      averageCoverageRatioBps: p.lastAverageCoverageRatioBps,
      totalCoveredAmount: p.totalCoveredAmount,
      totalPaidClaims: p.claimsUpheld,
      sampleSize: p.lastSampleSize,
      hasEnoughHistory: p.lastHasEnoughHistory,
    },
    "provider risk features",
  );

  return {
    kind: "features",
    envelope: {
      features,
      dataConfidence: fresh.dataConfidence,
      latestIndexedBlock,
      asOfBlock: latestIndexedBlock,
    },
  };
}
