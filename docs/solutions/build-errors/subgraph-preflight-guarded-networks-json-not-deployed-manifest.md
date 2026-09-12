---
title: "A subgraph deploy preflight guarded networks.json, but `graph deploy` without `--network` ships subgraph.yaml"
category: build-errors
tags: [subgraph, the-graph, graph-cli, deployment, networks-json, preflight, drift]
module: packages/subgraph
symptom: "A predeploy guard validated networks.json (address != 0x0, startBlock > 0), reporting green, while the actual deployed address/startBlock came from subgraph.yaml. The two happened to agree, so nothing was visibly broken — but the guard protected a file that has no effect on the deploy, so any future single-file edit would deploy stale coordinates with a passing preflight."
root_cause: "graph-cli only merges networks.json into the manifest when you pass `--network <name>` to `graph build`/`graph deploy` — and that flag REWRITES subgraph.yaml in place from networks.json. The repo's `deploy:studio` script runs `graph deploy` with NO `--network` flag, so networks.json is inert and subgraph.yaml's hardcoded `source.address`/`startBlock` are what actually ship. The preflight read networks.json — the wrong file."
date: 2026-09-13
---

# Subgraph preflight guarded the wrong file (networks.json vs. the deployed subgraph.yaml)

## Symptom

`packages/subgraph/package.json` had:

```json
"deploy:studio": "node scripts/preflight.mjs && graph deploy"
```

and `preflight.mjs` validated `networks.json`:

```
✓ PREFLIGHT OK  network=arc-testnet address=0xB30e…2bf9 startBlock=61747921
```

Everything looked fine because `networks.json` and `subgraph.yaml` carried identical values. But the
guard was checking a file the deploy never reads. The failure mode is latent: on the next redeploy,
someone updates the address in **one** file and not the other, and either (a) the deploy ships the
stale `subgraph.yaml` value with a **green** preflight, or (b) preflight fails against a `networks.json`
that isn't the file being shipped. (This repo had already been bitten once earlier: subgraph `v0.0.1`
indexed from block 0 because `graph build` didn't inject `networks.json`.)

## Root cause

`graph-cli` (`@graphprotocol/graph-cli`) treats `networks.json` as a **build-time input, applied only
via `--network`** — not a runtime overlay:

- `graph build --network <name>` (since graph-cli **v0.29.0**) and `graph deploy --network <name>`
  (since **v0.32.0**) read `networks.json` (default path, override with `--network-file`) and
  **rewrite `subgraph.yaml` in place** — patching `dataSources[].network`, `source.address`, and
  `source.startBlock` — then compile/deploy.
- With **no `--network` flag**, `networks.json` is never read. Whatever `address`/`startBlock` are
  already hardcoded in `subgraph.yaml` are exactly what compile and ship.

So the deployed manifest is `subgraph.yaml`. A preflight that validates `networks.json` while the
deploy omits `--network` is validating a file with zero effect on the artifact — the `# keep in sync
with networks.json` comment in `subgraph.yaml` was manual discipline standing in for a guard the
tooling should own.

## Working solution

Two coherent models exist; pick one and wire it fully. We chose the low-risk one (no redeploy before a
submission freeze): keep `subgraph.yaml` authoritative and make the guard validate **it**, plus assert
`networks.json` is in sync so the two can't silently diverge.

`packages/subgraph/scripts/preflight.mjs` now parses the deployed manifest (no YAML lib in the repo, so
regex-scope to the dataSource — the single-source manifest makes this safe):

```js
const dsIdx = manifest.indexOf("name: AssuranceHub");
const dsBody = manifest.slice(dsIdx);
const manifestAddress = dsBody.match(/address:\s*["']?(0x[a-fA-F0-9]{40})["']?/)?.[1];
const manifestStartBlock = Number(dsBody.match(/startBlock:\s*(\d+)/)?.[1]);
// validate: address != 0x0, well-formed, startBlock > 0 …

// then cross-check networks.json matches the manifest — fail on drift:
if (entry.address.toLowerCase() !== manifestAddress.toLowerCase()) fail("networks.json out of sync …");
if (entry.startBlock !== manifestStartBlock) fail("networks.json startBlock out of sync …");
```

Verified:

```
$ node scripts/preflight.mjs arc-testnet
✓ PREFLIGHT OK  network=arc-testnet address=0xB30e…2bf9 startBlock=61747921 (manifest ⇄ networks.json in sync)
$ node scripts/preflight.mjs arc     # networks.json has 0x0 for 'arc'; manifest has the testnet address
✗ PREFLIGHT FAILED: networks.json address (0x0…0) is out of sync with subgraph.yaml (0xB30e…2bf9) …
```

### The other model (The Graph's recommended one)

Make `networks.json` authoritative: add `--network arc-testnet` to the `build`/`deploy` scripts so
graph-cli injects it, and leave a `0x0` placeholder in `subgraph.yaml` that the build overwrites. The
Graph frames `networks.json` as the way to deploy "without manually editing `subgraph.yaml`" — but it
is only authoritative **if `--network` is actually passed**. This needs a redeploy to re-verify, which
is why we deferred it.

## Prevention

- **A deploy guard must validate the file the deploy actually ships.** Before writing a preflight,
  confirm whether the deploy command passes `--network` — that single flag decides whether
  `networks.json` or `subgraph.yaml` is authoritative.
- **Never rely on `networks.json` while deploying a hand-maintained `subgraph.yaml` without `--network`.**
  Either always deploy with `--network` (networks.json authoritative) or drop `networks.json` and guard
  the manifest.
- **Cross-check duplicated coordinates in the guard**, so a single-file edit can't silently diverge.
  The same `AssuranceHub` address also lives in `packages/cre-workflow/config.staging.json`; those are
  not cross-checked by tooling and rely on the `docs/DEPLOYMENT.md` redeploy checklist.
- A `# keep in sync with X` comment is a smell that a guard should own the invariant.

## Cross-references

- Sibling subgraph gotcha (different problem — event-signature drift across contract/manifest/banner):
  `docs/solutions/build-errors/subgraph-event-signature-manifest-drift.md`
- Redeploy checklist for all duplicated coordinates: `docs/DEPLOYMENT.md` → "Redeploy checklist".
- The Graph — [Deploying to Multiple Networks](https://thegraph.com/docs/en/subgraphs/developing/deploying-publishing/multiple-networks/)
  · [Subgraph Manifest](https://thegraph.com/docs/en/subgraphs/developing/creating/subgraph-manifest/)
  · feature origin [graph-tooling#837](https://github.com/graphprotocol/graph-tooling/issues/837)
- Found in PR #8 review (todo 082).
