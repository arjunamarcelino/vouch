import { getAddress, type Address } from "viem";

/**
 * App-side spend policy — the PURE pre-check (plan §6.2). Per-tx cap + destination allowlist are
 * pure over their inputs and enforced BEFORE a transfer is constructed. The rolling DAILY cap is
 * enforced atomically in the DB (`quotesRepo.reserveIntent`, advisory-lock + SUM), because a pure
 * check can't be race-free across concurrent intents (security H3 / data-integrity C1).
 *
 * NOTE (security B1): this is DEFENSE-IN-DEPTH only. The authoritative limit is Circle-side spending
 * controls + funding the wallet at/below the daily cap — the entity secret can move funds for the
 * whole entity and bypasses any in-process check. See docs/arc-agent-stack.md.
 */

export interface SpendPolicy {
  perTxCap: bigint;
  /** Checksummed destination allowlist (normalized on construction). */
  allowlist: ReadonlySet<string>;
}

export type PolicyResult =
  | { ok: true }
  | { ok: false; reasonCodes: ("PER_TX_CAP_EXCEEDED" | "DESTINATION_NOT_ALLOWED")[] };

/** Build a policy from raw config; normalizes allowlist addresses to checksum form. */
export function makeSpendPolicy(perTxCap: bigint, allowlist: readonly string[]): SpendPolicy {
  return { perTxCap, allowlist: new Set(allowlist.map((a) => getAddress(a))) };
}

export function checkSpend(policy: SpendPolicy, amount: bigint, destination: Address): PolicyResult {
  const reasonCodes: ("PER_TX_CAP_EXCEEDED" | "DESTINATION_NOT_ALLOWED")[] = [];
  if (amount > policy.perTxCap) reasonCodes.push("PER_TX_CAP_EXCEEDED");
  // Normalize before comparing so a checksum/case difference can't smuggle a non-allowlisted dest.
  if (!policy.allowlist.has(getAddress(destination))) reasonCodes.push("DESTINATION_NOT_ALLOWED");
  return reasonCodes.length === 0 ? { ok: true } : { ok: false, reasonCodes };
}
