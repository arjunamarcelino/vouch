# @vouch/api

NestJS 11 REST API serving the Vouch dashboard.

## Responsibilities
- Expose Zod-validated REST endpoints for the web app (job orchestration, offchain metadata).
- Store **offchain operational data only** via `@vouch/db` (Prisma/Postgres): UI cache, job
  metadata, notification state, non-authoritative status mirrors.
- Read/write onchain state via viem (`chain.service.ts`) and query the subgraph
  (`graph.service.ts`).
- Structured logging (pino, with secret redaction) and explicit typed errors.

## Non-responsibilities
- **Never** the source of truth for money or reputation — that is Arc + The Graph.
- **Never** stores private tests, evaluation criteria, repository credentials, or any secret
  material in Postgres.
- Never fakes transaction success or hard-codes chain results; unconfigured paths raise explicit
  errors.
- Does not run the confidential verification (that is `@vouch/cre-workflow`) and does not settle
  payouts.
