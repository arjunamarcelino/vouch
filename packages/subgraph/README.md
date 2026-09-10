# @vouch/subgraph

The Graph subgraph (built from scratch) — the authoritative provider performance/reputation
history for Vouch.

## Responsibilities
- Index `VouchCore` events (`JobCreated`, `GuaranteeLocked`, `TaskFeeReleased`, `RegressionProven`,
  `GuaranteePaid`, `GuaranteeReleased`) into `Job`, `Guarantee`, `Payout`, and `Provider` entities.
- Derive provider reputation aggregates (jobs completed, guarantees locked, regressions, total
  paid out) with idempotent counter updates.
- Serve a live GraphQL endpoint consumed by `@vouch/agent` for risk quoting.
- Drive per-network config (Arc testnet / mainnet) via `networks.json`; only `network:` changes
  between environments.

## Non-responsibilities
- Not a source of truth for financial state (that is the Arc contracts) — it derives *history*
  from onchain events.
- Never indexes raw EIP-7708 native USDC `Transfer` logs (double-count risk) — Vouch events only.
- Never stores or exposes secrets, private tests, or criteria (onchain data + GraphQL are public).
- Does not move funds or make payout decisions.
