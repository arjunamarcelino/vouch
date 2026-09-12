# Vouch — Prize-Track Requirements Map

Vouch targets three ETHOnline 2026 tracks. This document maps **every official qualification
requirement** (from plan §4.6) to the exact package/app and the concrete demonstration evidence.

> **Status: deployed & demonstrated on Arc testnet.** All three sponsor integrations are live: the
> `AssuranceHub` (`0xB30e054557533f28753B4ACdf646B393E2072bf9`) and `QuoteBondEscrow`
> (`0x3ca2d854d5f042dd0ddd39eaf80644be0e80048c`) contracts are deployed on Arc testnet (chain
> `5042002`); the subgraph is published to Subgraph Studio (`vouch` v0.0.2); the CRE confidential
> workflow is proven end-to-end via the official `cre workflow simulate` CLI. Every claim below traces
> to a real tx, endpoint, or captured artifact. Per the rules, no module fakes transaction success or
> hard-codes chain results. **Honest caveats are kept, deliberately** (trusted-relay testnet
> settlement, simulate ≠ on-chain attestation, Studio dev endpoint ≠ the decentralized network) — they
> are stated inline as design boundaries, not hidden.

> **Scope guardrail:** **no integrations outside these three tracks.**

**Live coordinates (Arc testnet, chain id `5042002`).** Explorer `https://testnet.arcscan.app` · RPC
`https://rpc.testnet.arc.io` · USDC `0x3600000000000000000000000000000000000000` (the **official Arc
USDC predeploy** — a 6-decimal ERC-20 view of the 18-decimal native gas asset; same funds, never two
balances) · `AssuranceHub` `0xB30e054557533f28753B4ACdf646B393E2072bf9` (deploy tx `0x72c92d8d…`) ·
`QuoteBondEscrow` `0x3ca2d854d5f042dd0ddd39eaf80644be0e80048c` (deploy tx `0x3a7cad0c…`) · deploy /
subgraph start block `61747921` · agent Circle wallet (SCA) `0x482e0a53d97b0a9be1045f58cdbf9d244bd303be`.

---

## The Graph — Best AI Tooling / AI Use Case (From Scratch) — $5,000

| Official requirement | Package / app | Demonstration evidence |
|---|---|---|
| Built **from scratch** during the event | `packages/subgraph` | `AssuranceHub` subgraph authored during the event: `subgraph.yaml`, `schema.graphql` (13 entities), 13 handlers in `src/mappings/assuranceHub.ts`. Net-new this hackathon; git history shows it created and expanded from scratch. |
| The Graph is **load-bearing** | `packages/subgraph` + `apps/agent` | The agent's risk quote is a pure function of provider history that exists **only** as indexed Graph data (`apps/agent/src/graph/client.ts` `getProviderRisk` → `risk/score.ts`). The contract stores **no** reputation aggregates on-chain (ADR-003), there is no DB mirror, and no fixture. Remove or stale the subgraph and the agent can **only refuse** — proven live in `docs/the-graph-demo.md` steps 4–5. |
| **Consume live (non-mocked) data** from a Graph provider | `apps/agent` (`src/graph/client.ts`, `src/risk/quote.ts`), `packages/shared/src/graph/client.ts` | The agent runs the real `queries/risk-agent-input.graphql` against the **live Subgraph Studio endpoint** `https://api.studio.thegraph.com/query/1760065/vouch/v0.0.2` (deployment CID `QmaoAwseMjoD3EMFwhQf3KBqqyac7sa4anpUBxK7iwEM8p`, start block `61747921`). `scripts/validate-endpoint.mjs` proves the live endpoint serves every required field. Freshness is asserted in-request (`_meta { block deployment hasIndexingErrors }` + RPC block-lag) before any read. **Sponsor-rule verdict:** querying a Studio-published subgraph with an API key **explicitly qualifies** under the official 2026 rule ("querying Subgraphs with an API key from Subgraph Studio"; "Mocked, local-only, or static datasets do not qualify"). |
| Do **meaningful AI work** (reasoning / decisions / automation) | `apps/agent` + `packages/subgraph` | The subgraph computes provider risk features as integer basis points (`upheldClaimRateBps`, `claimFrequencyBps`, `averageCoverageRatioBps`, `payoutToCoveredValueBps`) into `ProviderRiskSnapshot`; the agent combines them with a read-time trailing-window `recentFailureRateBps` and makes an autonomous, **auditable** guarantee-sizing decision (premium band stamped with `asOfBlock` + `scoringFnVersion`). Decision automation over live on-chain reputation, not a passive display. |
| **Fail closed** (no fabricated history) | `apps/agent`, `apps/api`, `packages/shared/src/graph` | When the subgraph is unavailable/lagging/stale, or the deployment id mismatches, or the RPC head is unreadable, the shared gate throws `SUBGRAPH_UNAVAILABLE`/`STALE`/`LAGGING`; the agent emits **no quote** and the API returns **503** — never a 200 with empty/fake history. A genuinely new provider (fresh index, no history) gets a documented conservative quote, distinct from "blind". |
| **Health checks** (indexing lag + latest block) | `packages/subgraph/scripts/health-check.mjs` | Queries `_meta` + `indexingStatuses` (`chainHeadBlock − latestBlock`), asserts `synced`/`healthy`/no errors/lag within budget, reports the latest indexed block, and exits non-zero when unhealthy. |
| **Matchstick tests** for every handler | `packages/subgraph/tests` | 12 passing Matchstick tests: one per handler + cross-cutting integrity (same-tx covered burst, no negative exposure, completion counting, timeout exclusion, idempotency, bps sentinel). `graph test` in CI. The agent also exposes an **MCP server** (`apps/agent/src/server/mcp.ts`) — the AI-tooling surface over this indexed data. |
| Public repo + README + **2–4 min video** | root + `docs/demo-flow.md` + `docs/the-graph-demo.md` | Public monorepo, root `README.md`, subgraph `README.md`, the video script in `docs/demo-flow.md` (The Graph segment), and the operator runbook `docs/the-graph-demo.md` (generate events → confirm indexed → query live → quote changes after an upheld claim → fail-closed on lag). |

