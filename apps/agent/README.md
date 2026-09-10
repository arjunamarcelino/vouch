# @vouch/agent

Autonomous risk-quotation and job-monitoring agent. Anchors the Arc (Circle Agent Stack) and
The Graph (live-data AI use-case) tracks.

## Responsibilities
- Quote guarantee size / premium by consuming **live** subgraph reputation data (`src/risk/quote.ts`,
  `src/graph/client.ts`) — computes `regressionRate` and `payoutToGuaranteeRatio` client-side.
- Monitor coverage windows and job state via viem event subscriptions (`src/monitor/watch.ts`).
- Hold and move **minimal** USDC through a policy-bound Circle Agent Stack wallet
  (`src/wallet/agentWallet.ts`), with per-tx/daily caps + destination allowlist.
- Structured logging (pino) and a freshness guard that refuses to quote on stale/errored subgraph
  data.

## Real financial action (ADR-008)
- Posts and reclaims a **refundable quote bond** (its own capital) via `QuoteBondEscrow` from a
  policy-capped, minimal-balance Circle wallet — the prize-qualifying real USDC action on Arc. See
  `docs/arc-agent-stack.md`.

## Non-responsibilities
- **Never moves guarantee principal / payout** — that authority is the DON-signed report path (see
  ADR-004). Holding and refunding its **own** operational bond is permitted (ADR-008). Agent-as-
  transport is allowed; agent-as-authority is forbidden.
- Does **not** pay the assurance service fee (the client escrows it via `openJob`; ADR-005 §4). The
  agent only *computes* it as an advisory quote field.
- Not a source of truth for money or reputation.
- Never fabricates transaction sends; unconfigured wallet/graph paths are guarded and explicit.
- Does not run the confidential verification (that is `@vouch/cre-workflow`).
