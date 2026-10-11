"use client";

import { useState, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { getQueryClient } from "../lib/query";

/**
 * Landing providers. The marketing site is wallet-free — it only reads public integration-health and
 * top-provider data from the API — so it carries a `QueryClient` and nothing else. No wagmi / RainbowKit
 * / SIWE here (that lives in the gated dApp, `apps/web`), which keeps the landing bundle free of web3.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => getQueryClient());
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
