/**
 * Non-secret workflow config schema. Mirrors `config.staging.json`.
 *
 * NO secrets, NO thresholds, NO test criteria — those come from the Vault DON at
 * runtime. NO defaults on security-relevant fields: config is our own input, so
 * it is parsed with `parse` (fail LOUD), not fail-closed.
 *
 * zod is imported from "zod" (pinned v3, 3.25.76 — the same instance the CRE
 * SDK's Runner/config schema use).
 */
import { z } from "zod";
import { isAddress } from "viem";

const hexAddress = z
  .string()
  .refine((s): s is `0x${string}` => isAddress(s), {
    message: "must be a valid EVM address",
  });

const bytes32 = z
  .string()
  .refine((s): s is `0x${string}` => /^0x[0-9a-fA-F]{64}$/.test(s), {
    message: "must be a 0x-prefixed 32-byte hex string",
  });

const positiveIntString = z
  .string()
  .regex(/^[1-9][0-9]*$/, { message: "must be a positive integer string" });

export const configSchema = z.object({
  /** CRE chain-selector NAME for the settlement chain (Circle Arc testnet). */
  chainSelectorName: z.literal("arc-testnet"),
  /** `block.chainid` of the settlement chain — the domain field bound in the
   *  report (anti cross-chain replay). Decimal string. */
  chainId: positiveIntString,
  /** The writeReport receiver (the AssuranceHub that decodes the report). */
  consumerAddress: hexAddress,
  /** The AssuranceHub contract to watch (log trigger) and read (`getJob`). */
  contractAddress: hexAddress,
  /** Vault DON secret-owner scope for the confidential fetch credential. */
  owner: hexAddress,
  /** Gas limit for `writeReport`, as a positive-int decimal string. */
  gasLimit: positiveIntString,
  /** The confidential test-API endpoint (credential injected via `{{.token}}`). */
  testApiUrl: z.string().url(),
  /** The pinned Keystone workflow identifier, bound in the commitment. */
  workflowId: bytes32,
});

export type Config = z.infer<typeof configSchema>;
/** The pre-validation input shape (used to parametrize `Runner.newRunner`). */
export type ConfigInput = z.input<typeof configSchema>;
