"use client";

import { useState, type ReactNode } from "react";
import { WagmiProvider, type State } from "wagmi";
import { QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, lightTheme, darkTheme } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import { getConfig } from "../lib/wagmi";
import { getQueryClient } from "../lib/query";

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
        <RainbowKitProvider theme={rainbowTheme} modalSize="compact">
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
