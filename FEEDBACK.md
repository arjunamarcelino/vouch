# Vouch — Developer Feedback for Sponsor SDKs

Constructive feedback from building Vouch (ETHOnline 2026) end-to-end on three sponsor stacks:
The Graph, Chainlink CRE, and the Circle Agent Stack (on Arc). Everything below is friction we
actually hit, why it was hard, and how we worked around it. We shipped on all three, so this is
offered in the spirit of "here's where the next team will trip" — not as a complaint. Each point
cites the internal write-up it came from.

Sources are the solution notes under `docs/solutions/` and `docs/DEPLOYMENT.md`; every friction point
below is traceable to one of them.

---

## The Graph

We built a net-new subgraph (`packages/subgraph`, 13 entities / 13 handlers indexing `AssuranceHub`)
and made the agent's risk quote a pure function of indexed data. The Graph tooling was productive once
past setup, but five rough edges cost real time.

### 1. `graph build` AssemblyScript crash with no file:line
_Source: `docs/solutions/build-errors/graph-cli-assemblyscript-compiler-crash-nullable-fields.md`_

**What we hit.** `graph codegen` passed, but `graph build` (graph-cli 0.98.1, graph-ts 0.38.2) aborted
with `Whoops, the AssemblyScript compiler has crashed during compile` / `AssertionError: assertion
failed`, and a stack trace inside `immutable.js` / graph-cli internals.

**Why it was hard.** The crash is an internal `asc` assertion, not a normal type error — no `ERROR
TSxxxx`, no file:line pointing at the offending construct. The trace points at tooling internals, so
reading it leads nowhere. The actual triggers were AssemblyScript-hostile constructs: a nullable
value-type entity field (`covered: Boolean`) assigned `null`, and a `== null` check on a nullable
value-type getter.

**How we worked around it.** We bisected by stubbing handlers to empty bodies and rebuilding by
halves until the crashing handler was isolated (~4 builds), then made nullable value-type fields
non-nullable with a default (`Boolean!`, init `false`) and dropped the `== null` guard.

**Suggestion.** Even a best-effort "crashed while compiling near field/handler X" would save hours;
today the crash names the file but never the construct.

### 2. Event-signature drift across three unsynced places
_Source: `docs/solutions/build-errors/subgraph-event-signature-manifest-drift.md`_

**What we hit.** After widening a Solidity event, `graph codegen` failed with `Event with signature
… not present in ABI 'AssuranceHub'` — even though the regenerated ABI JSON already had the new params.

**Why it was hard.** The signature is pinned in three artifacts that do not auto-sync: the contract,
the hand-written `eventHandlers[].event` string in `subgraph.yaml`, and (in our repo) an ABI-generator
banner. The error text ("not present in ABI") points at the ABI, but the stale copy is actually the
manifest string that graph-cli matches against the ABI — misleading.

**How we worked around it.** We now treat an event signature as a cross-artifact contract and update
every copy in one commit (contract → `abi:sync` → `subgraph.yaml` → mapping → Matchstick fixtures).

**Suggestion.** A codegen-time check that greps the manifest's event signatures against the generated
ABI and fails with "manifest signature X does not match ABI" would replace the misleading error.

### 3. `networks.json` is inert without `--network`
_Source: `docs/solutions/build-errors/subgraph-preflight-guarded-networks-json-not-deployed-manifest.md`_

**What we hit.** A predeploy guard validated `networks.json` (address non-zero, startBlock > 0) and
reported green, while the values that actually shipped came from `subgraph.yaml`. The two agreed, so
nothing looked broken — but the guard was protecting a file the deploy never reads. (An earlier
version had indexed from block 0 for the same reason.)

**Why it was hard.** graph-cli only merges `networks.json` into the manifest when you pass
`--network <name>` — and that flag rewrites `subgraph.yaml` in place. With no `--network` flag (our
`deploy:studio` ran a bare `graph deploy`), `networks.json` is never read, so the hardcoded
`subgraph.yaml` coordinates are authoritative. Documentation frames `networks.json` as the way to
deploy "without manually editing subgraph.yaml," which reads as always-on rather than flag-gated.

**How we worked around it.** We made the preflight validate the manifest that actually ships and
cross-check `networks.json` against it, so a single-file edit can't silently diverge.

