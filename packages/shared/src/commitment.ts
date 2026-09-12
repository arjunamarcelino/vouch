import { keccak256, toHex, concatHex, type Hex } from "viem";

/**
 * Salted `bytes32` commitment for private material (private acceptance criteria at job creation,
 * evidence at claim time). Lives in `@vouch/shared` — NOT inside a React component — so the web UI and
 * any programmatic agent produce a bit-identical commitment (agent-native parity). Only the commitment
 * is ever submitted on-chain / to the API; the raw preimage and salt never leave the client
 * (commitmentInputSchema enforces the boundary). The scheme is `keccak256(salt ‖ utf8(preimage))`.
 *
 * NOTE: the authoritative opening-JSON scheme the CRE workflow reproduces is defined in
 * docs/chainlink-confidential-workflow.md §7 — align this with it before a live CRE settlement.
 */
export function randomSalt(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

export function computeCommitment(preimage: string, salt: Hex): Hex {
  return keccak256(concatHex([salt, toHex(preimage)]));
}