**Why The Graph is necessary for quote generation.** Provider reputation is emitted as *minimal*
events and aggregated *only* by the subgraph (ADR-003 / ADR-006). The agent has no other source — no
on-chain aggregate, no database mirror, no fixture — so a guarantee quote is literally impossible
without live indexed Graph data, and the pipeline is designed so the only alternative to fresh data is
a refusal.

**Deployment note (resolved):** Arc testnet (`eip155:5042002`) **is** an officially Graph-supported
network — the subgraph is live on Subgraph Studio (slug `vouch`, v0.0.2), built with "Start Fresh".
The Studio dev endpoint caps at 3,000 queries/day, which is ample for the demo. Only the manifest
`network:` value changes between environments (driven via `networks.json`); deploy key / endpoint /
deployment id come from env, never hard-coded. **Honest caveat:** the Studio dev endpoint is not the
same as querying the decentralized Graph Network via a gateway — it is the qualifying path per the rule
above, but it is a single hosted endpoint, not the decentralized indexer set.

---

## Arc — Best Agentic Economy App w/ Circle Agent Stack — $3,500

$2,500 of the prize is **conditional on an Arc mainnet deploy**; the MVP is **deployed and demonstrated
on Arc testnet** (chain `5042002`, real Foundry broadcasts, status `0x1`), with mainnet as a bonus tier
only. Arc mainnet (chain `5042`) goes live Sept 16 2026; our mainnet path is **config + checklist
only** — no real-value deploy without written authorization, and the mainnet USDC predeploy is not yet
published, so it is deliberately **not** hard-coded.

