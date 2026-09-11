import { keccak256, toBytes } from "viem";

/**
 * Canonical, order-preserving hash of a call's arguments. Prepare stamps it on the PreparedIntent;
 * track recomputes it from the mined tx's decoded args and compares (the TX_MISMATCH gate). Both sides
 * MUST use this one function so a "signed different calldata" attempt is caught. Addresses/hex are
 * lowercased (viem may return either case), bigints are exact.
 */
export function hashCallArgs(args: readonly unknown[]): string {
  const canonical = args
    .map((a) => {
      if (typeof a === "bigint") return `i:${a.toString()}`;
      if (typeof a === "boolean") return `x:${a ? 1 : 0}`;
      if (typeof a === "string") return `s:${a.toLowerCase()}`;
      // No preparable function takes array/tuple/struct args today. Rather than stringify an unexpected
      // kind ambiguously (which would silently WEAKEN the TX_MISMATCH gate), fail loud — review 070.
      throw new Error(`hashCallArgs: unsupported arg kind ${typeof a} (${String(a)})`);
    })
    .join("|");
  return keccak256(toBytes(canonical));
}
