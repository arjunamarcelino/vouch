---
title: "psql/libpq silently mishandles a Prisma DATABASE_URL with ?schema=public — manual constraints script no-ops"
category: database-issues
tags: [postgres, psql, libpq, prisma, dsn, connection-string, database-url, schema, constraints, migrations, monorepo]
module: packages/db, apps/api
symptom: "A `db:constraints` step that pipes `psql \"$DATABASE_URL\" -f ...sql` appears to run without error but the CHECK constraints / REVOKEs never actually apply (or psql errors with 'invalid URI query parameter: \"schema\"'). The same DATABASE_URL works fine for Prisma. Constraints silently absent → the DB is missing its last-line-of-defence guards in every environment that seeds from this script."
severity: high
date: 2026-09-11
---

# psql doesn't understand Prisma's `?schema=public` DSN param

## Symptom

Prisma's connection string carries a `?schema=` query parameter:

```
postgresql://user:pass@host:5432/vouch?schema=public
```

Prisma reads `schema` itself. But `packages/db`'s manual-constraints step hands that **same string
straight to `psql`**:

```jsonc
// packages/db/package.json
"db:constraints": "psql \"$DATABASE_URL\" -v app_role=... -f prisma/manual/001-....sql -f prisma/manual/002-....sql"
```

`schema` is **not a libpq connection parameter**. Depending on the libpq version, psql either:
- errors out with `psql: error: invalid URI query parameter: "schema"`, or
- (older/looser builds) treats the whole thing oddly and connects to the wrong target,

and in a "best-effort, continue on warning" harness the failure is **swallowed** — the script
reports success, tests that don't assert on the constraints pass, and the DB ships with **none of the
CHECK constraints or REVOKEs applied.** This was a real deployment bug: caught only because the
DB-backed e2e harness (`apps/api/test/db-harness.mjs`) provisions a throwaway Postgres and *depends*
on the constraints existing.

## Root cause

Prisma and libpq have **different DSN grammars**. `?schema=public` is a Prisma-specific extension;
libpq's URI form (`postgresql://.../db?param=value`) only accepts real connection parameters
(`sslmode`, `connect_timeout`, `application_name`, …). `schema` isn't one — libpq rejects unknown
query params. So a DSN that is valid *for Prisma* is not valid *for psql*.

Postgres defaults the active schema to `public` via `search_path` anyway, so the param is redundant
for psql — it just needs to be **absent**.

## Solution

When building a DSN to feed `psql` (or any libpq tool), **strip the `?schema=` param** — don't pass
Prisma's URL verbatim. In the e2e harness the DSN is constructed without it:

```js
// apps/api/test/db-harness.mjs
// No ?schema=public — prisma defaults to public, and libpq/psql (db:constraints) rejects that param.
const dbUrl = `postgresql://postgres@localhost:5432/${dbName}`;
const env = { ...process.env, DATABASE_URL: dbUrl };
execFileSync("pnpm", ["--filter", "@vouch/db", "db:constraints"], { cwd: repoRoot, env, stdio: "inherit" });
```

For real environments, keep **two forms of the URL** (or normalize at the point of use):
- Prisma client / `prisma db push` → the `?schema=public` form is fine.
- `psql` / `db:constraints` / any libpq CLI → the bare form with no `?schema=`.

If you must accept one env var, normalize before invoking psql — e.g. drop the query string:
`DATABASE_URL="${DATABASE_URL%%\?*}"`.

Also make the constraints step **fail loud**, not best-effort: run psql with `-v ON_ERROR_STOP=1`
and let a non-zero exit fail the pipeline, so a broken DSN can never again masquerade as "applied".

## Prevention

- **Never assume a Prisma `DATABASE_URL` is a valid psql/libpq DSN.** They diverge specifically on
  the `?schema=` param. Treat "the connection string" as two dialects, not one.
- Any `.sql` seed/constraint step run via `psql` should use `-v ON_ERROR_STOP=1` so a bad connection
  or a failed statement is a hard error — a "continue on warning" harness hides exactly this class of
  silent no-op.
- Add an assertion in your DB e2e harness that a **representative constraint actually exists** after
  the constraints step (e.g. `SELECT 1 FROM pg_constraint WHERE conname = '...'`), so a regression in
  the DSN wiring fails a test instead of shipping an unguarded DB.

## References

- Internal: `packages/db/package.json` (`db:constraints`), `packages/db/prisma/manual/002-api-constraints.sql`,
  `apps/api/test/db-harness.mjs` (DSN construction, line: "No ?schema=public …").
- libpq connection URIs (valid params): https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNSTRING
- Prisma connection URL (`schema` arg): https://www.prisma.io/docs/orm/reference/connection-urls#arguments
