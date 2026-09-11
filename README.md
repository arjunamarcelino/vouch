# Vouch — Confidential Outcome-Assurance Protocol

> **Status:** monorepo scaffold. Sponsor integrations are **scaffolded placeholders**, not
> completed integrations. No module fakes transaction success or hard-codes blockchain results;
> unconfigured paths surface an explicit "not configured" state.

Vouch is a confidential, post-completion **outcome-assurance protocol** for AI-agent work.
Initial vertical: **AI coding work.**

## The problem

Acceptance tests are a **point-in-time** signal. For AI coding work in particular, a change can
pass the public test suite, be accepted, and be paid for — then be revealed as defective by a
regression that only a **private** or **later-run** test can detect. Once the task fee is
released, the client has no recourse and the provider bears no consequence.

Vouch closes that gap. A **provider** voluntarily attaches a **provider-funded, capped
performance guarantee** to a job. During a **coverage window** after payment, a **confidential
test** can verify a covered failure and trigger a **predefined service-credit payout** to the
client. The verdict becomes part of the provider's **onchain performance history**.

## Product boundary — what Vouch is (and is not)

**Vouch is:**
- A protocol where **providers voluntarily** post capped collateral as a performance guarantee.
- A **confidential** verification mechanism (private tests / criteria never leak) that can prove a
  covered failure *after* payment.
- An **onchain settlement + reputation** layer: guarantees, payouts, and provider performance are
  authoritative onchain and indexed by The Graph.

**Vouch is NOT:**
- ❌ **Not a marketplace** for discovering or ranking agents/providers. We consume identity; we do
  not broker jobs.
- ❌ **Not a general insurance product.** No underwriting pools, no third-party premiums — the
  *provider* self-funds a *capped* guarantee.
- ❌ **Not ordinary escrow.** Escrow releases on acceptance; Vouch's novelty is the
  **post-acceptance coverage window** plus a **confidential** trigger.
- ❌ No integrations beyond the three selected sponsor tracks.

## Canonical example (the demo flow)

1. Client pays an AI coding provider **20 USDC** to fix an authentication bug.
2. Provider locks **100 USDC** as guarantee collateral.
3. **Public tests pass** → the 20 USDC task fee is released to the provider.
4. For the next **24 hours** (coverage window), a **private regression test** runs confidentially
   inside a TEE.
5. If that test **proves a covered regression**, the client receives the **100 USDC** guarantee.
6. The result becomes part of the provider's **onchain performance history** (indexed by The Graph).

See [`docs/demo-flow.md`](docs/demo-flow.md) for the full on-camera script.

## Monorepo layout

A `pnpm` + Turborepo monorepo. Internal packages are referenced with `workspace:*`.

| Path | Package | Responsibility |
|---|---|---|
| `apps/web` | `@vouch/web` | Next.js 16 + Tailwind v4 + shadcn/ui dashboard: jobs, guarantees, live USDC balances, provider reputation, tx links to arcscan. |
| `apps/api` | `@vouch/api` | NestJS 11 REST API serving the dashboard. **Offchain operational data only.** |
| `apps/agent` | `@vouch/agent` | Autonomous risk-quotation + job-monitoring agent. Quotes/monitors; **never settles funds.** |
| `packages/contracts` | `@vouch/contracts` | Foundry contracts (`AssuranceHub`) deployed to Arc — authoritative financial state. |
| `packages/subgraph` | `@vouch/subgraph` | The Graph subgraph (from scratch) — authoritative performance/reputation history. |
| `packages/cre-workflow` | `@vouch/cre-workflow` | Chainlink CRE Confidential Workflow (TEE). The **only** place private tests/criteria/repo creds live. |
| `packages/shared` | `@vouch/shared` | Zod schemas, types, chain constants, ABIs, logger, error types. |
| `packages/config` | `@vouch/config` | Shared TypeScript / ESLint / Prettier configuration. |
| `packages/ui` | `@vouch/ui` | shadcn/ui primitives shared across apps. |
| `packages/db` | `@vouch/db` | Prisma 7 client. **Offchain operational data only** — never money, reputation, or secrets. |

## Prize tracks (ETHOnline 2026)

Vouch targets three ETHOnline 2026 tracks. Each has an unambiguous home in the monorepo. Full
requirement-by-requirement mapping in [`docs/prize-requirements.md`](docs/prize-requirements.md).

| Track | Prize | Home in repo (brief) |
|---|---|---|
| **The Graph** — Best AI Tooling / AI Use Case (From Scratch) | $5,000 | `packages/subgraph` indexes Vouch events from scratch; `apps/agent` consumes **live** GraphQL reputation data to make risk-quotation decisions. |
| **Arc** — Best Agentic Economy App w/ Circle Agent Stack | $3,500 ($2,500 conditional on Arc **mainnet**) | `apps/agent` (Circle Agent Stack wallet + USDC), `apps/web` (FE) + `apps/api` (BE), `packages/contracts` on Arc testnet. |
| **Chainlink** — Best Confidential Workflow | $2,000 | `packages/cre-workflow` runs the private regression test inside a TEE (`handlerInTee`); the DON-signed enclave verdict is the sole **authorization** gate on the guarantee payout (settlement _outcome_ is API/relay-trusted — see the honest trust model). Walkthrough + honest trust model: [`docs/chainlink-confidential-workflow.md`](docs/chainlink-confidential-workflow.md). |

> These integrations are **scaffolded**, not complete. This README does not claim any sponsor
> integration is finished.

## Local setup

Requires **Node 22** (see `.nvmrc`) and **pnpm**. Contracts additionally require **Foundry**
(`forge`).

```bash
pnpm install

# copy env templates (no real values ship in the repo)
cp .env.example .env
cp .env.development.example .env.development
# per-environment templates: .env.arc-testnet.example, .env.arc-mainnet.example
```

Root scripts (delegate to Turborepo):

| Script | Action |
|---|---|
| `pnpm dev` | Run all apps in dev (`turbo run dev`). |
| `pnpm build` | Build all packages/apps. |
| `pnpm lint` | Lint the workspace. |
| `pnpm typecheck` | Strict TypeScript typecheck. |
| `pnpm test` | Run unit tests. |
| `pnpm test:contracts` | Run Foundry contract tests (`forge`) in `packages/contracts`. |
| `pnpm test:e2e` | Run end-to-end tests. |

> **Contracts note:** `pnpm test:contracts` shells out to **Foundry** (`forge test`). Install
> Foundry separately if you have not already.

## Authority model

This is a **non-negotiable architecture constraint**. See
[`docs/architecture.md`](docs/architecture.md) for the full treatment.

- **Onchain (Arc) + The Graph are authoritative** for all financial and performance/reputation
  state. Money moves onchain; reputation is derived by the subgraph from onchain events.
- **PostgreSQL / Prisma is offchain operational data only** — UI cache, orchestration metadata,
  notification state, non-authoritative mirrors. Rebuildable; **never** the source of truth for
  money or reputation.
- **Secrets live only inside the Chainlink CRE TEE.** Private evaluation criteria, private tests,
  and repository credentials are provisioned via the Vault DON (or `.env` for local simulation)
  and **never** touch Postgres, public onchain metadata, the subgraph, or IPFS.

## License

MIT (or as chosen — see `LICENSE`).
