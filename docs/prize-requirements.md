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
| Built **from scratch** during the event | `packages/subgraph` | New `AssuranceHub` subgraph authored during the event: `subgraph.yaml`, `schema.graphql`, `src/mappings/*.ts` indexing `AssuranceHub` events (Job, Guarantee, Claim, Payout, Provider). Git history shows it created from scratch. |
| The Graph is **load-bearing** | `packages/subgraph` + `apps/agent` | The agent's risk quote **cannot be produced** without the subgraph — provider reputation (regressions, guarantees locked, total paid out) comes only from indexed Graph data, not from any mock. |
| **Consume live (non-mocked) data** from a Graph provider | `apps/agent` (`src/risk/quote.ts`, `src/graph/client.ts`) | Agent runs a real GraphQL query against the deployed endpoint (Subgraph Studio URL, or local `graph-node` for `arc-testnet`) returning real indexed chain state. Freshness guard queries `_meta { block { number } hasIndexingErrors }` and refuses to quote if stale. |
| Do **meaningful AI work** (reasoning / decisions / automation / NL interface) | `apps/agent` | Agent computes `regressionRate` and `payoutToGuaranteeRatio` from live data and makes an autonomous **guarantee-sizing / premium** decision. This is decision automation over live onchain reputation, not a passive display. |
| Public repo + README + **2–4 min video** | root + `docs/demo-flow.md` | Public monorepo, root `README.md`, and the video script in `docs/demo-flow.md` (The Graph segment: live GraphQL query feeding the agent's risk quote). |

**Deployment note:** Arc **testnet** (`arc-testnet` / `eip155:5042002`) and Arc **mainnet**
(`arc` / `eip155:5042`) are both listed supported Graph networks. If Subgraph Studio hosted
indexing rejects `arc-testnet`, run a **local `graph-node`** against an Arc testnet RPC. Only the
manifest `network:` value changes between environments (driven via `networks.json`).

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

**Agent authority guardrail:** the agent **quotes and monitors** and holds only minimal USDC. It
**never** settles guarantee payouts — settlement is the DON-signed path (see the Chainlink section
and ADR-004). This is agent-as-transport, never agent-as-authority.

---

## Chainlink — Best Confidential Workflow — $2,000

| Official requirement | Package / app | Demonstration evidence |
|---|---|---|
| A **CRE Confidential Workflow** doing a **meaningful** part of the app | `packages/cre-workflow` | The confidential workflow runs the **private regression test** — the sole gate on the 100-USDC guarantee payout. Without it, no covered failure can ever be proven. |
| Register / use a **TEE handler** | `packages/cre-workflow` (`workflow.ts`) | **See correction below.** TS path uses `ConfidentialHTTPClient` inside a normal `handler`; if the prize hard-requires the `handlerInTee` / `cre.HandlerInTee` **symbol**, the confidential handler is written in **Go**. |
| Process **≥1 sensitive input / secret / private value inside the enclave** | `packages/cre-workflow` | Private regression tests, private pass/fail thresholds, and repository credentials are fetched/injected **inside the enclave** via Vault DON secrets (`{{.token}}` templating). They exist nowhere else — not in source, Postgres, onchain metadata, or the subgraph. |
| Confidential portion **meaningfully contributes to core functionality** | `packages/cre-workflow` + `packages/contracts` (`AssuranceHub` receiver) | The enclave verdict — `abi.encode(uint256 jobId, bool covered, uint256 amount)` — is the **sole trigger** for the guarantee payout via **`AssuranceHub.onReport`**, which finalizes a `ClaimPending` job. `onReport` is gated by both the **forwarder** address and the **workflow identity** decoded from packed Keystone metadata (`bytes32 workflowId \| bytes10 workflowName \| address workflowOwner`); the contract caps the payout at `min(amount, guaranteeAmount)` and returns the remainder to the provider. |
| **Demonstrate via CRE CLI simulation or live deployment** | `packages/cre-workflow` | Evidence via `cre workflow simulate` terminal output (with the secret **never** appearing in logs) + the demo video. **Simulate-as-evidence is explicitly accepted** — private-beta live access is not required to qualify. |

### CRE §17.2 correction — the TypeScript SDK reality

The track wording asks to "register and use a confidential TEE handler (`handlerInTee` TS /
`cre.HandlerInTee` Go)". **That TypeScript symbol does not exist in the current SDK** —
`handlerInTee`, `TeeRuntime`, and `usingTheDons` are **not present** in the TS SDK. Two paths:

- **Path A (TypeScript, recommended if judges accept it):** use **`ConfidentialHTTPClient`** — a
  real TEE execution path where the Vault-DON secret is injected **inside the enclave** and never
  touches node memory, called from within a normal `handler`. Demonstrate via
  `cre workflow simulate`.
- **Path B (if the prize hard-requires the `HandlerInTee` symbol):** write the confidential
  handler in **Go** (`cre.HandlerInTee` exists there) and keep the rest of the repo TypeScript.

**Do not ship a TypeScript `handlerInTee` call — it will not compile.** Confirm the requirement
wording and inspect the installed `@chainlink/cre-sdk` `.d.ts` before implementing the workflow.

### Confidentiality boundary reminder

Runtime data, secrets, and computation are confidential from node operators — but the **source
code / binary are not**. Private test logic and criteria must therefore be **fetched at runtime**
(inside the enclave), never inlined in workflow source. Only the minimal verdict
`{jobId, regressed, amount}` is declassified back to the DON for the signed report.
