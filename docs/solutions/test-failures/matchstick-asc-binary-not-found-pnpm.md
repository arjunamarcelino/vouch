---
title: "graph test (Matchstick) crashes: 'No such file or directory' for node_modules/assemblyscript/bin/asc under pnpm"
category: test-failures
tags: [the-graph, subgraph, matchstick, matchstick-as, assemblyscript, pnpm, monorepo, graph-test]
module: packages/subgraph
symptom: "graph test downloads the matchstick binary then panics: 'Internal error during compilation: No such file or directory (os error 2). Command path: .../node_modules/assemblyscript/bin/asc'"
root_cause: "Matchstick invokes node_modules/assemblyscript/bin/asc directly, but pnpm's strict (non-hoisted) node_modules only symlinks direct dependencies — assemblyscript is a transitive dep of graph-cli/graph-ts, so it lives in the .pnpm store and is NOT linked into the subgraph package's node_modules"
date: 2026-09-11
---

# graph test: assemblyscript `asc` not found under pnpm

## Symptom

`graph test` fetches the matchstick binary, then immediately panics before running any test:

```
💬 Compiling <name>...
thread 'main' panicked at '🆘 Internal error during compilation: No such file or directory (os error 2).
Command path: ".../packages/subgraph/node_modules/assemblyscript/bin/asc"
Globals path: ".../node_modules/@graphprotocol/graph-ts/global/global.ts"
Libs folder:  ".../packages/subgraph/node_modules"'
 ›   Error: Matchstick exited with an error
```

`graph codegen` and `graph build` both succeed — only `graph test` fails.

## Investigation (what didn't work)

- Re-running `pnpm install` — `@graphprotocol/graph-ts` is present (codegen works) but
  `node_modules/assemblyscript/` is absent.
- `matchstick.yaml` `libsFolder: node_modules` is correct (it must point at the dir *containing*
  `@graphprotocol`, not at `@graphprotocol` itself) — not the cause.
- The store has the dep (`ls node_modules/.pnpm | grep assemblyscript` shows `assemblyscript@0.19.23`
  and `@0.27.31`), but it isn't linked into the package's top-level `node_modules`.

## Root cause

Matchstick shells out to **`node_modules/assemblyscript/bin/asc`** relative to the subgraph package.
pnpm's default **strict, non-hoisted** layout (`shamefully-hoist=false`) only symlinks a package's
**direct** dependencies into its `node_modules`. `assemblyscript` is a **transitive** dep of the graph
tooling, so it stays in the `.pnpm` store and Matchstick can't find `asc`. (graph-cli/graph-node use
The Graph's pinned **`assemblyscript@0.19.23`**.)

## Working solution

Add `assemblyscript@0.19.23` as a **direct devDependency** of the subgraph package so pnpm links
`node_modules/assemblyscript/bin/asc`:

```jsonc
// packages/subgraph/package.json
"devDependencies": {
  "@graphprotocol/graph-cli": "^0.98.1",
  "@graphprotocol/graph-ts": "^0.38.2",
  "assemblyscript": "0.19.23",   // ← pin The Graph's asc so matchstick can find bin/asc
  "matchstick-as": "^0.6.0"
}
```

```bash
pnpm install --filter @vouch/subgraph
ls packages/subgraph/node_modules/assemblyscript/bin/   # → asc  asinit
pnpm --filter @vouch/subgraph test                       # matchstick runs
```

> Pin **exactly `0.19.23`** (The Graph's fork), not `^0.27` — the newer asc is a different toolchain
> and won't match `graph-ts`'s generated code / globals. A `public-hoist-pattern[]=*assemblyscript*`
> or `shamefully-hoist=true` in `.npmrc` would also work, but the explicit devDep is narrower and
> self-documenting.

## Prevention

- When adding Matchstick to a **pnpm** subgraph, add `assemblyscript@0.19.23` as a direct devDep in
  the same change as `matchstick-as` — don't wait for the cryptic `asc not found` panic.
- Keep the trio pinned together: `matchstick-as@^0.6.0` ↔ `graph-ts@^0.38.x` ↔ `assemblyscript@0.19.23`
  (version drift here is also the usual cause of "wrong argument count" test failures).

## Cross-references

- Applied in `packages/subgraph/package.json`.
- Related testing limitation: `docs/solutions/test-failures/matchstick-cannot-test-native-timeseries-aggregation.md`.
- Related AssemblyScript compile crash: `docs/solutions/build-errors/graph-cli-assemblyscript-compiler-crash-nullable-fields.md`.
- Matchstick: https://github.com/LimeChain/matchstick
