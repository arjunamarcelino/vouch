---
title: "Wiring wagmi v2 + RainbowKit (SIWE) on Next.js 16 App Router with SSR cookie hydration — four sequential build failures"
category: integration-issues
tags: [nextjs, nextjs-16, app-router, turbopack, wagmi, wagmi-v2, rainbowkit, viem, walletconnect, coinbase, x402, ssr, cookieToInitialState, siwe, server-components, typescript, ts2742, pnpm, monorepo]
module: apps/web
symptom: "Standing up the wallet layer in apps/web (Next.js 16 + Turbopack) with wagmi + RainbowKit + SSR cookie hydration fails in FOUR distinct ways, one after the next: (1) `next build` → `Module not found: Can't resolve '@x402/core/client'` (and `@x402/evm`, `@x402/svm/*`) in a Client-Component-SSR import trace rooted at @rainbow-me/rainbowkit → @wagmi/connectors/baseAccount → @base-org/account → @coinbase/cdp-sdk; (2) `Attempted to call connectorsForWallets()/getDefaultConfig() from the server but it is on the client`; (3) `ReferenceError: indexedDB is not defined` + `WalletConnect Core is already initialized ... Init() was called 2 times` during page-data collection; (4) TS2742 `The inferred type of 'getConfig' cannot be named without a reference to '.../@walletconnect/ethereum-provider'. This is likely not portable.`"
severity: high
date: 2026-09-12
---

# wagmi v2 + RainbowKit + Next.js 16 SSR: the four-failure gauntlet

## Symptom

Building `apps/web` (Next.js **16**, Turbopack, React 19) with a standard wagmi + RainbowKit + SIWE
setup that hydrates the wallet from a cookie (the documented `cookieToInitialState` pattern) does **not**
work out of the box. Each fix uncovers the next failure, in this order:

1. `Module not found: Can't resolve '@x402/core/client'` (also `@x402/evm`, `@x402/evm/exact/client`,
   `@x402/svm/exact/client`) — 8 errors, in a **Client Component SSR** import trace:
   `app/providers.tsx → @rainbow-me/rainbowkit → @wagmi/connectors/baseAccount.js → @base-org/account → @coinbase/cdp-sdk@1.55.0`.
2. `Attempted to call connectorsForWallets() from the server but connectorsForWallets is on the client.`
   — and, after switching to `getDefaultConfig`, the same for `getDefaultConfig()`.
3. During "Generating static pages": `ReferenceError: indexedDB is not defined` from
   `@walletconnect/ethereum-provider`, plus `WalletConnect Core is already initialized ... Init() was
   called 2 times`.
4. `error TS2742: The inferred type of 'getConfig' cannot be named without a reference to
   '.pnpm/@walletconnect+ethereum-provider.../node_modules/@walletconnect/ethereum-provider'. This is
   likely not portable. A type annotation is necessary.`

## Root cause

- **(1) Optional sub-deps of the Base/Coinbase connector.** RainbowKit's entry eagerly references the
  Base Account / Coinbase Smart Wallet connector (`@wagmi/connectors/baseAccount` → `@base-org/account` →
  `@coinbase/cdp-sdk@1.55.0`). That SDK `import`s optional `@x402/*` payment plugins that are **not
  installed**; Turbopack's server bundle for client components tries to resolve them at build time and
  fails. You hit this even if you never use that connector.
- **(2) `getDefaultConfig` / `connectorsForWallets` are client-only in RainbowKit 2.2.x.** They are
  marked with the React Server Components "client-only" poison, so calling them from the **Server
  Component** root layout (which the wagmi SSR pattern requires, to compute `cookieToInitialState`)
  throws at build/runtime.
- **(3) The WalletConnect connector needs browser globals at construction.** `walletConnect(...)`
  eagerly initializes WalletConnect Core (which touches `indexedDB`) when the wagmi config is created —
  and the config is created on the server (per-request) for SSR hydration, where `indexedDB` doesn't
  exist. The double-`Init()` warning is the same config being built on server and client.
- **(4) Non-portable inferred type.** `createConfig(...)`'s return type transitively names a type from a
  pnpm-hashed `@walletconnect/...` path; TypeScript (with `declaration`/composite-style portability
  checks) can't emit a portable name for it.

**Meta-cause:** RainbowKit 2.2.11 peer-requires **wagmi `^2.9` + viem `2.x`** — NOT wagmi v3 (which is
now the `latest` tag). Installing "latest wagmi" silently pulls v3 and breaks RainbowKit.

## Solution

Pin the versions, keep the wallet config **server-safe and minimal**, and theme RainbowKit over it.

