import { http, cookieStorage, createStorage, createConfig, type Config } from "wagmi";
import { injected } from "wagmi/connectors";
import { arcTestnet, arcMainnet } from "@vouch/shared/chains";
import { API_BASE_URL, RPC_URL_OVERRIDE, activeChain } from "./env";

/**
 * wagmi config for the Arc dApp (chain selected by CHAIN_ENV via `activeChain`). `ssr: true` +
 * `cookieStorage` is MANDATORY for App-Router
 * hydration without a flash/mismatch (plan §RI-1) — the Server-Component layout reads the cookie into
 * `initialState`, so `getConfig()` MUST be server-safe and is called per-request on the server and once
 * in the browser.
 *
 * We build the config with a plain, isomorphic wagmi connector (`injected`) rather than RainbowKit's
 * `getDefaultConfig`/`connectorsForWallets`: in RainbowKit 2.2.x both are marked client-only and throw
 * when invoked from the Server Component layout. `RainbowKitProvider` (a client component) still themes
 * the connect modal over whatever connectors this config exposes. We use `injected` only (MetaMask /
 * browser wallet): it needs no browser globals at config-creation time, so it is safe in the SSR layout —
 * the WalletConnect connector eagerly initializes WalletConnect Core (needs `indexedDB`) and throws during
 * SSR. This also avoids the Base/Coinbase connector's optional `@x402/*` deps entirely.
 *
 * NOTE: RainbowKit 2.x peer-requires wagmi v2 + viem 2.x (NOT wagmi v3) — the stack is pinned to match.
 * The single Arc chain definition lives in `@vouch/shared/chains`; we never re-`defineChain` here.
 */
export function getConfig(): Config {
  // Only `activeChain` is registered, but the chain type is a union (arcTestnet | arcMainnet), so wagmi's
  // transports Record is keyed by both ids — point both at the one active transport to satisfy the type.
  const transport = http(RPC_URL_OVERRIDE ?? activeChain.rpcUrls.default.http[0]);
  return createConfig({
    chains: [activeChain],
    connectors: [injected()],
    ssr: true,
    storage: createStorage({ storage: cookieStorage }),
    transports: {
      [arcTestnet.id]: transport,
      [arcMainnet.id]: transport,
    },
  });
}

export { API_BASE_URL };
