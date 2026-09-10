# ADR-003 — Reputation derived in the subgraph from minimal onchain events

**Status:** Accepted

## Context

A provider's performance history — jobs completed, guarantees locked, regressions proven, total
paid out — is what makes Vouch's guarantee meaningful and what the agent needs to size risk. That
history has to be authoritative and tamper-evident, and it has to be queryable by an AI agent as
live data.

Two ways to hold it: (a) store rich reputation aggregates **onchain** in `VouchCore`, or (b) emit
**minimal events** onchain and derive the aggregates off-chain in an indexer. Storing aggregates
onchain is expensive (every counter update costs gas and bloats contract storage) and couples the
reputation schema to contract upgrades. It also does nothing for The Graph track, which requires
The Graph to be **load-bearing**.

## Decision

`VouchCore` emits **minimal events** (`JobCreated`, `GuaranteeLocked`, `TaskFeeReleased`,
`RegressionProven`, `GuaranteePaid`, `GuaranteeReleased`) carrying only `jobId`, `amount`,
`toClient`, and booleans. **The Graph subgraph derives reputation** by indexing those events into
`Job`, `Guarantee`, `Payout`, and `Provider` (the reputation aggregate) entities.

Entity/counter rules (per plan §17.4): `Provider.id` = address; `Job.id` / `Guarantee.id` /
`Payout.id` = `jobId` (one terminal payout per job, matching contract idempotency); `Job`/`Payout`
immutable, `Provider`/`Guarantee` mutable. **Counter idempotency is enforced in the mapping** —
onchain idempotency does not protect the subgraph, so counters mutate only when creating a *new*
dependent entity (`if (Payout.load(jobId) == null) { … }`). Each counter has one canonical event.

## Consequences

- **Positive:** low gas (contracts stay lean), reputation schema evolves without contract upgrades,
  and The Graph is genuinely load-bearing — the agent's risk quote is impossible without it,
  satisfying the track requirement.
- **Positive:** live, queryable GraphQL feed for the AI agent, with a `_meta` freshness guard.
- **Negative / watch-outs:** the subgraph must never index raw EIP-7708 native `Transfer` logs
  (double-count risk) — Vouch events only. Event signatures must match the ABI exactly or the
  subgraph "syncs but shows no data". Non-nullable `BigInt!` fields must be initialized to `0`
  before `.save()`. `jobsCompleted` must be defined precisely (increment on every window close,
  clean or regressed) so `regressionRate = regressions / jobsCompleted` is correct.
