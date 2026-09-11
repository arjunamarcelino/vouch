"use client";

import { useMemo, useState, type ReactNode } from "react";
import { WagmiProvider, type State } from "wagmi";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import {
  RainbowKitProvider,
  RainbowKitAuthenticationProvider,
  lightTheme,
  darkTheme,
  type AuthenticationStatus,
} from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import { getConfig } from "../lib/wagmi";
import { getQueryClient } from "../lib/query";
import { makeAuthAdapter } from "../lib/auth";
import { useAuthMe, queryKeys } from "../lib/api/hooks";

/**
 * Client providers for the wallet-heavy surface. `WagmiProvider` is React Context so it MUST be a
 * client component; the Server-Component layout computes `initialState` from the request cookie and
 * passes it here (plan §RI-1). `config` + `QueryClient` are created via `useState(() => …)` so they are
 * stable across re-renders. RainbowKit is themed to the zinc/blue system (small radius, system font) and
 * auto-switches light/dark with `prefers-color-scheme`; the `{ lightMode, darkMode }` object makes the
 * modal follow the OS without a flash. SIWE auth is layered on in a later unit.
 */
const ACCENT = "#1570d1"; // primary blue (matches --color-primary); RainbowKit wants a concrete color

const rainbowTheme = {
  lightMode: lightTheme({
    accentColor: ACCENT,
    accentColorForeground: "#ffffff",
    borderRadius: "small",
    fontStack: "system",
    overlayBlur: "small",
  }),
  darkMode: darkTheme({
    accentColor: ACCENT,
    accentColorForeground: "#ffffff",
    borderRadius: "small",
    fontStack: "system",
    overlayBlur: "small",
  }),
};

/**
 * SIWE gate: builds the auth adapter (invalidating `/auth/me` on verify/sign-out) and feeds RainbowKit
 * a status derived from the server session — so role-gating and the connect UI follow the httpOnly
 * cookie, never optimistic client state.
 */
function AuthGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const me = useAuthMe();
  const adapter = useMemo(
    () => makeAuthAdapter(() => void queryClient.invalidateQueries({ queryKey: queryKeys.authMe })),
    [queryClient],
  );
  const status: AuthenticationStatus = me.isLoading
    ? "loading"
    : me.data
      ? "authenticated"
      : "unauthenticated";

  return (
    <RainbowKitAuthenticationProvider adapter={adapter} status={status}>
      <RainbowKitProvider theme={rainbowTheme} modalSize="compact">
        {children}
      </RainbowKitProvider>
    </RainbowKitAuthenticationProvider>
  );
}

export function Providers({
  children,
  initialState,
}: {
  children: ReactNode;
  initialState?: State;
}) {
  const [config] = useState(() => getConfig());
  const [queryClient] = useState(() => getQueryClient());

  return (
    <WagmiProvider config={config} initialState={initialState}>
      <QueryClientProvider client={queryClient}>
        <AuthGate>{children}</AuthGate>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