**Suggestion.** Warn (or make it explicit in docs) when `networks.json` exists but `--network` isn't
passed — the "keep in sync" comment we had to leave in `subgraph.yaml` is a smell the tooling could own.

### 4. Matchstick can't find `asc` under pnpm
_Source: `docs/solutions/test-failures/matchstick-asc-binary-not-found-pnpm.md`_

**What we hit.** `graph test` downloaded the Matchstick binary and then panicked before any test ran:
`Internal error during compilation: No such file or directory … Command path: …/node_modules/assemblyscript/bin/asc`.
`codegen` and `build` both worked — only `test` failed.

**Why it was hard.** Matchstick shells out to `node_modules/assemblyscript/bin/asc` relative to the
package, but `assemblyscript` is a transitive dep of the graph tooling. pnpm's strict, non-hoisted
layout only symlinks direct deps, so `asc` stays in the `.pnpm` store and isn't found. Nothing in the
panic hints at pnpm hoisting.

**How we worked around it.** Add `assemblyscript@0.19.23` (The Graph's pinned fork, not `^0.27`) as a
direct devDependency of the subgraph package so pnpm links `bin/asc`.

**Suggestion.** Matchstick could resolve `asc` via node resolution (or document the pnpm devDep) so
this doesn't surface as a cryptic file-not-found on an increasingly common package manager.

### 5. Matchstick can't test native timeseries / aggregation
_Source: `docs/solutions/test-failures/matchstick-cannot-test-native-timeseries-aggregation.md`_

**What we hit.** A handler that `.save()`s an `@entity(timeseries: true)` entity with a native
`Timestamp!` field crashed Matchstick 0.6.0 (`value 9 is out of range for StoreValueKind`), and
`@aggregation` rollups never appeared in the store — so a handler feeding native aggregation could not
be unit-tested at all.

**Why it was hard.** Matchstick is a separate Rust store reimplementation, not `graph-node`: it has no
aggregation rollup engine, and its `StoreValueKind` enum is missing the `Timestamp` variant
(LimeChain/matchstick #433, open). This collides directly with a "Matchstick test for every handler"
goal, and there's no downgrade that fixes it.

**How we worked around it.** We modeled the rollup as a manual, mutable day-bucket keyed by
`provider ++ dayId` using `BigInt` seconds (never native `Timestamp`), which is fully testable. We
accept the per-event load+save cost that native aggregation avoids.

**Suggestion.** Matchstick parity for `Timestamp!`/`@aggregation` (even a stub rollup at interval
boundaries) would let teams use the newer native features without giving up unit coverage.

---

## Chainlink CRE

We built a confidential post-completion evaluation workflow (`packages/cre-workflow`,
`@chainlink/cre-sdk@1.20.1`) with a real `handlerInTee` under a Nitro TEE constraint, and got the
official `cre workflow simulate` to report `REPORTED:PAYOUT` end-to-end. The SDK is capable; most
friction came from the SDK's real surface differing from older docs, plus WASM-sandbox contracts that
are only discoverable by reading the shipped `.d.ts`.

### 1. Stale docs on `handlerInTee` TypeScript availability
_Source: `docs/solutions/integration-issues/chainlink-cre-ts-sdk-confidential-workflow-wiring.md`_

**What we hit.** Guidance (including our own earlier ADR, written before the TS SDK caught up)
implied the TypeScript SDK has no `handlerInTee`/`TeeRuntime`, so the confidential handler had to be
written in Go. That would have been a full unnecessary rewrite.

**Why it was hard.** The confidential-workflow surface isn't what pre-catch-up docs describe. `1.20.1`
does expose `handlerInTee(trigger, fn, tees, hooks?)` with `fn: (rt: TeeRuntime, trigger) => T`, and
`TeeRuntime` carries `getSecret`/`getSecrets` in-enclave — but you only see this by reading the
installed types.

**How we worked around it.** We grepped `node_modules/@chainlink/cre-sdk/dist/**/*.d.ts` for the exact
symbols and wired the TS handler directly.

**Suggestion.** Keep the public docs' TEE section in lockstep with the shipped TS SDK — the "use Go"
framing sends people down a costly detour.

### 2. `prepareReportRequest` double base64-encodes
_Source: `docs/solutions/integration-issues/chainlink-cre-ts-sdk-confidential-workflow-wiring.md`_

**What we hit.** The DON report payload came out wrong — double base64-encoded, producing a garbage
report.

**Why it was hard.** `prepareReportRequest(hexPayload)` takes a `0x…` hex string and base64-encodes it
internally. The intuitive `prepareReportRequest(hexToBase64(payload))` double-encodes. The parameter
name doesn't signal "hex in, not base64."

**How we worked around it.** Pass the raw `0x…` hex straight in; report generation uses
`runtime.reportFromDon(...)` (not `usingTheDons().report(...)`). We added a CI grep for
`hexToBase64(` near `prepareReportRequest(`.

**Suggestion.** Type the parameter as a branded hex type (or validate + throw on base64 input) so the
double-encode fails loudly instead of producing a silently-wrong report.

### 3. zod must be pinned to the SDK's v3
_Source: `docs/solutions/integration-issues/chainlink-cre-ts-sdk-confidential-workflow-wiring.md`_

**What we hit.** `Runner.newRunner<Config>({ configSchema })` rejected a schema built with our
workspace's zod (v4).

**Why it was hard.** The SDK depends on zod v3 and requires the config schema to be built with the same
instance/major. In a monorepo with a zod v4 catalog, importing any workspace package that pulls v4
creates a two-copies mismatch that the type error doesn't explain.

**How we worked around it.** Pin `zod@3.25.76` locally in the package and avoid importing workspace
packages carrying a different zod, with a `//zod` note in `package.json`.

**Suggestion.** Document the zod-major constraint prominently, or accept a plain schema shape so users
aren't coupled to the SDK's exact zod instance.

### 4. `node:fs` typed as `never` under Javy/WASM
_Source: `docs/solutions/integration-issues/chainlink-cre-ts-sdk-confidential-workflow-wiring.md`_

**What we hit.** `tsc --noEmit` broke on any `node:fs`/`fs` usage in workflow code.

**Why it was hard.** The Javy/QuickJS WASM sandbox types `node:fs` as `never`, and a triple-slash
`restricted-node-modules.d.ts` bleeds that into the whole program — so a single `fs` reference poisons
typechecking without a clear "not available in the sandbox" message.

**How we worked around it.** Read fixtures via JSON module imports
(`import x from "./f.json" with { type: "json" }` + `resolveJsonModule`) instead of `fs`, and added a
CI grep for `node:fs` in workflow source.

**Suggestion.** A targeted diagnostic ("`fs` is unavailable in the CRE WASM sandbox — use JSON module
imports") would beat a bare `never` type error.

### 5. Which runtime methods route inside vs outside the enclave
_Source: `docs/solutions/integration-issues/chainlink-cre-ts-sdk-confidential-workflow-wiring.md`_

**What we hit.** It was unclear which `runtime` methods execute inside the TEE vs on the DON.

**Why it was hard.** `callContract` / `writeReport` / `ConfidentialHTTPClient.sendRequest` are typed for
`Runtime<unknown>` (they route outside the enclave), so you must call them via `rt.usingTheDons()`,
while `getSecret` and `reportFromDon` are on the `TeeRuntime` (`rt`) directly. The confidentiality
boundary is load-bearing but only inferable from the types.

**How we worked around it.** We routed chain I/O through `rt.usingTheDons()` and kept in-enclave calls
on `rt`, keeping `workflow.ts` as the only SDK-coupled file behind an `EvalPort` seam.

**Suggestion.** Name or document the boundary explicitly (e.g. `rt.don.callContract` vs `rt.tee.*`) so
the in-enclave / on-DON split is visible at the call site.

### 6. `TxStatus.SUCCESS` vs the proto wire name
_Source: `docs/solutions/integration-issues/chainlink-cre-ts-sdk-confidential-workflow-wiring.md`_

**What we hit.** Checking a write's success against `TX_STATUS_SUCCESS` didn't match.

**Why it was hard.** `writeReport` returns `WriteReportReply { txStatus, txHash? }`, and the success
member is `TxStatus.SUCCESS` — `TX_STATUS_SUCCESS` is only the proto wire name, which is the more
discoverable spelling if you've seen the protobufs.

**How we worked around it.** Compare against `TxStatus.SUCCESS`.

**Suggestion.** Align the exported enum member name with the wire name, or document the mapping.

### 7. `z.string().url()` rejected by the WASM zod runtime
_Source: `docs/DEPLOYMENT.md` (CRE runtime bugs, lines ~64-68)_

**What we hit.** The config schema's `z.string().url()` was rejected by the Javy/WASM zod at runtime.

**Why it was hard.** A perfectly standard zod validator fails only inside the WASM runtime — it works
fine locally, so it surfaces late (during `cre workflow simulate`), not at author time.

**How we worked around it.** Replaced it with
`z.string().trim().min(1).refine(startsWith "https://")`, which keeps the https guarantee on the
credential destination without the WASM-incompatible `.url()`.

**Suggestion.** Document the WASM-zod validator subset (which refinements are supported), so teams
don't ship an `.url()` that only fails in simulate.

### 8. `emitReport` throws on a dry-run success without txHash
_Source: `docs/DEPLOYMENT.md` (CRE runtime bugs, lines ~64-68)_

**What we hit.** `emitReport` threw during simulation on a dry-run `writeReport` that returned SUCCESS
but no `txHash`.

**Why it was hard.** A dry-run intentionally has no on-chain tx, so success-without-txHash is the
expected simulate state — but the SDK path treated a missing `txHash` as an error, blocking the very
evidence path (`simulate`) that Chainlink accepts.

**How we worked around it.** We handle the dry-run SUCCESS-without-txHash case rather than throwing, so
`cre workflow simulate` completes to `REPORTED:PAYOUT`.

**Suggestion.** Make `emitReport` tolerate a dry-run SUCCESS with no `txHash`, since simulate is the
sanctioned confidential-workflow evidence.

### 9. Confidential-HTTP / EVM-log-trigger ergonomics (alpha)
_Source: `docs/solutions/integration-issues/chainlink-cre-ts-sdk-confidential-workflow-wiring.md`;
`docs/DEPLOYMENT.md`_

**What we hit.** Getting the EVM-log trigger + confidential fetch working meant discovering that an
indexed event arg (e.g. `ClaimOpened.jobId`) arrives in `log.topics[1]`, that reads go through
`evmClient.callContract(rt, { call: encodeCallMsg(...), blockNumber: LAST_FINALIZED_BLOCK_NUMBER })`,
and that simulate needs `--evm-tx-hash … --evm-event-index …` flags. Confidential HTTP is alpha.

**Why it was hard.** These are correct once you know them, but each is an unlabeled contract you learn
by reading types or trial-and-error against the CLI. The confidential-HTTP surface being alpha means
the shape can move under you.

**How we worked around it.** We decode `topics[1]` with viem, pin `blockNumber` to
`LAST_FINALIZED_BLOCK_NUMBER`, and drive simulate with the explicit EVM-log flags — all validated in
`docs/evidence/simulate-cli-payout.txt`.

**Suggestion.** A worked EVM-log-trigger + confidential-fetch example in the docs (topics indexing,
finalized-block reads, the simulate flags) would collapse most of this.

### 10. Live enclave deploy needs private-beta enrollment
_Source: `docs/DEPLOYMENT.md` (lines ~64-68); wiring note_

**What we hit.** A live enclave deploy (`--broadcast` on a DON) requires private-beta enrollment;
Confidential Workflows are private beta.

**Why it was hard.** Nothing you can do in-repo unblocks a real enclave deploy without enrollment. It's
a reasonable gate — but it means teams must lean on simulate.

**How we worked around it.** We leaned on the officially accepted evidence path: `cre workflow
simulate` produced `REPORTED:PAYOUT` against the live Arc deployment (a single local node, honestly
not a Nitro attestation), which the prize explicitly accepts. We state the trust-model caveat plainly.

**Suggestion.** Keep the "simulate is accepted evidence" statement front-and-center in hackathon docs —
it materially de-risks the track for teams who can't get beta access in time.

---

## Circle Agent Stack (on Arc)

We use `@circle-fin/developer-controlled-wallets` for a policy-bound agent wallet
(`apps/agent/src/wallet/agentWallet.ts`) that posts and refunds a real, reputation-priced quote-bond
via `escrow.postBond` on Arc testnet. Two design lessons stood out — both about the wallet's default
surface making a dangerous action too easy.

### 1. A plain transfer to a contract silently strands funds
_Source: `docs/solutions/integration-issues/custodial-wallet-transfer-to-contract-locks-funds.md`_

**What we hit.** USDC sent from the Circle wallet to the `QuoteBondEscrow` **address** confirmed
on-chain, but the money was unrecoverable — every exit (`refundBond`) reverted `BondNotFound` because
`bonds[quoteId]` was never set.

**Why it was hard.** The demo "works" — a tx lands on the explorer, balances change — so it looks
correct. The footgun only bites when `QUOTE_BOND_ESCROW_ADDRESS` points at the real escrow contract
(the natural thing to do). Circle DCW's `createTransaction` (token transfer) and
`createContractExecutionTransaction` (contract call) are distinct operations; a plain transfer credits
the contract's balance but runs none of its logic, so the accounting slot stays empty forever. A plain
transfer to an EOA would have been fine — a plain transfer to a contract that expects a function call
is the trap.

**How we worked around it.**
- Call the contract, don't transfer to it: `createContractExecutionTransaction` with viem-encoded
  `postBond(...)` callData.
- Give the wallet adapter the narrowest surface — **contract-execution only**, no raw `sendUsdc` — so
  the bare-transfer path is unrepresentable.
- Add a **bytecode pre-send guard**: assert the destination has contract bytecode
  (`getBytecode !== "0x"`) before any send, which also refuses a `0x…dEaD` EIP-712 fallback address.
- Integration-test the full round-trip (post → refund returns funds), not just "a tx confirmed."

**Suggestion.** When a custodial transfer's destination is a contract, Circle could surface a
warning/opt-in ("this address has bytecode — did you mean a contract execution?"). Making the
transfer-to-contract case loud by default would prevent a whole class of stranded-funds bugs.

### 2. Entity secret bypasses in-process caps → wants Circle-side spend controls
_Source: `docs/solutions/integration-issues/custodial-wallet-transfer-to-contract-locks-funds.md`;
`docs/DEPLOYMENT.md` (agent wallet)_

**What we hit.** Our agent wallet enforces per-tx / daily caps and a destination allowlist in-process,
but those are only as strong as the process holding the entity secret — anyone who can call the SDK
with the secret can bypass application-layer caps.

**Why it was hard.** The strong controls we want (spend limits, destination allowlists) live in our
code, not in the custody layer. The entity secret is a single high-value credential; app-layer policy
around it is advisory from the custody service's perspective.

**How we worked around it.** We kept the entity secret off-repo (recovery file gitignored), scoped the
wallet adapter to contract-execution-only against an allowlist, capped per-tx and daily spend, and made
the wallet throw `NotImplementedError` when unconfigured (never fakes a tx). One-time
`approve(QuoteBondEscrow)` is explicit at setup.

**Suggestion.** First-class **Circle-side spend controls** (per-tx/daily caps + destination allowlist
enforced by the custody service, not the caller) would let agent builders put the guardrails where the
key actually lives — a natural fit for autonomous-agent wallets.

---

## Toolchain (cross-cutting)

Not sponsor-specific, but two framework/toolchain gauntlets cost real time and are worth flagging for
any team on a similar stack.

### 1. NestJS DI needs SWC decorator metadata — not tsx/esbuild
_Source: `docs/solutions/integration-issues/nestjs-esm-decorator-metadata-tsx-swc.md`_

**What we hit.** `apps/api` (NestJS 11, ESM) booted fine under `tsc && node dist`, but the fast dev
loop (`tsx` / esbuild loader) failed at DI — `Nest can't resolve dependencies of X (?)`, or worse, a
constructor param silently injected as `undefined`.

**Why it was hard.** NestJS reads `design:paramtypes` at runtime; esbuild-based loaders deliberately
don't emit that type-reflection metadata (it needs full type resolution). The failure is invisible in
plain unit tests that `new` the class directly — it only bites once Nest's DI container constructs
instances. The `tsc`-works / `tsx`-breaks split is the tell that it's the transpiler, not the wiring.

**How we worked around it.** Run through `@swc-node/register` with an ESM loader and `.swcrc`
`decoratorMetadata: true` (SWC does emit the metadata). In a pnpm/Turborepo monorepo we use a
process-wide loader (`node --import @swc-node/register/esm-register`) rather than `nest start -b swc`,
because the latter can't transpile sibling `workspace:*` `.ts` packages on the fly.

**Takeaway.** Any esbuild-based TS runner plus a decorator-metadata framework (NestJS, TypeORM,
class-validator) is a trap — transpile with `tsc` or SWC-with-metadata.

### 2. Next.js 16 + wagmi v2 + RainbowKit SSR gauntlet
_Source: `docs/solutions/integration-issues/nextjs16-wagmi-rainbowkit-ssr-wiring.md`_

**What we hit.** Standing up the wallet layer in `apps/web` (Next.js 16, Turbopack, React 19) with
wagmi + RainbowKit + SIWE cookie hydration failed in four sequential ways:
1. `Module not found: '@x402/core/client'` (and `@x402/evm`, `@x402/svm/*`) — optional sub-deps of the
   Base/Coinbase connector pulled in transitively by RainbowKit, in a Client-Component-SSR trace, even
   though we never use that connector.
2. `Attempted to call getDefaultConfig()/connectorsForWallets() from the server` — those helpers are
   client-only in RainbowKit 2.2.x but the wagmi SSR pattern computes `cookieToInitialState` in the
   Server Component root.
3. `ReferenceError: indexedDB is not defined` + `WalletConnect Core … Init() was called 2 times` —
   the WalletConnect connector eagerly touches browser globals when the config is built server-side.
4. `TS2742: The inferred type of 'getConfig' cannot be named … not portable` — the config's inferred
   type transitively names a pnpm-hashed `@walletconnect/…` path.

**Why it was hard.** Each fix uncovered the next, and the meta-cause was silent: RainbowKit 2.2.11
peer-requires wagmi `^2.9` + viem `2.x`, but `latest` wagmi is now v3 — installing "latest" quietly
breaks RainbowKit.

**How we worked around it.** Pin wagmi v2 (RainbowKit's peer); `serverExternalPackages:
["@coinbase/cdp-sdk", "@base-org/account"]` to keep the optional `@x402/*` imports out of the server
bundle; build the wagmi config with plain isomorphic `createConfig` + `injected()` (not
`getDefaultConfig`) with an explicit `: Config` return type; and drop `walletConnect()` from the
server-built config. Result: `next build` exits 0 and the SIWE flow works.

**Takeaway.** Treat the wagmi config factory as isomorphic (no browser globals, explicit return type),
check the connect-library's peer deps before installing, and prefer the narrowest connector set.

---

## What worked well

Balance — each sponsor stack got us to a working, demonstrated result, and several things were a
pleasure.

**The Graph.** `graph codegen` → typed entities/handlers is a genuinely good DX, and Subgraph Studio
accepted Arc testnet (`eip155:5042002`) cleanly with a real API-key query endpoint. Once past the
AssemblyScript gotchas, the mapping model is simple and the indexed data was reliable enough to make it
the single source of truth for the agent's risk quote — no DB mirror, no fixtures. (Sources:
`docs/DEPLOYMENT.md` The Graph section; the subgraph solution notes above.)

**Chainlink CRE.** The TypeScript SDK (`1.20.1`) genuinely ships `handlerInTee` / `TeeRuntime` /
`reportFromDon` — no Go rewrite needed — and Arc is bundled (`getNetwork({ chainSelectorName:
"arc-testnet" })` resolves out of the box). Most importantly, `cre workflow simulate` is a real,
accepted evidence path that ran our confidential workflow end-to-end to `REPORTED:PAYOUT` without live
enclave access. The secrets model (`{{.token}}` Vault templating, `getSecret`, `confidentialFetch`
with only the verdict declassified) maps cleanly onto a real confidentiality requirement.
(Source: `docs/solutions/integration-issues/chainlink-cre-ts-sdk-confidential-workflow-wiring.md`;
`docs/DEPLOYMENT.md` CRE section.)

**Circle Agent Stack (on Arc).** Once we used `createContractExecutionTransaction` correctly, the
policy-bound wallet did exactly what an autonomous agent needs: it posted a real,
reputation-priced quote-bond via `escrow.postBond` and refunded it — a clean USDC round-trip on Arc
testnet from a custodial wallet. The transfer/contract-execution split, once understood, is the right
model, and the SDK made the round-trip straightforward to test on testnet.
(Source: `docs/solutions/integration-issues/custodial-wallet-transfer-to-contract-locks-funds.md`;
`docs/DEPLOYMENT.md` Circle section.)
