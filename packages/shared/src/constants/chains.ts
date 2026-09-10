import { defineChain } from "viem";

/**
 * Circle Arc chain definitions.
 *
 * NOTE (plan §17.1): `arcTestnet` is reported to be exported from `viem/chains`.
 * We define it locally with `defineChain` for resilience across viem versions;
 * prefer the built-in export once you confirm it exists in your pinned viem:
 *   import { arcTestnet } from "viem/chains";
 *
 * ⚠️ RPC host conflict: `rpc.testnet.arc.network` (Circle skill) vs
 * `rpc.testnet.arc.io` (docs.arc.io). Confirm before relying on it.
 *
 * ⚠️ USDC on Arc is dual-decimal: 18 decimals for native gas accounting,
 * 6 decimals via the ERC-20 interface — same balance, single asset. All
 * application-level amounts MUST use the 6-decimal ERC-20 interface.
 */
export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.testnet.arc.network"] },
  },
  blockExplorers: {
    default: { name: "Arcscan", url: "https://testnet.arcscan.app" },
  },
  testnet: true,
});

export const arcMainnet = defineChain({
  id: 5042,
  name: "Arc",
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: { http: [""] },
  },
  blockExplorers: {
    default: { name: "Arcscan", url: "https://arcscan.app" },
  },
});

/** USDC ERC-20 (6 decimals) address on Arc. Confirm at docs.arc.io. */
export const USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as const;

/** USDC uses 6 decimals on the ERC-20 interface. */
export const USDC_DECIMALS = 6 as const;

export type ChainEnv = "development" | "arc-testnet" | "arc-mainnet";

export function chainForEnv(env: ChainEnv) {
  switch (env) {
    case "arc-mainnet":
      return arcMainnet;
    case "arc-testnet":
    case "development":
      return arcTestnet;
  }
}
