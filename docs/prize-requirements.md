# Vouch — Prize-Track Requirements Map

Vouch targets three ETHOnline 2026 tracks. This document maps **every official qualification
requirement** (from plan §4.6) to the exact planned package/app and the concrete demonstration
evidence.

> **Status:** these are the *planned* homes and evidence for a scaffold. Sponsor integrations are
> scaffolded placeholders; nothing here claims a completed integration. Per the rules, no module
> fakes transaction success or hard-codes chain results.

> **Scope guardrail:** **no integrations outside these three tracks.**

---

## The Graph — Best AI Tooling / AI Use Case (From Scratch) — $5,000

| Official requirement | Package / app | Demonstration evidence |
|---|---|---|
| Built **from scratch** during the event | `packages/subgraph` | `AssuranceHub` subgraph authored during the event: `subgraph.yaml`, `schema.graphql` (13 entities), `src/mappings/assuranceHub.ts`. Git history shows it created and expanded from scratch. |
| The Graph is **load-bearing** | `packages/subgraph` + `apps/agent` | The agent's risk quote is a pure function of provider history that exists **only** as indexed Graph data. The contract stores **no** reputation aggregates on-chain (ADR-003), there is no DB mirror, and no fixture. Remove or stale the subgraph and the agent can **only refuse** — proven live in `docs/the-graph-demo.md` steps 4–5. |
| **Consume live (non-mocked) data** from a Graph provider | `apps/agent` (`src/graph/client.ts`, `src/risk/quote.ts`), `packages/shared/src/graph/client.ts` | The agent runs the real `queries/risk-agent-input.graphql` against the deployed endpoint (Studio for `arc`, or local `graph-node` for `arc-testnet`). `scripts/validate-endpoint.mjs` proves the live endpoint serves every required field. Freshness is asserted in-request (`_meta { block deployment hasIndexingErrors }` + RPC block-lag) before any read. |
| Do **meaningful AI work** (reasoning / decisions / automation) | `apps/agent` + `packages/subgraph` | The subgraph computes provider risk features as integer basis points (`upheldClaimRateBps`, `claimFrequencyBps`, `averageCoverageRatioBps`, `payoutToCoveredValueBps`) into `ProviderRiskSnapshot`; the agent combines them with a read-time trailing-window `recentFailureRateBps` and makes an autonomous, **auditable** guarantee-sizing decision (premium band stamped with `asOfBlock` + `scoringFnVersion`). Decision automation over live on-chain reputation, not a passive display. |
| **Fail closed** (no fabricated history) | `apps/agent`, `apps/api`, `packages/shared/src/graph` | When the subgraph is unavailable/lagging/stale, or the deployment id mismatches, or the RPC head is unreadable, the shared gate throws `SUBGRAPH_UNAVAILABLE`/`STALE`/`LAGGING`; the agent emits **no quote** and the API returns **503** — never a 200 with empty/fake history. A genuinely new provider (fresh index, no history) gets a documented conservative quote, distinct from "blind". |
| **Health checks** (indexing lag + latest block) | `packages/subgraph/scripts/health-check.mjs` | Queries `_meta` + `indexingStatuses` (`chainHeadBlock − latestBlock`), asserts `synced`/`healthy`/no errors/lag within budget, reports the latest indexed block, and exits non-zero when unhealthy. |
| **Matchstick tests** for every handler | `packages/subgraph/tests` | 12 passing Matchstick tests: one per handler + cross-cutting integrity (same-tx covered burst, no negative exposure, completion counting, timeout exclusion, idempotency, bps sentinel). `graph test` in CI. |
| Public repo + README + **2–4 min video** | root + `docs/demo-flow.md` + `docs/the-graph-demo.md` | Public monorepo, root `README.md`, subgraph `README.md`, the video script in `docs/demo-flow.md` (The Graph segment), and the operator runbook `docs/the-graph-demo.md` (generate events → confirm indexed → query live → quote changes after an upheld claim → fail-closed on lag). |

**Why The Graph is necessary for quote generation.** Provider reputation is emitted as *minimal*
events and aggregated *only* by the subgraph (ADR-003 / ADR-006). The agent has no other source — no
on-chain aggregate, no database mirror, no fixture — so a guarantee quote is literally impossible
without live indexed Graph data, and the pipeline is designed so the only alternative to fresh data is
a refusal.

**Deployment note:** Arc **mainnet** (`arc` / `eip155:5042`) is a first-class Subgraph Studio network.
`arc-testnet` (`eip155:5042002`) Studio support is unconfirmed **[verify at deploy time]** → fall back
to a **local `graph-node`** against an Arc testnet RPC. Only the manifest `network:` value changes
between environments (driven via `networks.json`). Deploy key / endpoint / deployment id come from env,
never hard-coded.

---

## Arc — Best Agentic Economy App w/ Circle Agent Stack — $3,500

$2,500 of the prize is **conditional on an Arc mainnet deploy**; the MVP targets **Arc testnet**,
with mainnet as a bonus tier only.

