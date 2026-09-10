# @vouch/web

Next.js 16 + Tailwind v4 + shadcn/ui dashboard — the client/provider-facing surface of Vouch.

## Responsibilities
- Render the dashboard: job list, job detail (guarantee, coverage countdown, tx links), and
  provider reputation pages.
- Read live onchain state via viem (`lib/viem.ts`, Arc chain from `@vouch/shared`).
- Read live reputation via the subgraph GraphQL client (`lib/graph.ts`).
- Call `@vouch/api` through a typed, Zod-validated client (`lib/api.ts`).
- Show explicit tx links to `testnet.arcscan.app` and live USDC balances.

## Non-responsibilities
- Not a source of truth for money or reputation (those live on Arc + The Graph).
- Never holds or handles secrets — only `NEXT_PUBLIC_*` values.
- Never fabricates transaction results; unconfigured integrations render an explicit "not
  configured" state.
- Does not settle payouts or move funds.
