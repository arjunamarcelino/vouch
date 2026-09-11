---
title: "Widening a Solidity event breaks subgraph codegen — subgraph.yaml signature + generator banner must be updated too"
category: build-errors
tags: [subgraph, the-graph, graph-cli, codegen, abi, solidity, events, sync-abis, matchstick]
module: packages/subgraph, packages/contracts
symptom: "After adding two params to a contract event, `graph codegen` failed: 'Event with signature ConfidentialEvaluationResolved(indexed uint256,bool,uint256) not present in ABI AssuranceHub.' The regenerated ABI already had the new params."
root_cause: "The event signature is pinned in THREE places that don't auto-sync: (1) the contract, (2) the hand-written `eventHandlers[].event` string in subgraph.yaml, and (3) a hardcoded doc banner in the ABI generator. Regenerating the ABI updates the entries but not the manifest string or the banner, so codegen matches the manifest's stale signature against the new ABI and fails."
date: 2026-09-11
---

# Widening a Solidity event breaks subgraph codegen (manifest + banner drift)

## Symptom

Adding `bytes32 evidenceCommitment, uint64 evaluatedAt` to `ConfidentialEvaluationResolved`, then
running `pnpm --filter @vouch/subgraph codegen`:

```
✖ Failed to load subgraph from subgraph.yaml: Error in subgraph.yaml:
  Event with signature 'ConfidentialEvaluationResolved(indexed uint256,bool,uint256)'
  not present in ABI 'AssuranceHub'.
```

…even though `abi:sync` had already regenerated `AssuranceHub.json` with the widened event.

## Why it's subtle

The ABI JSON was correct, so the error ("not present in ABI") is misleading — it's the **manifest's**
hand-written signature string that's stale, and graph-cli matches that string against the ABI. Nothing
about running `abi:sync` hints that a *second* hand-maintained copy of the signature exists.

## Root cause

An event signature is duplicated across artifacts that do NOT auto-sync when the contract changes:

1. **The contract** — `AssuranceHub.sol` event declaration (source of truth).
2. **`packages/subgraph/subgraph.yaml`** — `eventHandlers[].event: "ConfidentialEvaluationResolved(indexed uint256,bool,uint256)"` — a hand-written string that must match the ABI byte-for-byte.
3. **`packages/contracts/script/sync-abis.mjs`** — a hardcoded doc **banner** literal describing the report/tuple, emitted into `packages/shared/src/abis/assuranceHub.ts`. `abi:sync` re-emits the stale banner on every run (it "re-drifts").

## Working solution

When you change a contract event/report shape, update ALL of these together:

1. Contract event + `onReport` decode (source of truth), then `forge test`.
2. `pnpm --filter @vouch/contracts abi:sync` → regenerates `shared/src/abis/*.ts` + `subgraph/abis/*.json`.
3. **`subgraph.yaml`** — bump the `eventHandlers[].event` signature string to match the new ABI exactly
   (order + types; `bytes32`/`uint64` etc.):
   ```yaml
   - event: ConfidentialEvaluationResolved(indexed uint256,bool,uint256,bytes32,uint64)
     handler: handleConfidentialEvaluationResolved
   ```
4. **`sync-abis.mjs`** — fix the hardcoded banner literal so the regenerated `assuranceHub.ts` header
   documents the new shape (else it silently misleads the next decoder author).
5. `graph codegen` (regenerates `generated/`), then update the mapping (`event.params.*`), the
   Matchstick `newMockEvent` helper param order + call sites, and `graph test`.

## Prevention

- Treat an event/report signature as a **cross-artifact contract** and change all copies in one commit:
  contract → `abi:sync` → `subgraph.yaml` → generator banner → mapping → matchstick.
- **Match Matchstick sentinels to on-chain reality:** a `bytes32(0)` field decodes to **32 zero bytes**,
  not `Bytes.empty()` — use `Bytes.fromHexString("0x" + "00".repeat(32))` in fixtures.
- Consider a CI check that greps `subgraph.yaml` event signatures against the generated ABI so drift
  fails fast with a clear message (instead of the misleading "not present in ABI").

## Cross-references

- PR #4 (`feat: add confidential post-completion evaluation`); commit `feat(contracts,subgraph): widen CRE report+event…`.
- Related: [[chainlink-cre-ts-sdk-confidential-workflow-wiring]] (the workflow side of the same 5→7 tuple migration).
- Prior subgraph gotchas: [[matchstick-asc-binary-not-found-pnpm]], [[matchstick-cannot-test-native-timeseries-aggregation]].