| Official requirement | Package / app | Demonstration evidence |
|---|---|---|
| Functional MVP with **working frontend + backend** | `apps/web` (FE, Next.js 16) + `apps/api` (BE, NestJS 11) | Next.js dashboard served by the NestJS API: job list, guarantee state, coverage countdown, live USDC balances, tx links to `testnet.arcscan.app`. API hardened: explicit-origin CORS, `ThrottlerGuard`, fail-closed zod env, Swagger disabled on mainnet. |
| **Architecture diagram** | `docs/architecture.md` | Component/data-flow Mermaid diagram + state machine + authority model (an explicit Arc requirement; PNG export included). |
| **2–4 min demo video** | `docs/demo-flow.md` | Full on-camera script including the Arc segment (agent wallet + USDC + arcscan tx). |
| Public repo | root | Public monorepo. |
| **Declared track** | this document + root `README.md` | Track declared explicitly. |
| Genuinely **agentic** | `apps/agent` | Agent autonomously quotes guarantee size from live subgraph reputation, monitors coverage windows, and manages a policy-bound wallet — an autonomous loop, not a scripted one-shot. **Demonstrated live:** the agent's Circle wallet (`0x482e0a53d97b0a9be1045f58cdbf9d244bd303be`) posted a real 1-USDC quote-bond via `escrow.postBond` (`0x5d9d1af8…`) and refunded it (`0xd668c466…`) on Arc testnet. |
| Uses **≥1 Circle Agent Stack component** | `apps/agent` (`src/wallet/agentWallet.ts`) | Circle **Agent Wallet** via `@circle-fin/developer-controlled-wallets` (primary) with `@circle-fin/cli` as the headline Agent Stack surface. Policy-bound, **contract-execution only** (no raw transfer), per-tx/daily caps + destination allowlist. **Honest:** when unconfigured it throws `NotImplementedError` — it never fakes a tx. |
| **USDC on Arc** | `packages/contracts` (`AssuranceHub` on Arc testnet) + `apps/agent` | The `AssuranceHub` settlement contract does all accounting against the **official Arc USDC predeploy** `0x3600000000000000000000000000000000000000` (6-decimal ERC-20) — escrowed task/service fees, provider-locked guarantee collateral, and capped service-credit payouts. Live lifecycle proven on Arc testnet: covered claim on jobId 1 paid a 2-USDC guarantee (`GuaranteePaid` → `ClaimPaid`, `0x9659db91…`); no-claim jobId 3 returned 0.5 USDC on `withdrawCollateral` → `Completed` (`0x0edec39d…`). Live balances shown in the UI; tx links to arcscan. |

**Agent authority guardrail:** the agent **quotes, monitors, and posts a refundable quote bond**
(its own capital, via `QuoteBondEscrow` — ADR-008) from a policy-capped, minimal-balance wallet. It
**never** moves guarantee principal / settles payouts — settlement is the CRE receiver path (see the
Chainlink section and ADR-004). This is agent-as-transport, never agent-as-authority. **Honest
nuance:** the job→bond-release linkage is a disclosed, logged no-op (`apps/agent/src/index.ts:67-71`);
the agent is transport for its own bond only. The real USDC action + wallet lifecycle are documented in
`docs/arc-agent-stack.md`.

**Reputation loop (demonstrated live).** After the upheld claim on jobId 1 was indexed,
`lastUpheldClaimRateBps` moved (`10000` → `5000`); the agent's next quote priced it in —
`premiumBps 2000` (capped), reason `UPHELD_CLAIM_RISK`, and a lower guarantee cap. The full arc from
on-chain event → subgraph → agent re-quote is the load-bearing Graph story above, closed on Arc.

---

## Chainlink — Best Confidential Workflow — $2,000

