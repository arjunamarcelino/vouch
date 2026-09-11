#!/usr/bin/env node
/**
 * DB-backed e2e harness. Provisions a throwaway Postgres database on a reachable server, pushes the
 * Prisma schema + manual constraints, runs the `*.e2e-db.ts` suite against it, then drops it.
 *
 * Connection: TEST_PG_ADMIN_URL (a maintenance DB the runner can CREATE/DROP from), default the local
 * homebrew Postgres. If no server is reachable, the harness SKIPS (exit 0) so `pnpm test` stays green
 * on machines without Postgres — the DB e2e is opt-in via `pnpm --filter @vouch/api test:db`.
 *
 * Docker-free by design (this environment's Docker daemon is down); for CI, point TEST_PG_ADMIN_URL at
 * a service Postgres or a testcontainers-provided URL.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const apiDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.dirname(path.dirname(apiDir));
// Generic default (no personal username); CI/local override via TEST_PG_ADMIN_URL. Review 064.
const adminUrl = process.env.TEST_PG_ADMIN_URL ?? "postgresql://postgres@localhost:5432/postgres";
// When set (CI), a missing/unreachable Postgres FAILS instead of a silent green skip — so a green
// pipeline actually implies the concurrency suite ran (review 064).
const requireDb = process.env.REQUIRE_DB === "1";

function psql(url, sql) {
  execFileSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-q", "-c", sql], { stdio: ["ignore", "ignore", "inherit"] });
}
function reachable(url) {
  const r = spawnSync("psql", [url, "-q", "-c", "SELECT 1"], { stdio: "ignore" });
  return r.status === 0;
}

if (!reachable(adminUrl)) {
  const msg = `[db-harness] No Postgres reachable at ${adminUrl}`;
  if (requireDb) {
    console.error(`${msg} and REQUIRE_DB=1 — FAILING (set TEST_PG_ADMIN_URL to a reachable maintenance DB).`);
    process.exit(1);
  }
  console.log(`${msg} — SKIPPING DB e2e (set REQUIRE_DB=1 in CI to make this a failure).`);
  process.exit(0);
}

const dbName = `vouch_e2e_${Date.now()}`;
const dbUrl = (() => {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  // No ?schema=public — prisma defaults to public, and libpq/psql (db:constraints) rejects that param.
  return u.toString();
})();

let created = false;
try {
  console.log(`[db-harness] creating ${dbName}`);
  psql(adminUrl, `CREATE DATABASE "${dbName}"`);
  created = true;

  const env = { ...process.env, DATABASE_URL: dbUrl };
  console.log("[db-harness] prisma db push");
  execFileSync("pnpm", ["--filter", "@vouch/db", "db:push", "--", "--skip-generate", "--accept-data-loss"], {
    cwd: repoRoot,
    env,
    stdio: "inherit",
  });

  // Create the app role so the FeedEvent REVOKE in the constraints applies; constraints are best-effort.
  try {
    psql(dbUrl, "DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='vouch_app') THEN CREATE ROLE vouch_app; END IF; END $$;");
    console.log("[db-harness] applying manual constraints");
    execFileSync("pnpm", ["--filter", "@vouch/db", "db:constraints"], { cwd: repoRoot, env, stdio: "inherit" });
  } catch {
    console.warn("[db-harness] constraints step had warnings (continuing)");
  }

  console.log("[db-harness] running e2e-db suite");
  const run = spawnSync(
    "node",
    ["--import", "@swc-node/register/esm-register", "--test", "src/**/*.e2e-db.ts"],
    { cwd: apiDir, env: { ...env, CHAIN_ENV: "development", SESSION_SECRET: "x".repeat(40) }, stdio: "inherit" },
  );
  process.exitCode = run.status ?? 1;
} finally {
  if (created) {
    console.log(`[db-harness] dropping ${dbName}`);
    try {
      psql(adminUrl, `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    } catch {
      console.warn(`[db-harness] could not drop ${dbName} (drop it manually)`);
    }
  }
}
