/**
 * Verdict payload encoding — the FROZEN 7-tuple the AssuranceHub `onReport`
 * receiver `abi.decode`s. This module is SDK-independent (viem only) so it can
 * be unit-tested without importing `@chainlink/cre-sdk`.
 *
 * Tuple order (must match the Solidity `abi.decode` exactly):
 *   (uint256 chainId, address hub, uint256 jobId, bool covered,
 *    uint256 amount, bytes32 evidenceCommitment, uint64 evaluatedAt)
 *
 * All 7 fields are static, so the encoded length is 7 * 32 = 224 bytes.
 * Encoded with `encodeAbiParameters` (NOT `encodePacked`).
 */
import { bytesToHex, encodeAbiParameters, hexToBigInt, size } from "viem";
import type { AbiParameter } from "viem";

/** The frozen 7-tuple ABI parameter list (encode order is load-bearing). */
export const VERDICT_ABI_PARAMS = [
  { name: "chainId", type: "uint256" },
  { name: "hub", type: "address" },
  { name: "jobId", type: "uint256" },
  { name: "covered", type: "bool" },
  { name: "amount", type: "uint256" },
  { name: "evidenceCommitment", type: "bytes32" },
  { name: "evaluatedAt", type: "uint64" },
] as const satisfies readonly AbiParameter[];

/** Encoded length of the (static) 7-tuple, in bytes. */
export const VERDICT_PAYLOAD_BYTES = 224;

/**
 * Named-params verdict payload. Named (not positional) to defeat argument
 * transposition — the tuple has three interchangeable bigints and two bytes32.
 */
export interface VerdictPayload {
  readonly chainId: bigint;
  readonly hub: `0x${string}`;
  readonly jobId: bigint;
  readonly covered: boolean;
  readonly amount: bigint;
  readonly evidenceCommitment: `0x${string}`;
  readonly evaluatedAt: bigint;
}

/**
 * Guard that a hex string is exactly 32 bytes. viem's `0x${string}` type does
 * NOT length-check, so this asserts at the encode seam. Returns the input for
 * fluent use; throws otherwise.
 */
export function assertBytes32(hex: `0x${string}`): `0x${string}` {
  const n = size(hex);
  if (n !== 32) {
    throw new Error(`expected a 32-byte hex value, received ${n} bytes`);
  }
  return hex;
}

/**
 * Derive the `jobId` from a `ClaimOpened` log's indexed `topics[1]` (a 32-byte
 * word). Pure + SDK-independent so the derivation is unit-testable without a
 * runtime (todo 050). The workflow adapter passes `log.topics[1]`.
 */
export function jobIdFromTopic(topic: Uint8Array): bigint {
  return hexToBigInt(bytesToHex(topic));
}

/** Build the ABI-encoded positional verdict tuple from named fields. */
export function buildVerdictPayload(p: VerdictPayload): `0x${string}` {
  assertBytes32(p.evidenceCommitment);
  return encodeAbiParameters(VERDICT_ABI_PARAMS, [
    p.chainId,
    p.hub,
    p.jobId,
    p.covered,
    p.amount,
    p.evidenceCommitment,
    p.evaluatedAt,
  ]);
}
