import { NotImplementedError } from "@vouch/shared/errors";

/**
 * Circle Agent Stack wallet adapter (USDC on Arc).
 *
 * DECISION (plan §17.8): primary integration is
 * `@circle-fin/developer-controlled-wallets` (declared in package.json) with
 * `@circle-fin/cli` as the headline Agent-Stack narrative surface / fallback.
 *
 * This is an HONEST placeholder — it does NOT fake transactions. The real flow:
 *   const client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
 *   await client.createWalletSet(...); await client.createWallets({ blockchains: ["ARC-TESTNET"], ... });
 *   await client.getWalletTokenBalance({ id });
 *   await client.createTransaction({ walletId, tokenAddress, destinationAddress, amounts, fee, idempotencyKey });
 * Every mutation requires a UUIDv4 idempotencyKey. The wallet must be policy-bound
 * (per-tx + daily caps + destination allowlist) and hold MINIMAL USDC — it quotes
 * and monitors; it NEVER holds or moves settlement funds (that is the CRE→contract path).
 *
 * All amount math uses the 6-decimal ERC-20 USDC interface (not the 18-dec native view).
 */
export interface AgentWalletConfig {
  apiKey: string;
  entitySecret: string;
}

export interface AgentWallet {
  getUsdcBalance(): Promise<string>;
}

export function createAgentWallet(config: Partial<AgentWalletConfig>): AgentWallet {
  if (!config.apiKey || !config.entitySecret) {
    throw new NotImplementedError(
      "Circle Agent Stack wallet not configured (set CIRCLE_API_KEY + CIRCLE_ENTITY_SECRET; see plan §17.8)",
    );
  }
  // Intentionally not wired yet — do not fabricate balances/transfers.
  throw new NotImplementedError(
    "Circle developer-controlled-wallets client wiring (see plan §17.8 for the exact call sequence)",
  );
}
