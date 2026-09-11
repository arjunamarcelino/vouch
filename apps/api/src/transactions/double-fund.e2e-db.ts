import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { upsertPreparedIntent, startTracking, prisma } from "@vouch/db";

/**
 * DB-backed proof of the openJob double-fund backstop: the partial-unique index
 * `UNIQUE(prepareKey) WHERE action='OPEN_JOB'` (002-api-constraints.sql) must reject a SECOND distinct
 * txHash bound to the same openJob prepare — this is what makes "one key → one funded job" enforceable
 * at the DB, not just in app logic. Runs via `pnpm --filter @vouch/api test:db`.
 */
after(async () => {
  await prisma.$disconnect();
});

const HUB = "0x1111111111111111111111111111111111111111";
const SELECTOR = "0x12345678";
const hash = (c: string) => `0x${c.repeat(64)}`;

test("second distinct txHash for the same OPEN_JOB prepareKey is rejected by the DB", async () => {
  const key = `openjob-${randomUUID()}`;
  const prepared = await upsertPreparedIntent({
    idempotencyKey: key,
    scope: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    action: "OPEN_JOB",
    functionName: "openJob",
    to: HUB,
    selector: SELECTOR,
    argsHash: hash("a"),
    chainId: 5042002,
    jobRequestId: randomUUID(),
  });

  const common = {
    preparedId: prepared.preparedId,
    prepareKey: key,
    action: "OPEN_JOB",
    chainId: 5042002,
    toAddress: HUB,
    functionSelector: SELECTOR,
  };

  // First txHash binds fine.
  await startTracking({ ...common, txHash: hash("b") });

  // A second, DISTINCT txHash under the same openJob prepareKey must collide (P2002).
  await assert.rejects(
    startTracking({ ...common, txHash: hash("c") }),
    (err: unknown) => (err as { code?: string }).code === "P2002",
    "expected a unique-constraint violation on the openJob prepareKey",
  );

  // Re-binding the SAME txHash is a benign no-op (idempotent on txHash), not a conflict.
  await startTracking({ ...common, txHash: hash("b") });
});