| Official requirement | Package / app | Demonstration evidence |
|---|---|---|
| A **CRE Confidential Workflow** doing a **meaningful** part of the app | `packages/cre-workflow` | The confidential workflow runs the **private regression test** — the sole gate on the capped guarantee payout. Without it, no covered failure can ever be proven. |
| Register / use a **TEE handler** | `packages/cre-workflow` (`workflow.ts:213-224`) | The confidential handler is registered with the **real TypeScript `handlerInTee<…>`** from `@chainlink/cre-sdk@1.20.1` (verified present in the installed SDK), with the constraint `[{ tee: "nitro", regions: ["us-west-2"] }]`. No Go rewrite needed — see the updated note below. |
| Process **≥1 sensitive input / secret / private value inside the enclave** | `packages/cre-workflow` | Private regression tests, private pass/fail thresholds, and repository credentials are fetched/injected **inside the enclave** via Vault DON secrets (`{{.token}}` templating). They exist nowhere else — not in source, Postgres, onchain metadata, or the subgraph. |
| Confidential portion **meaningfully contributes to core functionality** | `packages/cre-workflow` + `packages/contracts` (`AssuranceHub` receiver) | The enclave verdict — `abi.encode(uint256 jobId, bool covered, uint256 amount)` — is the **sole trigger** for the guarantee payout via **`AssuranceHub.onReport`**, which finalizes a `ClaimPending` job. `onReport` is gated by both the **forwarder** address and the **workflow identity** decoded from packed Keystone metadata (`bytes32 workflowId \| bytes10 workflowName \| address workflowOwner`; here `workflowId = keccak256("vouch-assurance-v1")`, `workflowName = "vouchclaim"`); the contract caps the payout at `min(amount, guaranteeAmount)` and returns the remainder to the provider. |
| **Demonstrate via CRE CLI simulation or live deployment** | `packages/cre-workflow` + `docs/evidence/simulate-cli-payout.txt` | **Proven live via the official CLI:** `docs/evidence/simulate-cli-payout.txt` captures `cre workflow simulate` (cli v1.33.0) emitting **`REPORTED:PAYOUT`** — Nitro TEE sim → `getJob` (jobId 4, `ClaimPending`) → confidential fetch 200 → decide PAYOUT → consensus → dry-run `writeReport`, with the secret staying a `{{.token}}` template. Backed by 5 deterministic harness captures + a `MANIFEST` (per-file sha256); `pnpm gate:secrets` passes. **Sponsor-rule verdict:** the official rule accepts "**either** a Confidential Workflow simulation using the CRE CLI **or** a live deployment" — CRE Confidential Workflows are private beta, so **simulate is explicitly accepted** and a live enclave deploy is not required to qualify. |

### CRE §17.2 — the TypeScript SDK reality (correction verified 2026-09-11, ADR-002 §Post-review hardening)

The track wording asks to "register and use a confidential TEE handler (`handlerInTee` TS /
`cre.HandlerInTee` Go)". **The TypeScript symbol exists and is used.** `@chainlink/cre-sdk@1.20.1`
exports `handlerInTee` and `TeeRuntime` (with `reportFromDon` / `usingTheDons`), confirmed in the
installed `.d.ts`. We ship **Path A (TypeScript)**:

- `packages/cre-workflow/workflow.ts:213-224` registers the confidential handler with a real
  `handlerInTee<…>` call and a TEE constraint `[{ tee: "nitro", regions: ["us-west-2"] }]`
  (`us-west-2` is the only region the SDK's zod enum accepts in 1.20.1).
- The Vault-DON secret is injected **inside the enclave** via `ConfidentialHTTPClient` `{{.token}}`
  templating (`vaultDonSecrets`) and never touches node memory; the private pass-threshold is read
  via `getSecret`. Demonstrated via `cre workflow simulate` (and the deterministic `harness.ts`).

> **Prior revision retracted:** an earlier version of this section claimed `handlerInTee`/`TeeRuntime`
> were absent from the TS SDK and that a Go rewrite (`cre.HandlerInTee`) might be required. That is
> **stale** (true only of pre-1.x betas). **No Go path is needed.**

**Honest trust model (stated prominently, as a strength — see [`docs/security.md`](security.md) §3).**
Testnet settlement authority is a **trusted-EOA relay**: there is no canonical `KeystoneForwarder` on
Arc testnet, so there is **no on-chain DON-signature verification yet**. The TEE guarantees
**confidentiality of inputs**, not attested integrity of the output. `cre workflow simulate` is a
single local node, so it is **not** proof of on-chain delivery and **not** a Nitro attestation (the SDK
exposes none). This is a deliberate, disclosed boundary; the mainnet roadmap is the attested-DON path.

**Caveats to keep honest**: `confidential-http@1.0.0-alpha` is alpha; response confidentiality
(`encryptOutput`) is opt-in and defaults **off** (we adjudicate an *untrusted* response and declassify
only the verdict, so it is intentionally not enabled — documented, not hidden). For an **EVM-log
trigger** the CLI expects `--evm-tx-hash`/`--evm-event-index`, not `--http-payload`.

### Confidentiality boundary reminder

Runtime data, secrets, and computation are confidential from node operators — but the **source
code / binary are not**. Private test logic and criteria must therefore be **fetched at runtime**
(inside the enclave), never inlined in workflow source. Only the minimal verdict
`{jobId, regressed, amount}` is declassified back to the DON for the signed report.
