/**
 * Public browser env — the ALLOWLIST (security P2.13). Only `NEXT_PUBLIC_*` values ship to the client,
 * and only these: the API base URL, a WalletConnect projectId (public by design), and a read-only RPC
 * override. NEVER put a keyed/authenticated RPC, a subgraph admin key, or any write credential here.
 * Reputation/subgraph data is read through `apps/api` (server-side freshness gate), never direct.
 */
import { chainForEnv, type ChainEnv } from "@vouch/shared/chains";

/** Active chain env — the SINGLE client source for which Arc chain the dApp signs/sends on. Mirrors the
 * api's `CHAIN_ENV` so SIWE chainId + tx chainId match what the api verifies. */
export const CHAIN_ENV = (process.env.NEXT_PUBLIC_CHAIN_ENV ?? "development") as ChainEnv;

/** The active viem chain (arc-mainnet → 5042, else arc-testnet → 5042002). Every wallet/tx/explorer
 * path MUST read this, never a hardcoded chain, so a single env flip moves the whole dApp. */
export const activeChain = chainForEnv(CHAIN_ENV);

/** Base URL of the NestJS API (`apps/api`). Same-site in prod so the SIWE cookie is first-party. */
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

/** WalletConnect Cloud projectId (public). A placeholder still lets injected wallets connect; the
 * WalletConnect QR option only needs a real id when actually used. */
export const WALLETCONNECT_PROJECT_ID =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "vouch-local-dev";

/** Optional read-only RPC override (unauthenticated only). Falls back to the chain's default. */
export const RPC_URL_OVERRIDE = process.env.NEXT_PUBLIC_ARC_RPC_URL;

/** Absolute URL of the marketing site (a SEPARATE deployment — apps/landing). The app's home/demo
 * links point back out here. */
export const LANDING_URL = process.env.NEXT_PUBLIC_LANDING_URL ?? "http://localhost:3003";

/** Join a path onto the API base (single trailing-slash-safe helper — no duplicated trim). */
export function apiUrl(path: string): string {
  return `${API_BASE_URL.replace(/\/$/u, "")}${path}`;
}
