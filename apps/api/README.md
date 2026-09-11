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

## Running & testing

```bash
pnpm --filter @vouch/api dev        # run the API (SWC ESM loader; emits decorator metadata)
pnpm --filter @vouch/api test       # unit tests (node:test, no infra needed)
pnpm --filter @vouch/api test:db    # DB-backed e2e — provisions a throwaway Postgres, pushes the
                                    # schema + constraints, runs *.e2e-db.ts, drops the DB
pnpm --filter @vouch/api demo       # print the canonical demo flow + integration readiness
```

`test:db` uses `TEST_PG_ADMIN_URL` (a maintenance DB it can CREATE/DROP from; defaults to the local
Postgres). It SKIPS cleanly when no Postgres is reachable, so `pnpm test` stays green without infra.
The DB e2e covers the happy paths that need a real database: the full SIWE session flow, single-use
nonce replay rejection, Stripe-style idempotency, and the openJob double-fund unique-index backstop.

## Runtime note (why SWC, no `dist`)

`dev`/`start` run `src/main.ts` through the `@swc-node/register` ESM loader (like `apps/agent` runs
from source via `tsx`) — **not** a compiled `dist`. This is deliberate: NestJS constructor injection
needs `emitDecoratorMetadata`, which esbuild/`tsx` does **not** emit but SWC does (`.swcrc`). Running
from source also avoids a monorepo-wide compile step (the internal `@vouch/*` packages are consumed as
TS source). `build` is therefore typecheck-only (`tsc --noEmit`); do not "fix" `dev`/`start` back to
`tsx` — it would silently break DI. In CI, set `REQUIRE_DB=1` so `test:db` fails (not silently skips)
when no Postgres is reachable, and point `TEST_PG_ADMIN_URL` at a service Postgres.
