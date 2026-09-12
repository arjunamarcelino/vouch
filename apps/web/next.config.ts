import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Source-exported workspace packages must be transpiled by Next (plan §17.7-11).
  transpilePackages: ["@vouch/ui", "@vouch/shared"],
  // RainbowKit's connector graph statically references the Base Account / Coinbase Smart Wallet SDK
  // (`@base-org/account` → `@coinbase/cdp-sdk`), which imports optional `@x402/*` payment plugins we do
  // not install — breaking the Turbopack server bundle. We don't use that connector (curated list is
  // injected + WalletConnect), so keep these SDKs out of the server bundle; they're lazy-loaded only if
  // their connector is ever instantiated, which we never do.
  serverExternalPackages: ["@coinbase/cdp-sdk", "@base-org/account"],
  // Don't emit Next's auto-generated AGENTS.md / CLAUDE.md — this repo intentionally keeps none.
  agentRules: false,
};

export default nextConfig;
