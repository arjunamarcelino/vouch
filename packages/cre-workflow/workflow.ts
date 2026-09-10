/**
 * Vouch — Chainlink CRE Confidential Workflow (SCAFFOLD)
 * =====================================================
 *
 * This file is an HONEST scaffold. It does NOT fake regression results and it
 * does NOT yet execute a real confidential run. To go live it MUST be wired to
 * the real Chainlink CRE SDK:
 *
 *   - TypeScript path (recommended): `@chainlink/cre-sdk` `ConfidentialHTTPClient`
 *     inside a normal `handler`, with the credential injected INSIDE the enclave
 *     via Vault DON secret templating (`{{.token}}`). There is NO `handlerInTee`
 *     / `TeeRuntime` / `usingTheDons` symbol in the TS SDK — do not write those.
 *   - Go path (only if the prize hard-requires the symbol): `cre.HandlerInTee`
 *     exists in the Go SDK. Keep the rest of the repo in TS. (plan §17.2, §17.11)
 *
 * We intentionally do NOT import `@chainlink/cre-sdk` here: the exact package
 * version and its `.d.ts` shapes are unconfirmed (plan §17.2, §17.11), and an
 * unresolved import would break `tsc --noEmit`. The confidential runtime is
 * therefore represented by a thin local `CreRuntime` adapter that throws until
 * the real SDK is installed and wired. The genuinely testable, SDK-independent
 * logic — the ABI encoding of the verdict payload the AssuranceHub receiver
 * decodes — lives in `buildVerdictPayload` below and is fully exercised.
 *
 * CONFIDENTIALITY INVARIANT (plan §11, §17.6-H3): private regression tests,
 * repo credentials, and pass/fail thresholds are NEVER inlined in this source.
 * They are released by the Vault DON at runtime (`.env` only for local
 * `cre workflow simulate`) and processed inside the enclave. Only the minimal
 * verdict {jobId, regressed, amount} crosses back to the DON for the signed
 * report.
 */

import { encodeAbiParameters } from "viem";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Config schema (non-secret). Mirrors config.staging.json. (plan §17.2)
// ---------------------------------------------------------------------------
export const configSchema = z.object({
  /** Cron expression for the CRE Cron trigger, e.g. "0 0 * * *". */
  schedule: z.string(),
  /** CRE chain-selector NAME for the settlement chain. Arc value TBD — resolve
   *  via getNetwork() at build; confirm the Arc string (plan §17.2 Unresolved). */
  chainSelectorName: z.string(),
  /** AssuranceHub receiver address on Arc that decodes the verdict report. */
  consumerAddress: z.string(),
  /** Gas limit for EVMClient.writeReport, as a decimal string. */
  gasLimit: z.string(),
  /** Owner scope for the Vault DON secret lookup (e.g. the repo owner/org). */
  repoOwner: z.string(),
  /** URL of the private test/coverage artifact fetched confidentially. */
  testArtifactUrl: z.string(),
});

export type Config = z.infer<typeof configSchema>;

// ---------------------------------------------------------------------------
// Verdict payload — the REAL onchain contract. AssuranceHub's onReport receiver
// abi-decodes exactly this report: abi.encode(uint256 jobId, bool covered,
// uint256 amount). `covered` is the confidential regression verdict; the
// contract caps `amount` at the job's guaranteeAmount. onReport itself is gated
// by the forwarder plus packed Keystone metadata
// (bytes32 workflowId | bytes10 workflowName | address owner). This encoding is
// SDK-independent and fully testable. (plan §17.2, §19 D7)
// ---------------------------------------------------------------------------
export const VerdictParams = [
  { name: "jobId", type: "uint256" },
  { name: "regressed", type: "bool" },
  { name: "amount", type: "uint256" },
] as const;

/**
 * Encode the minimal verdict tuple the AssuranceHub receiver decodes.
 *
 * @param jobId     the coverage/job identifier
 * @param regressed true if the private regression test detected a regression
 * @param amount    payout amount (the contract caps this; pass 0n to defer to
 *                  the contract cap, per §17.2)
 * @returns ABI-encoded `0x`-prefixed hex payload
 */
