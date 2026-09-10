import { createHash } from "node:crypto";
import { keccak256, toHex, type Address } from "viem";
import type { PaymentAction } from "@vouch/shared/schemas";

/**
 * Deterministic idempotency + param-drift guard for the payment executor (plan §6.4).
 *
 * The idempotency key is a UUIDv5 derived from immutable business identity (quoteId + action +
 * version), so after a crash it can be RECONSTRUCTED with zero persisted state — the property that
 * closes the crash window. `paramsHash` separately binds amount/destination/token/chainId so a
 * changed amount under the same key is caught before a stale-amount re-submit (data-integrity C2).
 */

// Fixed application namespace UUID (v4) — never change (would fork all keys).
const APP_NAMESPACE = "6f9b1f3e-3c2a-4c1e-9a7d-2b1c0e5f8a44";
export const INTENT_VERSION = "1";

/** RFC 4122 §4.3 name-based UUIDv5 (SHA-1). Circle requires UUID-format idempotency keys. */
export function uuidv5(name: string, namespace = APP_NAMESPACE): string {
  const nsBytes = Buffer.from(namespace.replace(/-/gu, ""), "hex");
  const hash = createHash("sha1").update(nsBytes).update(Buffer.from(name, "utf8")).digest();
  const b = hash.subarray(0, 16);
  b[6] = (b[6]! & 0x0f) | 0x50; // version 5
  b[8] = (b[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export function idempotencyKey(quoteId: string, action: PaymentAction): string {
  return uuidv5(`${quoteId}:${action}:${INTENT_VERSION}`);
}

export interface PaymentParams {
  amount: string; // base-unit integer string
  destination: Address;
  token: Address;
  chainId: number;
}

/** Bind the material payment params so a changed amount/destination is detected on retry (§0.4). */
export function paramsHash(p: PaymentParams): `0x${string}` {
  return keccak256(
    toHex(`${p.amount}:${p.destination.toLowerCase()}:${p.token.toLowerCase()}:${p.chainId}`),
  );
}