| Official requirement | Package / app | Demonstration evidence |
|---|---|---|
| Functional MVP with **working frontend + backend** | `apps/web` (FE) + `apps/api` (BE) | Next.js dashboard served by the NestJS API: job list, guarantee state, coverage countdown, live USDC balances, tx links to `testnet.arcscan.app`. |
| **Architecture diagram** | `docs/architecture.md` | Component/data-flow Mermaid diagram + state machine + authority model. |
| **2–4 min demo video** | `docs/demo-flow.md` | Full on-camera script including the Arc segment (agent wallet + USDC + arcscan tx). |
| Public repo | root | Public monorepo. |
| **Declared track** | this document + root `README.md` | Track declared explicitly. |
| Genuinely **agentic** | `apps/agent` | Agent autonomously quotes guarantee size from live subgraph reputation, monitors coverage windows, and manages a policy-bound wallet — an autonomous loop, not a scripted one-shot. |
| Uses **≥1 Circle Agent Stack component** | `apps/agent` (`src/wallet/agentWallet.ts`) | Circle **Agent Wallet** via `@circle-fin/developer-controlled-wallets` (primary) with `@circle-fin/cli` as the headline Agent Stack surface. Policy-bound wallet with per-tx/daily caps + destination allowlist. |
| **USDC on Arc** | `packages/contracts` (`AssuranceHub` on Arc testnet) + `apps/agent` | The `AssuranceHub` settlement contract does all accounting in the **6-decimal ERC-20** USDC interface on Arc — escrowed task/service fees, provider-locked guarantee collateral, and capped service-credit payouts. Live balances shown in the UI; tx links to arcscan. |

**Agent authority guardrail:** the agent **quotes, monitors, and posts a refundable quote bond**
(its own capital, via `QuoteBondEscrow` — ADR-008) from a policy-capped, minimal-balance wallet. It
**never** moves guarantee principal / settles payouts — settlement is the DON-signed path (see the
Chainlink section and ADR-004). This is agent-as-transport, never agent-as-authority. The real USDC
action + wallet lifecycle are documented in `docs/arc-agent-stack.md`.

---

## Chainlink — Best Confidential Workflow — $2,000

| Official requirement | Package / app | Demonstration evidence |
|---|---|---|
| A **CRE Confidential Workflow** doing a **meaningful** part of the app | `packages/cre-workflow` | The confidential workflow runs the **private regression test** — the sole gate on the 100-USDC guarantee payout. Without it, no covered failure can ever be proven. |
| Register / use a **TEE handler** | `packages/cre-workflow` (`workflow.ts:212`) | The confidential handler is registered with the **real TypeScript `handlerInTee<…>`** from `@chainlink/cre-sdk@1.20.1` (verified present in the installed SDK), with a `nitro` TEE constraint. No Go rewrite needed — see the updated note below. |
| Process **≥1 sensitive input / secret / private value inside the enclave** | `packages/cre-workflow` | Private regression tests, private pass/fail thresholds, and repository credentials are fetched/injected **inside the enclave** via Vault DON secrets (`{{.token}}` templating). They exist nowhere else — not in source, Postgres, onchain metadata, or the subgraph. |
| Confidential portion **meaningfully contributes to core functionality** | `packages/cre-workflow` + `packages/contracts` (`AssuranceHub` receiver) | The enclave verdict — `abi.encode(uint256 jobId, bool covered, uint256 amount)` — is the **sole trigger** for the guarantee payout via **`AssuranceHub.onReport`**, which finalizes a `ClaimPending` job. `onReport` is gated by both the **forwarder** address and the **workflow identity** decoded from packed Keystone metadata (`bytes32 workflowId \| bytes10 workflowName \| address workflowOwner`); the contract caps the payout at `min(amount, guaranteeAmount)` and returns the remainder to the provider. |
| **Demonstrate via CRE CLI simulation or live deployment** | `packages/cre-workflow` | Evidence via `cre workflow simulate` terminal output (with the secret **never** appearing in logs) + the demo video. **Simulate-as-evidence is explicitly accepted** — private-beta live access is not required to qualify. |

### CRE §17.2 — the TypeScript SDK reality (correction verified 2026-09-11, ADR-002 §Post-review hardening)

The track wording asks to "register and use a confidential TEE handler (`handlerInTee` TS /
`cre.HandlerInTee` Go)". **The TypeScript symbol exists and is used.** `@chainlink/cre-sdk@1.20.1`
exports `handlerInTee` and `TeeRuntime` (with `reportFromDon` / `usingTheDons`), confirmed in the
installed `.d.ts`. We ship **Path A (TypeScript)**:

- `packages/cre-workflow/workflow.ts:212` registers the confidential handler with a real
  `handlerInTee<…>` call and a TEE constraint `[{ tee: "nitro", regions: ["us-west-2"] }]`
  (`us-west-2` is the only region the SDK's zod enum accepts in 1.20.1).
- The Vault-DON secret is injected **inside the enclave** via `ConfidentialHTTPClient` `{{.token}}`
  templating (`vaultDonSecrets`) and never touches node memory; the private pass-threshold is read
  via `getSecret`. Demonstrated via `cre workflow simulate` (and the deterministic `harness.ts`).

> **Prior revision retracted:** an earlier version of this section claimed `handlerInTee`/`TeeRuntime`
> were absent from the TS SDK and that a Go rewrite (`cre.HandlerInTee`) might be required. That is
> **stale** (true only of pre-1.x betas). **No Go path is needed.**

**Caveats to keep honest** (see [`docs/security.md`](security.md)): `confidential-http@1.0.0-alpha`
is alpha; response confidentiality (`encryptOutput`) is opt-in and defaults **off** (we adjudicate an
*untrusted* response and declassify only the verdict, so it is intentionally not enabled — documented,
not hidden). For an **EVM-log trigger** the CLI expects `--evm-tx-hash`/`--evm-event-index`, not
`--http-payload`.

### Confidentiality boundary reminder

Runtime data, secrets, and computation are confidential from node operators — but the **source
code / binary are not**. Private test logic and criteria must therefore be **fetched at runtime**
(inside the enclave), never inlined in workflow source. Only the minimal verdict
`{jobId, regressed, amount}` is declassified back to the DON for the signed report.
