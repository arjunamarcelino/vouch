import { QueryClient, isServer } from "@tanstack/react-query";

/**
 * TanStack Query v5 client for the App Router (plan §RI-4). A fresh client per request on the server
 * (never shared across requests/users) and a single reused client in the browser. `staleTime > 0` so
 * the client doesn't immediately refetch right after hydration. `refetchOnWindowFocus` is disabled —
 * every route is client-rendered and the reputation/list reads change slowly, so tab-refocus refetches
 * are needless churn (freshness for live data comes from the explicit polling hooks). No custom
 * `dehydrate` override: there are no Server-Component prefetches to stream in (every route is
 * `"use client"`), so the default dehydration is correct.
 */
function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 60_000, retry: 2, refetchOnWindowFocus: false },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

export function getQueryClient(): QueryClient {
  if (isServer) return makeQueryClient();
  return (browserQueryClient ??= makeQueryClient());
}