1. **Pin wagmi v2 (RainbowKit's peer):**
   ```jsonc
   // apps/web/package.json
   "@rainbow-me/rainbowkit": "^2.2.11",
   "@tanstack/react-query": "^5.102.8",
   "wagmi": "^2.19.5",          // NOT ^3 — RainbowKit 2.x requires wagmi ^2.9 + viem 2.x
   "viem": "catalog:"           // ^2.x
   ```

2. **Keep the Base/Coinbase + x402 SDKs out of the server bundle:**
   ```ts
   // apps/web/next.config.ts
   const nextConfig: NextConfig = {
     transpilePackages: ["@vouch/ui", "@vouch/shared"],
     serverExternalPackages: ["@coinbase/cdp-sdk", "@base-org/account"],
   };
   ```
   `serverExternalPackages` stops Turbopack from resolving their optional `@x402/*` imports at build
   time; they're never instantiated (we don't use that connector).

3. **Build the wagmi config with plain, isomorphic connectors — not `getDefaultConfig`/`connectorsForWallets`** — so `getConfig()` is safe to call from the Server Component layout, and annotate the return type:
   ```ts
   // apps/web/lib/wagmi.ts
   import { http, cookieStorage, createStorage, createConfig, type Config } from "wagmi";
   import { injected } from "wagmi/connectors";            // isomorphic; no browser globals at config time
   import { arcTestnet } from "@vouch/shared/chains";

   export function getConfig(): Config {                    // explicit annotation fixes TS2742
     return createConfig({
       chains: [arcTestnet],
       connectors: [injected()],                            // drop walletConnect() — it eager-inits indexedDB on SSR
       ssr: true,
       storage: createStorage({ storage: cookieStorage }),  // mandatory for hydration without a flash
       transports: { [arcTestnet.id]: http() },
     });
   }
   ```
   RainbowKit's `<RainbowKitProvider>` (a client component) still renders its connect modal over whatever
   connectors this config exposes — you don't need `getDefaultConfig` to use RainbowKit.

4. **SSR hydration (Next 16 `headers()` is async):**
   ```tsx
   // app/layout.tsx (Server Component)
   const initialState = cookieToInitialState(getConfig(), (await headers()).get("cookie"));
   // <Providers initialState={initialState}>… (WagmiProvider must be a "use client" child)
   ```

5. **Custom SIWE without next-auth** — `createAuthenticationAdapter` wired to your own
   `/auth/nonce|verify|logout` with `credentials: "include"` on every fetch; drive
   `<RainbowKitAuthenticationProvider status={…}>` from a `/auth/me` query. Annotate the adapter factory
   return as `ReturnType<typeof createAuthenticationAdapter<string>>` (same TS2742 class of fix).

Result: `next build` exits 0, SSR renders with no `indexedDB`/WalletConnect errors, and the connect +
SIWE flow works with MetaMask/injected wallets.

## How to recognize it fast

- `next build` fails with **`Module not found`** for a package you never imported, in a **Client
  Component SSR** trace rooted at a wallet library → a connector is pulling optional sub-deps →
  `serverExternalPackages`.
- **`… is on the client`** at build → a RainbowKit helper (`getDefaultConfig`/`connectorsForWallets`) is
  being called from a Server Component → build the config with plain wagmi `createConfig` instead.
- **`indexedDB is not defined`** during page-data collection → a connector (WalletConnect) initializes
  browser-only state at config-creation time → drop it or lazy-init it; `injected()` is safe.
- **TS2742 "cannot be named … not portable"** on a config/adapter factory → add an explicit return-type
  annotation (`Config`, `ReturnType<typeof createAuthenticationAdapter<string>>`).

## Prevention

- When adding a web3 wallet stack, **check the connect-library's peer deps first** (`pnpm view
  @rainbow-me/rainbowkit peerDependencies`) and pin to satisfy them — don't assume `latest` of wagmi/viem.
- Treat the wagmi config factory as **isomorphic**: no browser globals, no client-only imports, explicit
  return type. It runs on the server for SSR hydration.
- Prefer the **narrowest connector set** that the demo needs (`injected()` covers MetaMask) — fewer
  connectors = fewer transitive SSR landmines. Add WalletConnect only behind a client-only/lazy path.
- Keep `serverExternalPackages` for heavy wallet SDKs that ship optional/native sub-deps.

## Related

- [[chainlink-cre-ts-sdk-confidential-workflow-wiring]] — another "the SDK's real surface differs from
  the docs" integration gotcha (hex vs base64, zod v3 pin).
- [[react-tanstack-tx-engine-correctness]] — correctness gotchas in the transaction engine built on top
  of this wallet layer.
- PR #6 (`feat: build outcome assurance product experience`), `apps/web/lib/wagmi.ts`,
  `apps/web/app/{providers,layout}.tsx`, `apps/web/next.config.ts`.
