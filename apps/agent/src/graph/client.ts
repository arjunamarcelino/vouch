import {
  providerReputationSchema,
  type ProviderReputation,
} from "@vouch/shared/schemas";
import { VouchError } from "@vouch/shared/errors";

/** Minimal GraphQL client for the Vouch subgraph (live, non-mocked data). */
export async function querySubgraph<T>(
  url: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new VouchError("SUBGRAPH_UNAVAILABLE", `Subgraph HTTP ${res.status}`);
  }
  const body = (await res.json()) as { data?: T; errors?: unknown };
  if (body.errors) {
    throw new VouchError("SUBGRAPH_UNAVAILABLE", JSON.stringify(body.errors));
  }
  if (body.data === undefined) {
    throw new VouchError("SUBGRAPH_UNAVAILABLE", "Subgraph returned no data");
  }
  return body.data;
}

/** Freshness guard — refuse to quote on a stale or errored index (plan §17.4). */
export async function assertSubgraphFresh(url: string): Promise<void> {
  const data = await querySubgraph<{
    _meta: { block: { number: number }; hasIndexingErrors: boolean };
  }>(url, `{ _meta { block { number } hasIndexingErrors } }`);
  if (data._meta.hasIndexingErrors) {
    throw new VouchError("SUBGRAPH_STALE", "Subgraph reports indexing errors");
  }
}

const PROVIDER_QUERY = `
  query ProviderRisk($id: ID!) {
    provider(id: $id) {
      id
      jobsCompleted
      guaranteesLocked
      regressions
      totalPaidOut
      totalGuaranteedValue
    }
  }
`;

export async function getProviderReputation(
  url: string,
  provider: string,
): Promise<ProviderReputation | null> {
  const data = await querySubgraph<{ provider: unknown | null }>(url, PROVIDER_QUERY, {
    id: provider.toLowerCase(),
  });
  if (data.provider === null || data.provider === undefined) return null;
  return providerReputationSchema.parse(data.provider);
}
