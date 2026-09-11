---
title: "Wiring a Chainlink CRE Confidential Workflow in TypeScript (@chainlink/cre-sdk@1.20.1)"
category: integration-issues
tags: [chainlink, cre, cre-sdk, confidential-workflow, handlerInTee, tee, zod, viem, wasm, arc]
module: packages/cre-workflow
symptom: "Wiring the CRE confidential workflow kept hitting walls: the repo's own ADR said the TS SDK has no handlerInTee (implying a Go rewrite); the report double-encoded; tsc broke on zod and on node:fs; and it was unclear which runtime methods route inside vs outside the enclave."
root_cause: "Stale/assumed knowledge of the CRE TypeScript SDK surface. The current SDK (1.20.1) DOES expose handlerInTee/TeeRuntime/reportFromDon, but has several non-obvious contracts (hex-in report payload, zod v3 pin, node:fs typed as never, usingTheDons() for chain I/O) that are only discoverable by reading the installed .d.ts."
date: 2026-09-11
---

# Wiring a Chainlink CRE Confidential Workflow in TypeScript

## Symptom

Turning the `packages/cre-workflow` scaffold into a working confidential workflow that
`handlerInTee` → verdict → DON-signed report → `AssuranceHub.onReport`, repeatedly stalled on
integration unknowns:

- The repo's own `docs/decisions/002-*` claimed the **TS SDK has no `handlerInTee`/`TeeRuntime`**, implying the confidential handler had to be written in Go.
- The report payload came out wrong (double base64-encoded).
- `tsc --noEmit` broke on the zod schema passed to `Runner.newRunner`, and on any `node:fs` usage.
- It was unclear which `runtime` methods execute inside the enclave vs on the DON.

## Why it's subtle

The confidential-workflow SDK surface is **not** what older docs/ADRs (written before the TS SDK
caught up) describe, and several contracts are invisible unless you read the shipped `.d.ts`. A plausible
reading of the stale ADR sends you down a full Go rewrite for no reason.

## Root cause + the verified facts (`@chainlink/cre-sdk@1.20.1`, Sept 2026)

Confirmed by reading `node_modules/@chainlink/cre-sdk/dist/**/*.d.ts` and a green `tsc`/test run:

1. **`handlerInTee` EXISTS in TypeScript.** `handlerInTee(trigger, fn, tees, hooks?)` with
   `fn: (rt: TeeRuntime<C>, trigger) => T`. `TeeRuntime` extends `BaseRuntime + SecretsProvider`
   (`getSecret`/`getSecrets` available in-enclave). The old "TS has no handlerInTee, use Go" ADR is
   **stale** — do not rewrite in Go.
2. **Report generation inside the TEE uses `runtime.reportFromDon(...)`**, NOT `usingTheDons().report(...)`.
3. **`prepareReportRequest(hexPayload)` takes HEX and base64-encodes internally.** Passing
   `hexToBase64(payload)` **double-encodes** → a garbage report. Pass the `0x…` hex straight in.
4. **`zod` must be pinned to v3 (`3.25.76`), the SAME instance the SDK uses.** The SDK depends on zod
   v3; `Runner.newRunner<Config>({ configSchema })` rejects a schema built with a different zod major.
   If the workspace catalog is zod v4, pin zod v3 **locally** in the package and do **not** import any
   workspace package that pulls catalog zod v4 (two-copies mismatch).
5. **The sandbox types `node:fs`/`fs` as `never`** (Javy/QuickJS WASM). A triple-slash
   `restricted-node-modules.d.ts` bleeds this into the whole program, so **read fixtures via JSON module
   imports** (`import x from "./f.json" with { type: "json" }` + `resolveJsonModule`), never `fs`.
6. **`usingTheDons()` for chain I/O inside a TEE handler.** `callContract` / `writeReport` /
   `ConfidentialHTTPClient.sendRequest` are typed for `Runtime<unknown>` (they route OUTSIDE the enclave),
   so call them via `rt.usingTheDons()`. `getSecret` and `reportFromDon` are on `rt` (the `TeeRuntime`) directly.
7. **`TxStatus.SUCCESS`** is the EVM write success member (NOT `TX_STATUS_SUCCESS`, which is only the
   proto wire name). `writeReport` returns `WriteReportReply { txStatus, txHash?: Uint8Array }`.
8. **`tees` accepts the array form** `[{ tee: "nitro", regions: ["us-west-2"] }]` (region validated
   against `NITRO_REGIONS`).
9. **EVM log trigger + read:** `evmClient.logTrigger(logTriggerConfig({ addresses, topics }))`; an indexed
   event arg (e.g. `ClaimOpened.jobId`) arrives in `log.topics[1]`. Reads: `evmClient.callContract(rt, {
   call: encodeCallMsg({ from, to, data }), blockNumber: LAST_FINALIZED_BLOCK_NUMBER })` → decode with viem.
10. **Arc is bundled**: `getNetwork({ chainFamily: "evm", chainSelectorName: "arc-testnet" })` resolves
    (selector `3034092155422581607`) since SDK v1.3.1; it returns falsy for unknown names — guard it.

## Working solution (shape)

```ts
// workflow.ts — the ONLY SDK-coupled file. Pure logic lives behind an EvalPort seam.
handlerInTee<EVMLog, EVMLog, Config, string>(
  evmClient.logTrigger(logTriggerConfig({ addresses: [hub], topics: [[CLAIM_OPENED_TOPIC0]] })),
  (rt, log) => evalInTee(rt, log, evmClient),
  [{ tee: "nitro", regions: ["us-west-2"] }],
);
// inside evalInTee: jobId = hexToBigInt(bytesToHex(log.topics[1]))
//   donRt = rt.usingTheDons()
//   getSecret via rt.getSecret({id}); confidential fetch + callContract + writeReport via donRt
//   report = rt.reportFromDon(prepareReportRequest(hexPayload)).result()   // HEX, no hexToBase64
//   success = w.txStatus === TxStatus.SUCCESS
// main(): await (await Runner.newRunner<Config, ConfigInput>({ configSchema })).run(initWorkflow)
```

Keep the SDK-independent core (encode/decide/commitment/config + an `EvalPort` interface) in separate
files so it unit-tests with `node:test` + plain mocks — the SDK is painful to instantiate under a test
runner, and this also makes a `ConfidentialHTTPClient`-only fallback an adapter swap.

## Prevention

- **Read the installed `.d.ts` before wiring an SDK whose docs/ADRs are older than the package.** Grep
  `dist` for the exact symbol (`handlerInTee`, `reportFromDon`, `TxStatus`, `logTriggerConfig`) rather
  than trusting a repo ADR.
- **Pin the SDK's zod major locally**; add a `//zod` note in `package.json` warning against importing
  workspace packages that carry a different zod.
- **CI grep** for `hexToBase64(` near `prepareReportRequest(` (the double-encode) and for `Date.now(`/
  `Math.random(`/`node:fs` in workflow source (non-deterministic / sandbox-forbidden).
- When an ADR is contradicted by the installed SDK, **amend the ADR** (see `docs/decisions/002-*` "Post-review hardening 2026-09-11") so the next person doesn't repeat the Go detour.

## Cross-references

- Plan: `docs/plans/2026-09-11-feat-confidential-post-completion-evaluation-plan.md` (§2 verified facts, §6 handler).
- Doc: `docs/chainlink-confidential-workflow.md`; ADRs `002` (corrected), `004`, `005`.
- Related: [[subgraph-event-signature-manifest-drift]] (the same PR's ABI/event migration).
- PR #4 (`feat: add confidential post-completion evaluation`).
