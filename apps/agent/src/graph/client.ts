import {
  parseOrThrow,
  providerRiskFeaturesSchema,
  type ProviderRiskEnvelope,
} from "@vouch/shared/schemas";
import { assertFresh, querySubgraph, type FreshnessConfig } from "@vouch/shared/graph";
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

const RISK_QUERY = `
  query ProviderRisk($id: ID!, $since: BigInt!) {
    provider(id: $id) {
      id
      jobsCompleted
      totalCoveredAmount
      claimsUpheld
      snapshots(orderBy: blockNumber, orderDirection: desc, first: 1) {
        upheldClaimRateBps
        averageCoverageRatioBps
        sampleSize
        hasEnoughHistory
      }
      dailyMetrics(where: { dayStartTimestamp_gte: $since }, orderBy: dayStartTimestamp, orderDirection: desc, first: 31) {
        upheldFailures
        resolvedClaims
      }
    }
  }
`;

interface RawSnapshot {
  upheldClaimRateBps: string;
  averageCoverageRatioBps: string;
  sampleSize: string;
  hasEnoughHistory: boolean;
}
interface RawDaily {
  upheldFailures: string;
  resolvedClaims: string;
}
interface RawProvider {
  id: string;
  jobsCompleted: string;
  totalCoveredAmount: string;
  claimsUpheld: string;
  snapshots: RawSnapshot[];
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

/** Trailing-window recent-failure rate in bps, computed as BigInt (num*10000/den; -1 undefined). */
function recentFailureRateBps(daily: RawDaily[]): bigint {
  let upheld = 0n;
  let resolved = 0n;
  for (const d of daily) {
    upheld += toBigIntOrThrow(d.upheldFailures, "dailyMetric.upheldFailures");
    resolved += toBigIntOrThrow(d.resolvedClaims, "dailyMetric.resolvedClaims");
  }
  if (resolved === 0n) return -1n;
  return (upheld * 10_000n) / resolved;
}

export async function getProviderRisk(
  url: string,
  provider: string,
  freshness: FreshnessConfig,
): Promise<ProviderRiskResult> {
  // Fail closed FIRST — throws if the index is unavailable/lagging/stale (plan §6).
  const fresh = await assertFresh(url, freshness);
  const latestIndexedBlock = fresh.latestIndexedBlock.toString();

  const nowSeconds = freshness.nowSeconds ?? Math.floor(Date.now() / 1000);
  const since = (nowSeconds - TRAILING_DAYS * SECONDS_PER_DAY).toString();

  const data = await querySubgraph<{ provider: RawProvider | null }>(
    url,
    RISK_QUERY,
    { id: provider.toLowerCase(), since },
    freshness.timeoutMs,
  );

  // Genuinely absent AND the index is fresh (asserted above) ⇒ new provider. Never "blind".
  if (data.provider === null || data.provider === undefined) {
    return { kind: "new-provider", latestIndexedBlock };
  }

  const p = data.provider;
  const snap = p.snapshots.length > 0 ? p.snapshots[0] : null;

  const features = parseOrThrow(
    providerRiskFeaturesSchema,
    {
      completedJobs: p.jobsCompleted,
      upheldClaimRateBps: snap ? snap.upheldClaimRateBps : "-1",
      recentFailureRateBps: recentFailureRateBps(p.dailyMetrics).toString(),
      averageCoverageRatioBps: snap ? snap.averageCoverageRatioBps : "-1",
      totalCoveredAmount: p.totalCoveredAmount,
      totalPaidClaims: p.claimsUpheld,
      sampleSize: snap ? snap.sampleSize : "0",
      hasEnoughHistory: snap ? snap.hasEnoughHistory : false,
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
