# @vouch/subgraph

The Graph subgraph (built from scratch) — the authoritative provider performance/reputation history
for Vouch, and the **load-bearing** data source for the risk agent's guarantee quote.

## Responsibilities
- Index `AssuranceHub` events (`JobCreated`, `ProviderAccepted`, `DeliverableSubmitted`,
  `InitialEvaluationResolved`, `CoverageStarted`, `ClaimOpened`, `ConfidentialEvaluationResolved`,
  `ClaimTimedOut`, `GuaranteePaid`, `CollateralReleased`, `JobExpired`, `JobCancelled`,
  `ServiceFeePaid`) into the 13 entities below.
- Derive provider reputation as **integer basis points** with `BigInt` (multiply-before-divide,
  `-1` sentinel on zero denominators) — **never floating point**.
- Serve a live GraphQL endpoint consumed by `@vouch/agent` / `@vouch/api` for risk quoting.
- Drive per-network config (Arc testnet / mainnet) via `networks.json`; only `network:` changes.

## Entities (13)
- **Mutable lifecycle aggregates** (natural id, upsert): `Protocol` (hub address), `Provider`
  (address), `Client` (address), `Job` / `Coverage` / `Claim` (jobId), `ProviderDailyMetric`
  (provider ++ dayId — a manual day-bucket).
- **Immutable event records** (`txHash ++ logIndex`): `Submission`, `InitialEvaluation`,
  `ConfidentialEvaluation`, `GuaranteePayout`, `CollateralMovement`, and `ProviderRiskSnapshot`
  (`provider ++ txHash ++ logIndex`, appended on-change).

See `schema.graphql` for the per-entity id strategy and `docs/decisions/006-bps-risk-in-subgraph.md`
for the design rationale.

## Provider metrics
`jobsAccepted`, `jobsInitiallyApproved`, `jobsCompleted` (clean) / `contestedCompletions`,
`claimsOpened`, `claimsUpheld`, `claimsRejected`, `activeGuaranteeAmount` (exposed), `totalCoveredAmount`,
`totalPayoutAmount`, `lastActivityTimestamp`; derived bps on `ProviderRiskSnapshot`
(`upheldClaimRateBps`, `claimFrequencyBps`, `averageCoverageRatioBps`, `payoutToCoveredValueBps`).

## Commands
```bash
pnpm --filter @vouch/subgraph codegen           # generate types from schema + ABIs
pnpm --filter @vouch/subgraph build             # compile mappings to WASM
pnpm --filter @vouch/subgraph test              # Matchstick unit tests (every handler)
pnpm --filter @vouch/subgraph health-check      # indexing-lag health check (env-driven)
pnpm --filter @vouch/subgraph validate-endpoint # validate the live endpoint's required fields
```

## Deployment
- **Arc mainnet (`arc`)** is a first-class Subgraph Studio network → `graph deploy`.
- **`arc-testnet`** Studio support is unconfirmed → local/self-hosted `graph-node`
  (`create:local` / `deploy:local`).
- Deploy key + endpoint + deployment id come from env (`GRAPH_DEPLOY_KEY`, `SUBGRAPH_URL`,
  `SUBGRAPH_DEPLOYMENT_ID`) — never hard-coded. Fill the deployed address + block in `networks.json`.

## Non-responsibilities
- Not a source of truth for financial state (that is the Arc contracts) — it derives *history*.
- Never indexes raw EIP-7708 native USDC `Transfer` logs (double-count risk) — Vouch events only.
- Never stores or exposes secrets, private tests, or criteria.
- Does not move funds or make payout decisions.
