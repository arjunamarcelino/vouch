import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { z } from "zod";
import {
  jobViewSchema,
  myJobSchema,
  claimStatusViewSchema,
  providerPerformanceSchema,
  integrationsHealthSchema,
  feedItemSchema,
  allowanceViewSchema,
  authMeSchema,
  type JobView,
  type MyJob,
  type ClaimStatusView,
  type ProviderPerformance,
  type IntegrationsHealth,
  type FeedItem,
  type AllowanceView,
  type AuthMe,
} from "@vouch/shared/schemas";
import { apiGet, ApiClientError } from "./client";

/**
 * Read hooks over the typed client. Query keys are `as const` tuples grouped per area so
 * `invalidateQueries` stays typo-proof. Response types flow from `z.infer` via the client's schema
 * argument — never annotated by hand. Authoritative vs lagging source is a page concern; these hooks
 * just surface the typed data + loading/error.
 */

export const queryKeys = {
  authMe: ["auth", "me"] as const,
  health: ["health", "integrations"] as const,
  myJobs: ["jobs", "mine"] as const,
  job: (id: string) => ["jobs", "detail", id] as const,
  topProviders: ["providers", "top"] as const,
  provider: (address: string) => ["providers", address.toLowerCase()] as const,
  claimStatus: (jobId: string) => ["claims", jobId, "status"] as const,
  feed: (jobId?: string) => ["feed", jobId ?? "all"] as const,
  allowance: ["allowance"] as const,
};

/** Session identity. Returns null (not an error) when unauthenticated, so callers branch on data. */
export function useAuthMe(): UseQueryResult<AuthMe | null> {
  return useQuery({
    queryKey: queryKeys.authMe,
    queryFn: async () => {
      try {
        return await apiGet("/auth/me", authMeSchema, "auth me");
      } catch (err) {
        if (err instanceof ApiClientError && err.isUnauthorized) return null;
        throw err;
      }
    },
    staleTime: 30_000,
  });
}

/** Integration readiness → drives dual-mode. Authed endpoint: 401 (no session) resolves to null. */
export function useIntegrationsHealth(): UseQueryResult<IntegrationsHealth | null> {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: async () => {
      try {
        return await apiGet("/health/integrations", integrationsHealthSchema, "integrations health");
      } catch (err) {
        // 401 (locked) or 503 (degraded body) both answer "not fully live" without throwing the UI.
        if (err instanceof ApiClientError && (err.isUnauthorized || err.isDegraded)) return null;
        throw err;
      }
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

export function useMyJobs(enabled = true): UseQueryResult<MyJob[]> {
  return useQuery({
    queryKey: queryKeys.myJobs,
    queryFn: () => apiGet("/jobs/mine", z.array(myJobSchema), "my jobs"),
    enabled,
  });
}

/** Chain-authoritative job read. `pollUntil` keeps refetching until it returns true (post-track). */
export function useJob(
  id: string | undefined,
  pollUntil?: (j: JobView) => boolean,
): UseQueryResult<JobView> {
  return useQuery({
    queryKey: queryKeys.job(id ?? ""),
    queryFn: () => apiGet(`/jobs/${id}`, jobViewSchema, "job"),
    enabled: !!id,
    refetchInterval: pollUntil
      ? (query) => (query.state.data && pollUntil(query.state.data) ? false : 2_000)
      : false,
  });
}

export function useTopProviders(): UseQueryResult<ProviderPerformance[]> {
  return useQuery({
    queryKey: queryKeys.topProviders,
    queryFn: () => apiGet("/jobs/providers", z.array(providerPerformanceSchema), "top providers"),
  });
}

/** Provider reputation (Graph-authoritative). 404 = no indexed history yet → resolves to null. */
export function useProviderPerformance(
  address: string | undefined,
): UseQueryResult<ProviderPerformance | null> {
  return useQuery({
    queryKey: queryKeys.provider(address ?? ""),
    queryFn: async () => {
      try {
        return await apiGet(
          `/providers/${address}/performance`,
          providerPerformanceSchema,
          "provider performance",
        );
      } catch (err) {
        if (err instanceof ApiClientError && err.isNotFound) return null;
        throw err;
      }
    },
    enabled: !!address,
  });
}

/** Claim + CRE verdict status. `poll` enables 3s polling until a terminal status is reached. */
export function useClaimStatus(
  jobId: string | undefined,
  poll = false,
): UseQueryResult<ClaimStatusView> {
  return useQuery({
    queryKey: queryKeys.claimStatus(jobId ?? ""),
    queryFn: () => apiGet(`/claims/${jobId}/status`, claimStatusViewSchema, "claim status"),
    enabled: !!jobId,
    refetchInterval: poll
      ? (query) =>
          query.state.data && query.state.data.status !== "PENDING" ? false : 3_000
      : false,
  });
}

export function useFeed(jobId?: string, enabled = true): UseQueryResult<FeedItem[]> {
  const qs = jobId ? `?jobId=${encodeURIComponent(jobId)}` : "";
  return useQuery({
    queryKey: queryKeys.feed(jobId),
    queryFn: () => apiGet(`/feed${qs}`, z.array(feedItemSchema), "feed"),
    enabled,
  });
}

export function useAllowance(enabled = true): UseQueryResult<AllowanceView> {
  return useQuery({
    queryKey: queryKeys.allowance,
    queryFn: () => apiGet("/allowance", allowanceViewSchema, "allowance"),
    enabled,
  });
}