export function buildVerdictPayload(
  jobId: bigint,
  regressed: boolean,
  amount: bigint,
): `0x${string}` {
  return encodeAbiParameters(VerdictParams, [jobId, regressed, amount]);
}

// ---------------------------------------------------------------------------
// Thin local CRE runtime adapter.
//
// This is a PLACEHOLDER stand-in for the real `@chainlink/cre-sdk` runtime so
// this package typechecks without importing an unpinned SDK. Replace it with
// the real SDK types/values when wiring the confidential flow (see TODO below).
// ---------------------------------------------------------------------------
interface CreRuntime {
  readonly config: Config;
  /** Confidential HTTP + report + writeReport happen through the real runtime. */
  runConfidentialVerdict(): Promise<`0x${string}` | "clean" | "inconclusive">;
}

/**
 * Guarded factory for the confidential runtime. Throws until the real CRE SDK
 * is installed and wired — we never fabricate a runtime or a verdict.
 */
export function createCreRuntime(_config: Config): CreRuntime {
  throw new Error(
    "CRE runtime not wired — install @chainlink/cre-sdk and implement the " +
      "confidential handler (ConfidentialHTTPClient + Vault DON secrets). " +
      "See README / plan §17.2.",
  );
}

// ===========================================================================
// TODO — INTENDED CONFIDENTIAL FLOW (wire to @chainlink/cre-sdk; plan §17.2)
// ===========================================================================
//
// Once @chainlink/cre-sdk is pinned, delete the CreRuntime adapter above and
// implement the handler below verbatim from §17.2. Sketch:
//
//   import {
//     CronCapability, ConfidentialHTTPClient, handler, Runner, ok, json,
//     hexToBase64, prepareReportRequest, EVMClient, getNetwork, bytesToHex,
//     TxStatus, type Runtime,
//   } from "@chainlink/cre-sdk";
//
//   const onTick = (runtime: Runtime<Config>): string => {
//     // Confidential: token injected INSIDE the enclave via {{.token}}; the
//     // credential never touches node memory, code, or logs. (§17.6-H3)
//     const res = new ConfidentialHTTPClient().sendRequest(runtime, {
//       request: {
//         url: runtime.config.testArtifactUrl,
//         method: "GET",
//         multiHeaders: { Authorization: { values: ["Bearer {{.token}}"] } },
//       },
//       vaultDonSecrets: [{ key: "token", owner: runtime.config.repoOwner }],
//     }).result();
//     if (!ok(res)) return "inconclusive"; // no report on failure — never "passed"
//
//     // PRIVATE_TEST_REF / PASS_THRESHOLD come from the Vault DON at runtime
//     // (getSecrets), NEVER inlined here (§17.6-H3).
//     const { passRate, threshold, jobId } = json(res) as {
//       passRate: number; threshold: number; jobId: string;
//     };
//     const regressed = passRate < threshold;
//     if (!regressed) return "clean"; // no payout report; provider reclaims later
//
//     const payload = buildVerdictPayload(BigInt(jobId), true, 0n /* contract caps */);
//     const report = runtime
//       .report(prepareReportRequest(hexToBase64(payload)))
//       .result();
//     const net = getNetwork({
//       chainFamily: "evm",
//       chainSelectorName: runtime.config.chainSelectorName,
//     });
//     if (!net) throw new Error("Arc chainSelectorName unresolved"); // fail loud
//     const w = new EVMClient(net.chainSelector.selector)
//       .writeReport(runtime, {
//         receiver: runtime.config.consumerAddress,
//         report,
//         gasConfig: { gasLimit: runtime.config.gasLimit },
//       })
//       .result();
//     if (w.txStatus !== TxStatus.SUCCESS) throw new Error("writeReport failed");
//     return bytesToHex(w.txHash ?? new Uint8Array(32));
//   };
//
//   const initWorkflow = (c: Config) => [
//     handler(new CronCapability().trigger({ schedule: c.schedule }), onTick),
//   ];
//
//   export async function main() {
//     await (await Runner.newRunner<Config>({ configSchema })).run(initWorkflow);
//   }
//   main();
//
// ===========================================================================
