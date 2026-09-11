import { QueryClient, defaultShouldDehydrateQuery, isServer } from "@tanstack/react-query";

/**
 * TanStack Query v5 client for the App Router (plan §RI-4). A fresh client per request on the server
 * (never shared across requests/users) and a single reused client in the browser. `staleTime > 0` so
 * the client doesn't immediately refetch right after hydration. `shouldDehydrateQuery` also ships
 * still-`pending` queries so server-prefetched reads stream in.
 */
function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 60_000, retry: 2 },
      dehydrate: {
        shouldDehydrateQuery: (q) =>
          defaultShouldDehydrateQuery(q) || q.state.status === "pending",
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

export function getQueryClient(): QueryClient {
  if (isServer) return makeQueryClient();
  return (browserQueryClient ??= makeQueryClient());
}
