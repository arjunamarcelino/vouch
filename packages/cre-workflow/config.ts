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
import { isAddress, zeroAddress } from "viem";

const ZERO_BYTES32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

// Non-zero refinements: a forgotten `0x0…0` placeholder must fail LOUD at startup
// rather than ship (a zero receiver/workflowId produces degraded provenance and
// guaranteed reverts). (todo 046)
const hexAddress = z
  .string()
  .refine((s): s is `0x${string}` => isAddress(s) && s !== zeroAddress, {
    message: "must be a valid non-zero EVM address",
  });

const bytes32 = z
  .string()
  .refine(
    (s): s is `0x${string}` =>
      /^0x[0-9a-fA-F]{64}$/.test(s) && s.toLowerCase() !== ZERO_BYTES32,
    { message: "must be a non-zero 0x-prefixed 32-byte hex string" },
  );

const positiveIntString = z
  .string()
  .regex(/^[1-9][0-9]*$/, { message: "must be a positive integer string" });

export const configSchema = z.object({
  /** CRE chain-selector NAME for the settlement chain (Circle Arc testnet). */
  chainSelectorName: z.literal("arc-testnet"),
  /** `block.chainid` of the settlement chain — the domain field bound in the
   *  report (anti cross-chain replay). Decimal string. */
  chainId: positiveIntString,
  /** The single AssuranceHub address — used for the log-trigger watch, the
   *  `getJob` read, the report `hub` domain field, AND the `writeReport`
   *  receiver. One field so those can never silently diverge (todo 046). */
  assuranceHubAddress: hexAddress,
  /** Vault DON secret-owner scope for the confidential fetch credential. */
  owner: hexAddress,
  /** Gas limit for `writeReport`, as a positive-int decimal string. */
  gasLimit: positiveIntString,
  /** The confidential test-API endpoint. The Vault-DON credential is injected via `{{.token}}` and
   *  sent to THIS host, so it MUST be https — an `http://` typo would ship the live token in the
   *  clear. NOT `z.string().url()`: the CRE javy/WASM runtime's zod rejects the `.url()` refinement
   *  for EVERY value ("Invalid url"), which blocks `cre workflow simulate` (verified 2026-09-13). A
   *  `.refine(startsWith("https://"))` DOES survive the WASM runtime, so it restores — and exceeds —
   *  the scheme guarantee `.url()` never actually enforced (it accepts http://). */
  testApiUrl: z
    .string()
    .trim()
    .min(1)
    .refine((s) => s.startsWith("https://"), {
      message: "testApiUrl must be an https:// URL (the Vault credential is sent to this host)",
    }),
  /** The pinned Keystone workflow identifier, bound in the commitment. */
  workflowId: bytes32,
});

/** Known settlement chains: `chainSelectorName` → the chain's `block.chainid`.
 *  Lets us catch a `chainId` typo at parse time (fail loud) rather than at the
 *  first settlement (where the onchain domain check would revert). (todo 046) */
const EXPECTED_CHAIN_ID: Record<string, string> = {
  "arc-testnet": "5042002",
};

export const configWithChainCheck = configSchema.refine(
  (c) => EXPECTED_CHAIN_ID[c.chainSelectorName] === c.chainId,
  {
    message: "chainId must equal the block.chainid of chainSelectorName (arc-testnet = 5042002)",
    path: ["chainId"],
  },
);

export type Config = z.infer<typeof configSchema>;
/** The pre-validation input shape (used to parametrize `Runner.newRunner`). */
export type ConfigInput = z.input<typeof configSchema>;
