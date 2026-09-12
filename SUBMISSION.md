# Vouch — ETHOnline 2026 Submission

> **Confidential, post-acceptance outcome assurance for AI-agent work.** A provider voluntarily backs a completed job with a capped, self-funded performance guarantee; a confidential regression test inside a TEE can prove a later covered failure and trigger a capped payout — after the fee was already validly paid.

This is the judge's guided reading path. It **indexes** the repo rather than duplicating it — the [`README.md`](README.md) has the full detail, and each claim below links to code, a transaction, or an evidence file. If you are judging a single track, jump straight to your section: [The Graph](#track-1--the-graph), [Arc / Circle Agent Stack](#track-2--arc--circle-agent-stack), [Chainlink CRE](#track-3--chainlink-cre-confidential-workflow).

---

## What Vouch is

Acceptance tests are point-in-time. AI-generated code can pass the public suite, get accepted and **paid**, and then a regression that only a **private** test catches surfaces later — at which point the fee is already released and the client has no recourse. Vouch is an **outcome-assurance protocol** (vertical: AI coding) that closes exactly that gap. A provider voluntarily posts a **capped, provider-funded performance guarantee** on a job. After the task fee is paid on public-test acceptance, a **coverage window** opens during which a **confidential regression test** (Chainlink CRE, inside a TEE) can prove a covered failure and trigger a **capped service-credit payout** to the client. Each verdict becomes onchain reputation, indexed by The Graph, that prices the provider's next quote. Vouch is **not** a marketplace, **not** general insurance, and **not** ordinary escrow.

## How it works — the canonical 6-step flow

1. **Fund.** Client funds a 20-USDC coding job (`openJob` escrows task fee + service fee).
2. **Guarantee.** Provider locks capped guarantee collateral (`acceptJob`).
3. **Accept & pay.** Public tests pass → evaluator approves → 20-USDC task fee released, and a 24-hour **coverage window** opens.
4. **Confidential check.** A confidential regression test runs inside the CRE TEE during coverage.
5. **Covered failure → payout.** A covered failure is proven → capped guarantee is paid to the client (`onReport` → `GuaranteePaid`).
6. **Reputation.** The verdict is indexed by The Graph → provider reputation updates → the next quote prices it in.

## Technical implementation

pnpm + Turborepo monorepo: **`apps/web`** (Next.js 16, Tailwind v4, shadcn/ui), **`apps/api`** (NestJS 11), **`apps/agent`** (Fastify risk agent + MCP server); packages **`contracts`** (Foundry), **`subgraph`** (The Graph), **`cre-workflow`** (Chainlink CRE), plus `shared`, `config`, `ui`, `db` (Prisma 7).

**Authority model (what is authoritative where):**

- **Money & lifecycle** → the Arc `AssuranceHub` contract (escrow, guarantee, capped + idempotent payout). Built on `ReceiverBase + AccessControl + Pausable + ReentrancyGuard`; admin is config-only (2-day timelock on forwarder/workflow changes; can never seize principal); `EVALUATOR_ROLE` does public approve/reject; the CRE receiver is the **only** claim-finalizing path. Pausable pauses entries, never exits.
- **Reputation** → The Graph, derived purely from onchain events. No onchain aggregate, no DB mirror.
- **Confidential material** → the CRE TEE is the only place private tests / criteria / repo credentials live; only a minimal verdict leaves the enclave.
- **Offchain operational only** → Postgres/Prisma (display + orchestration; rebuildable, never money or reputation).

State machine: `Funded → AcceptedByProvider → Submitted → InitiallyApproved → (ClaimPending → ClaimPaid) | Completed`, with `Cancelled` / `Expired` exits. Full diagram in [`docs/architecture.md`](docs/architecture.md).

## What makes it novel

