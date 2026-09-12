/**
 * Public browser env — the ALLOWLIST (security P2.13). Only `NEXT_PUBLIC_*` values ship to the client,
 * and only these: the API base URL, a WalletConnect projectId (public by design), and a read-only RPC
 * override. NEVER put a keyed/authenticated RPC, a subgraph admin key, or any write credential here.
 * Reputation/subgraph data is read through `apps/api` (server-side freshness gate), never direct.
 */

/** Base URL of the NestJS API (`apps/api`). Same-site in prod so the SIWE cookie is first-party. */
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

/** WalletConnect Cloud projectId (public). A placeholder still lets injected wallets connect; the
 * WalletConnect QR option only needs a real id when actually used. */
export const WALLETCONNECT_PROJECT_ID =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "vouch-local-dev";

/** Optional read-only RPC override (unauthenticated only). Falls back to the chain's default. */
export const RPC_URL_OVERRIDE = process.env.NEXT_PUBLIC_ARC_RPC_URL;

/** Join a path onto the API base (single trailing-slash-safe helper — no duplicated trim). */
export function apiUrl(path: string): string {
  return `${API_BASE_URL.replace(/\/$/u, "")}${path}`;
}
