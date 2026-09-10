---
title: "Matchstick can't test native @entity(timeseries) / @aggregation (crashes on Timestamp!) — use a manual day-bucket"
category: test-failures
tags: [the-graph, subgraph, matchstick, matchstick-as, timeseries, aggregation, graph-ts, testing, issue-433]
module: packages/subgraph
symptom: "graph test crashes (StoreValueKind out of range) when a mapping .save()s an entity with a native Timestamp! field, and aggregation rollups never appear in the store — so a subgraph using native @aggregation cannot have a Matchstick test for the handler that feeds it"
root_cause: "Matchstick 0.6.0 reimplements the store in Rust and (a) has no aggregation rollup engine, so @aggregation entities are never produced in tests, and (b) is missing the Timestamp variant in StoreValueKind, so saving any entity with a native Timestamp! field aborts (LimeChain/matchstick #433)"
date: 2026-09-11
---

# Matchstick can't test native timeseries/@aggregation — use a manual day-bucket

## Symptom

You model a per-day rollup with The Graph's native feature:

```graphql
type ProviderActivity @entity(timeseries: true) { id: Int8! timestamp: Timestamp! provider: Bytes! ... }
type ProviderDailyMetric @aggregation(intervals: ["day"], source: "ProviderActivity") { ... }
```

Then `graph test` (Matchstick) either:

- **crashes** when a handler `.save()`s the timeseries entity:
  ```
  called `Result::unwrap()` on an `Err` value: Other(value 9 is out of range for StoreValueKind)
  ```
- or **silently never produces** the `ProviderDailyMetric` rollups, so any assertion on them fails
  (`No entity with type 'ProviderDailyMetric' …`).

Net effect: a handler that writes into the timeseries **cannot be unit-tested**, which breaks a
"Matchstick test for every handler" requirement.

## Investigation (what didn't work)

1. Asserting on the aggregation entity directly — never populated; Matchstick runs no rollup engine
   (rollups are computed by `graph-node` at interval boundaries, not in the mapping).
2. Keeping the timeseries but only asserting on the source points — still hits the `Timestamp!`
   `.save()` crash on specVersion ≥ 1.1 timeseries entities.
3. Downgrading matchstick / graph-ts — the `StoreValueKind` gap is unresolved upstream.

## Root cause

Matchstick (`matchstick-as` 0.6.0 + the Rust `matchstick` binary) is a **separate store
reimplementation**, not `graph-node`:

- It has **no aggregation engine** — `@aggregation` entities are never created during a test.
- Its `StoreValueKind` enum is **missing the `Timestamp` variant**, so persisting any entity with a
  native `Timestamp!` field aborts. Tracked as **LimeChain/matchstick #433** (open; no fix/PR as of
  2026-09).

So native timeseries/aggregation is fundamentally untestable in Matchstick today.

## Working solution

**Model the rollup as a MANUAL, mutable day-bucket keyed by `provider ++ dayId`, with `BigInt`
(seconds) timestamps — never the native `Timestamp` type.** Update it in the mapping with
load-or-create.

```graphql
# schema.graphql — manual, Matchstick-testable (no @aggregation, no Timestamp!)
type ProviderDailyMetric @entity(immutable: false) {
  id: Bytes!                 # provider ++ concatI32(dayId)
  provider: Provider!
  dayId: BigInt!             # block.timestamp / 86400 (seconds)
  dayStartTimestamp: BigInt! # dayId * 86400
  upheldFailures: BigInt!
  closedWindows: BigInt!
  payoutAmount: BigInt!
  lastUpdatedBlock: BigInt!
}
```

```typescript
// mapping — plain load-modify-save; fully testable in Matchstick
const SECONDS_PER_DAY = BigInt.fromI32(86400);
function bumpDailyMetric(provider: Provider, ..., event: ethereum.Event): void {
  let dayId = event.block.timestamp.div(SECONDS_PER_DAY);
  let id = provider.id.concatI32(dayId.toI32());
  let m = ProviderDailyMetric.load(id);
  if (m == null) { m = new ProviderDailyMetric(id); /* init BigInt fields to 0 */ }
  // ...increment counters...
  m.save();
}
```

```typescript
// test — assert on the bucket by its computed id (concatI32 = 4 little-endian bytes)
assert.fieldEquals("ProviderDailyMetric", PROVIDER.concatI32(dayId).toHexString(), "closedWindows", "1");
```

Trade-off accepted: manual buckets do a `load`+`save` per event (native aggregation avoids that and is
"orders of magnitude" cheaper to read) — but they are **testable**, which the native feature is not.
If you truly need native aggregation, treat its correctness as an **integration test** against a real
`graph-node`, and unit-test only the pure rollup math extracted into a plain function.

## Prevention

- **Choose the day-bucket pattern up front** for any subgraph that mandates per-handler Matchstick
  coverage. Don't discover the incompatibility after modelling with `@aggregation`.
- **Never use the native `Timestamp` type in a subgraph you intend to unit-test** — use `BigInt`
  seconds everywhere (also keeps ids/comparisons simple).
- Extract rollup/ratio arithmetic into **pure functions** and unit-test those directly; they don't
  need the store at all.

## Cross-references

- Applied in `packages/subgraph/schema.graphql` (`ProviderDailyMetric`) and
  `packages/subgraph/src/mappings/assuranceHub.ts` (`bumpDailyMetric`).
- Design rationale: `docs/decisions/006-bps-risk-in-subgraph.md`.
- Related tooling gotcha: `docs/solutions/test-failures/matchstick-asc-binary-not-found-pnpm.md`.
- Related AssemblyScript crash class: `docs/solutions/build-errors/graph-cli-assemblyscript-compiler-crash-nullable-fields.md`.
- Upstream: https://github.com/LimeChain/matchstick/issues/433