The novelty is the **post-acceptance coverage window** combined with a **confidential trigger**. Existing patterns protect *before* payment (escrow releases on acceptance) or pool third-party premiums (insurance) or match buyers and sellers (marketplace). Vouch instead lets a validly accepted, validly *paid* job stay protected against a **later, covered failure** — and the failure is proven by a **private** test running inside a TEE, so the criteria that decide a payout never have to be disclosed. That is the thesis line the demo closes on: *"The job was validly accepted and paid — but assurance still protected the client from a later, covered failure."*

---

## Track 1 — The Graph

**Track:** Best AI Tooling / AI Use Case (net-new / "Start Fresh"). **Prize: $5,000** *(verify amounts on the live prize page).*
**Watch the demo from `1:15`** (live risk quote from indexed reputation) **and `4:20`** (re-quote rises after an upheld claim is indexed).

| Official 2026 requirement (verbatim) | How Vouch satisfies it | Evidence |
|---|---|---|
| "Use The Graph as a load-bearing part of the project" | The agent's guarantee quote is a **pure function** of indexed subgraph data (`upheldClaimRateBps`, `recentFailureRateBps`, `jobsCompleted`, …). There is no onchain aggregate, no DB mirror, and no fixture (ADR-003) — stale or remove the index and the agent can *only* refuse. | `apps/agent/src/graph/client.ts` (`getProviderRisk`) → `apps/agent/src/risk/score.ts`; [`docs/decisions/`](docs/decisions/) ADR-003 |
| "Consume live data from a Graph provider … Mocked, local-only, or static datasets do not qualify" | The subgraph is deployed to **Subgraph Studio** (slug `vouch`, v0.0.2) and queried live with an API key — the officially qualifying path. Arc testnet is a Graph-supported network (`eip155:5042002`). Every read asserts freshness via `_meta { block deployment hasIndexingErrors }` + RPC block-lag before use. | Endpoint `https://api.studio.thegraph.com/query/1760065/vouch/v0.0.2` (deployment CID `QmaoAwseMjoD3EMFwhQf3KBqqyac7sa4anpUBxK7iwEM8p`); [`docs/the-graph-demo.md`](docs/the-graph-demo.md) |
| "Do meaningful work with the data: reasoning, decisions, automation, or a natural-language interface, not just printing a raw query result" | The agent makes an autonomous, auditable **guarantee-sizing decision**: it combines indexed risk features with a read-time trailing-window failure rate to set a premium band, every quote stamped `asOfBlock` + `scoringFnVersion`. It also exposes an **MCP server** (AI-tooling surface). | `apps/agent/src/risk/score.ts`; `apps/agent/src/server/mcp.ts` |
| "Open-source … public repository plus a short demo video (two to four minutes)" | Public monorepo + a single 2–4 min human-narrated demo video. | Repo: *(see [Repository](#repository--links))*; video: *(see [Demo links](#demo-links))*; script in [`docs/demo-flow.md`](docs/demo-flow.md) |
| "Select … Start Fresh for net-new" | The subgraph is net-new this hackathon: 13 entities, 13 handlers, indexing `AssuranceHub`, authored from scratch with git history to match. Deployed under the "Start Fresh" pool. | `packages/subgraph/` (`schema.graphql`, `subgraph.yaml`, `src/`); 12 Matchstick tests in `packages/subgraph/tests`; `packages/subgraph/scripts/health-check.mjs` |

**Fail-closed guarantee.** When the subgraph is unavailable, lagging, or stale — or the deployment id mismatches — the shared gate throws `SUBGRAPH_UNAVAILABLE` / `STALE` / `LAGGING`, the agent emits **no quote**, and the API returns **503**. Never a 200 with fabricated history.

---

## Track 2 — Arc / Circle Agent Stack

**Track:** Best Agentic Economy App with the Circle Agent Stack. **Prize: $3,500 (+$2,500 Arc Mainnet bonus)** *(verify amounts on the live prize page).*
**Watch the demo from `1:55`** (agent's policy-capped Circle wallet settles real USDC on Arc) **and `2:40`** (task fee released, coverage opens).

| Official 2026 requirement (verbatim) | How Vouch satisfies it | Evidence |
|---|---|---|
| "Functional MVP with working frontend + backend" | Next.js dashboard served by the NestJS API: job list, guarantee state, coverage countdown, live USDC balances, tx links to arcscan. | `apps/web` (FE) + `apps/api` (BE); [`docs/arc-agent-stack.md`](docs/arc-agent-stack.md) |
| "Architecture diagram" | Component / data-flow diagram + state machine + authority model. | [`docs/architecture.md`](docs/architecture.md) |
| "2–4 min demo video" | Single human-narrated 2–4 min video including the Arc segment. | *(see [Demo links](#demo-links))*; script [`docs/demo-flow.md`](docs/demo-flow.md) |
| "Public repo" | Public monorepo. | *(see [Repository](#repository--links))* |
| "Genuinely agentic" | The agent autonomously quotes guarantee size from live Graph reputation, monitors coverage windows, and manages a policy-bound wallet — an autonomous loop, not a scripted one-shot. | `apps/agent/src/` |
| "Uses ≥1 Circle Agent Stack component" | Circle **Agent Wallet** via `@circle-fin/developer-controlled-wallets` — a policy-bound wallet restricted to **contract execution only** (no raw transfer), with per-tx/daily caps + destination allowlist; `@circle-fin/cli` as the headline Agent Stack surface. Honest: unconfigured, it throws `NotImplementedError` rather than faking a tx. | `apps/agent/src/wallet/agentWallet.ts`; agent SCA `0x482e0a53d97b0a9be1045f58cdbf9d244bd303be` |
| "USDC on Arc" | All settlement accounting runs in the 6-decimal ERC-20 USDC interface on Arc (official predeploy `0x3600…0000`). Real autonomous settlement shown: agent posts a reputation-priced quote-bond via `escrow.postBond` and refunds it. | postBond tx `0x5d9d1af8…`, refund `0xd668c466…` on `https://testnet.arcscan.app`; `packages/contracts` |
| "(bonus +$2,500) Arc Mainnet deployment by September 30" | Arc mainnet (chainId 5042) goes live Sept 16 2026. The mainnet path is **config + checklist only** — no real-value deploy without written authorization; the mainnet USDC predeploy is not yet published, so it is not hardcoded. | [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) mainnet checklist |

**Agent authority guardrail.** The agent is **transport, never authority**: it quotes, monitors, and posts a refundable operational quote-bond from its own policy-capped wallet. It **never** moves guarantee principal — the job→bond-release linkage is a disclosed logged no-op (`apps/agent/src/index.ts:67-71`), and the guarantee payout runs exclusively through the CRE receiver path.

---

## Track 3 — Chainlink CRE Confidential Workflow

**Track:** Best Confidential Workflow. **Prize: $2,000 (up to 2 teams)** *(verify amounts on the live prize page).*
**Watch the demo from `3:15`** (CRE confidential test runs inside the TEE; token never appears) **and `3:50`** (covered failure → capped payout).

| Official 2026 requirement (verbatim) | How Vouch satisfies it | Evidence |
|---|---|---|
| "Build a CRE Workflow that uses Confidential Workflows to execute a meaningful part of the logic" | The confidential workflow runs the **private regression test** — the sole gate on the guarantee payout. Without it, no covered failure can ever be proven. | `packages/cre-workflow/workflow.ts`; workflowId `keccak256("vouch-assurance-v1")`, name `vouchclaim` |
| "Register and use a confidential TEE handler" | Registered with the real TypeScript `handlerInTee<…>` from `@chainlink/cre-sdk@1.20.1`, with a Nitro TEE constraint `[{ tee: "nitro", regions: ["us-west-2"] }]`. | `packages/cre-workflow/workflow.ts:213-224` |
| "Process at least one sensitive input inside the enclave" | Repo token injected via Vault DON `{{.token}}` templating; private pass-threshold read via `getSecret`; private test pulled via `confidentialFetch` — all inside the enclave. Only the 7-tuple verdict is declassified. | `packages/cre-workflow/workflow.ts`; `pnpm gate:secrets` passes (secret stays a `{{.token}}` template) |
| "Meaningfully integrated into core functionality" | The enclave verdict `abi.encode(uint256 jobId, bool covered, uint256 amount)` is the **sole trigger** for the guarantee payout: `writeReport` → `AssuranceHub.onReport`, gated by forwarder address **and** packed workflow identity, caps payout at `min(amount, guaranteeAmount)` and returns the remainder to the provider. | `packages/contracts` (`AssuranceHub.onReport`); covered-claim tx `0x9659db91…` (client received 2-USDC guarantee, `GuaranteePaid`) |
| "Demonstrate successful execution via simulation or live deployment, with evidence" | `cre workflow simulate` produces `REPORTED:PAYOUT` (CLI v1.33.0): Nitro TEE sim → getJob → confidential fetch 200 → decide PAYOUT → consensus → dry-run writeReport, secret never in logs. Plus 5 deterministic harness captures + a sha256 MANIFEST. Simulation is explicitly accepted evidence (CRE Confidential Workflows are private beta). | [`docs/evidence/simulate-cli-payout.txt`](docs/evidence/simulate-cli-payout.txt); `simulate-valid-failure.txt`, `simulate-valid-pass.txt`, `simulate-invalid-commit.txt`, `simulate-replay.txt`, `simulate-timeout-error.txt`, [`MANIFEST`](docs/evidence/MANIFEST); index at [`docs/evidence/index.md`](docs/evidence/index.md) |

---

## Demo links

- **Demo video (2–4 min, human-narrated):** *TBD — link pending.*
- **Live app:** [https://withvouch.xyz](https://withvouch.xyz) *(deploying).* API `https://api.withvouch.xyz`, agent `https://agent.withvouch.xyz`. One-command local review via `docker-compose` (browse + read-live + `/health`; click-through mutation needs a funded wallet + browser wallet + SIWE).

## Repository & links

- **Repository:** *TBD — public repository link pending.*
- **Arc testnet** (chain id 5042002) — explorer [https://testnet.arcscan.app](https://testnet.arcscan.app), RPC `https://rpc.testnet.arc.io`:
  - `AssuranceHub` — `0xB30e054557533f28753B4ACdf646B393E2072bf9` (deploy tx `0x72c92d8d…`)
  - `QuoteBondEscrow` — `0x3ca2d854d5f042dd0ddd39eaf80644be0e80048c` (deploy tx `0x3a7cad0c…`)
  - USDC (official Arc predeploy) — `0x3600000000000000000000000000000000000000`
  - Deploy block / subgraph startBlock — `61747921`
  - Live lifecycle txs — covered claim `0x9659db91…`, no-claim withdraw `0x0edec39d…`, agent postBond `0x5d9d1af8…`, bond refund `0xd668c466…`
- **The Graph endpoint:** `https://api.studio.thegraph.com/query/1760065/vouch/v0.0.2` (CID `QmaoAwseMjoD3EMFwhQf3KBqqyac7sa4anpUBxK7iwEM8p`)
- **CRE evidence:** [`docs/evidence/`](docs/evidence/) (index at [`docs/evidence/index.md`](docs/evidence/index.md))

## Honest trust model

Vouch treats its limits as documented design boundaries, not omissions.

- **Settlement authority on Arc testnet is a trusted EOA relay.** There is no canonical KeystoneForwarder, so there is **no onchain DON-signature verification yet**. Verdict integrity currently rests on that relay plus the forwarder + workflow-identity gate; the mainnet roadmap is the attested-DON path.
- **The TEE guarantees confidentiality of inputs, not attested integrity of the output.** `cre workflow simulate` is a single local node — not proof of onchain delivery, and not a Nitro attestation.
- **The agent is transport, never authority.** It autonomously quotes and posts an operational quote-bond; it never auto-posts the guarantee and never moves guarantee principal.

Full model: [`docs/security.md`](docs/security.md) and [`README.md`](README.md).

## Team

*TBD — team members and roles pending.*
