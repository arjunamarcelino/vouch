---
title: "graph build crashes with 'AssemblyScript compiler has crashed' on nullable Boolean fields / nullable-getter null-checks"
category: build-errors
tags: [the-graph, subgraph, assemblyscript, graph-cli, graph-ts, wasm, nullable, compiler-crash]
module: packages/subgraph
symptom: "`graph build` fails with 'the AssemblyScript compiler has crashed during compile' / 'AssertionError: assertion failed' and an immutable.js stack trace — no file:line, no type error"
root_cause: "AssemblyScript (via graph-ts codegen) chokes on a nullable value-type entity field (Boolean) and on a `== null` check against a nullable value-type getter; the crash is an internal asc assertion, not a normal type error"
date: 2026-09-10
---

# graph build: "AssemblyScript compiler has crashed" on nullable value-type fields

## Symptom

`graph codegen` succeeds, but `graph build` (graph-cli 0.98.1, graph-ts 0.38.2) aborts with:

```
▌ Whoops, the AssemblyScript compiler has crashed during compile :-(
▌ AssertionError: assertion failed
✖ Failed to compile subgraph: Failed to compile data source mapping:
  The AssemblyScript compiler crashed when compiling this file: 'src/mappings/<x>.ts'
    at updateInDeeply (.../immutable/dist/immutable.js:3306:28)
    ...
```

Key tells:
- It is a **compiler crash** ("has crashed", `AssertionError: assertion failed`), **not** a normal AS type error (no `ERROR TSxxxx`, no `file:line`).
- The stack trace is inside `immutable.js` / graph-cli internals — useless for locating the cause.
- `graph codegen` passes; only `graph build` (the asc compile to WASM) fails.

## Investigation (what didn't work)

1. **Reading the error** — the crash prints no file/line for the offending construct. Dead end.
2. **Guessing at usual suspects** — checked for `===`/`!==` (invalid in AS), ternaries with nullables, `Bytes.fromBigInt` id encoding, `BigInt.zero()` usage. Fixing an unrelated ternary did **not** resolve it.
3. **`graph build --debug` / verbose** — still only surfaced the generic asc crash, not the construct.

## Root cause

Two AssemblyScript-hostile constructs in the mapping, both involving **nullable value types**:

1. A **nullable `Boolean` entity field** in `schema.graphql` (`covered: Boolean`) that the handler assigned `= null`. `Boolean` is a value type; graph-ts's generated nullable wrapper + a `null` assignment makes asc assert-crash (unlike nullable `BigInt`/`Bytes`, which are reference types and are fine).
2. A **`== null` check on a nullable value-type getter** (`if (claim.resolvedAtTimestamp == null)` where `resolvedAtTimestamp: BigInt` is nullable) inside a handler.

The crash is an internal asc assertion with no diagnostic, which is why it's so hard to pin down.

## How it was isolated (the reusable technique)

Because the crash names the file but not the line, **bisect by stubbing handlers**:

```bash
cp src/mappings/x.ts /tmp/x.full.ts        # back up
# Stub every exported handler except one to empty bodies, then:
graph build                                 # does it still crash?
# Restore full, stub only the SECOND HALF of handlers, build. Narrow by halves,
# then reintroduce handlers one at a time until the crashing one is identified.
```

Every handler referenced by `subgraph.yaml` must still exist (empty `export function handleX(e: X): void {}` is fine), so the manifest stays valid while you bisect. This localized the crash to a single handler in ~4 builds, then to the two constructs within it.

## Working solution

1. **Make nullable value-type fields non-nullable with a default.** Change `covered: Boolean` → `covered: Boolean!` in `schema.graphql`; initialize `claim.covered = false` at creation and set the real value on resolution. (Consumers gate on a separate `resolvedAt*` field to know when it's meaningful.)

   ```graphql
   # schema.graphql — before → after
   # covered: Boolean          # nullable value type → asc crash
   covered: Boolean!           # non-null with a default
   ```

2. **Remove the `== null` check on the nullable value-type getter.** If the event fires at most once (guaranteed here by an on-chain claim latch), the guard is unnecessary — drop it and assign unconditionally:

   ```typescript
   // before: if (claim != null && claim.resolvedAtTimestamp == null) { ... }  // crashes asc
   let claim = Claim.load(id);
   if (claim != null) {
     claim.covered = event.params.covered;
     claim.resolvedAtBlock = event.block.number;
     claim.resolvedAtTimestamp = event.block.timestamp;
     claim.save();
   }
   ```

After both changes, `graph codegen && graph build` compiles to WASM cleanly.

## Prevention

- **Prefer non-nullable value types** (`Boolean!`, and give them a sane default) in subgraph schemas. Reserve nullability for reference types (`BigInt`, `Bytes`, entity refs).
- **Don't null-check nullable value-type getters** in mappings. If you need a "resolved once" guard, gate on a **reference-type** field's presence (e.g. an entity `load() == null`) or an on-chain-guaranteed single emission, not on a nullable `Boolean`/`BigInt` `== null`.
- **On any asc crash, bisect by stubbing handlers** — do not try to read the crash trace; it points at graph-cli internals, never your code.
- Keep the AS gotcha checklist handy: no `===`/`!==`, use `.plus()/.minus()/.gt()` for `BigInt`, null-check every `.load()` result, and avoid ternaries mixing nullable operands.

## Cross-references

- Applied in `packages/subgraph/src/mappings/assuranceHub.ts` and `packages/subgraph/schema.graphql`.
- Related plan context: `docs/plans/2026-09-10-feat-arc-assurance-settlement-contracts-plan.md` §17.4 (subgraph patterns / AssemblyScript gotchas).
- The Graph docs: subgraphs/developing/creating/graph-ts/api (entity/value types).
