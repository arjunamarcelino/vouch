import { prisma } from "./index";
import { Prisma } from "./generated/prisma/client";

/**
 * Operational persistence for `apps/api` (Phase 0). Encapsulates the tricky atomic patterns so the
 * Nest services never touch raw `prisma` (repo-layer convention, mirroring `quotesRepo`):
 *
 * - **Single-use nonce** (`consumeNonce`): one `UPDATE … WHERE consumed=false AND expiresAt>now()`;
 *   affected-rows === 1 is the serialization lock (two concurrent verifies can't both win).
 * - **Idempotency** (`withIdempotency`): per-scope advisory lock → `INSERT … ON CONFLICT DO NOTHING`
 *   claim → run the handler → memo the response, all in ONE `$transaction` (Stripe model; separate
 *   commits reintroduce the nonce-consumed-outside-reserve race). Caller-scoped by `(scope,route,key)`.
 * - **openJob double-fund bind** (`bindTxHashToPrepare`): a guarded `UPDATE … WHERE prepareKey binding
 *   is free`; the DB partial-unique `UNIQUE(prepareKey) WHERE action='OPEN_JOB'` is the backstop.
 *
 * `requestHash` (keccak256) and `lockKey` (a stable 63-bit bigint) are computed in apps/api (which owns
 * viem) and passed in, keeping this package dependency-free.
 */

// ---------------- profiles ----------------

export async function upsertProfile(address: string, displayName?: string, kind?: string) {
  const addr = address.toLowerCase();
  return prisma.userProfile.upsert({
    where: { address: addr },
    update: { ...(displayName !== undefined ? { displayName } : {}), ...(kind !== undefined ? { kind } : {}) },
    create: { address: addr, displayName: displayName ?? "", kind: kind ?? null },
  });
}

export async function getProfile(address: string) {
  return prisma.userProfile.findUnique({ where: { address: address.toLowerCase() } });
}

// ---------------- SIWE nonces ----------------

export async function createNonce(nonce: string, expiresAt: Date): Promise<void> {
  await prisma.siweNonce.create({ data: { nonce, expiresAt } });
}

/** Atomic single-use consume. Returns true iff THIS call flipped an unconsumed, unexpired nonce. */
export async function consumeNonce(nonce: string, address: string): Promise<boolean> {
  const { count } = await prisma.siweNonce.updateMany({
    where: { nonce, consumed: false, expiresAt: { gt: new Date() } },
    data: { consumed: true, address: address.toLowerCase(), consumedAt: new Date() },
  });
  return count === 1;
}

/** GC — delete expired nonces (call from a bounded periodic task, never per-request). */
export async function pruneExpiredNonces(): Promise<number> {
  const { count } = await prisma.siweNonce.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return count;
}

// ---------------- idempotency ----------------

export type IdempotencyOutcome<T> =
  | { kind: "run"; value: T }
  | { kind: "replay"; statusCode: number; body: unknown }
  | { kind: "conflict" } // same key, different request fingerprint (or in-flight)
  | { kind: "in_flight" };

export interface IdempotentResult {
  statusCode: number;
  body: unknown;
}

/**
 * Run `handler` exactly once per (scope, route, key). On a replay returns the memoized response; on a
 * fingerprint mismatch or an in-flight duplicate returns a conflict outcome (caller maps → 409). The
 * handler runs INSIDE the claim transaction and receives the tx client so its side-effects commit
 * atomically with the memo.
 */
export async function withIdempotency(
  args: {
    scope: string;
    route: string;
    key: string;
    requestHash: string;
    lockKey: bigint;
    expiresAt: Date;
  },
  handler: (tx: Prisma.TransactionClient) => Promise<IdempotentResult>,
): Promise<IdempotencyOutcome<IdempotentResult>> {
  return prisma.$transaction(async (tx) => {
    // Serialize identical keys so the claim + branch can't race on the composite PK.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${args.lockKey})`;

    const claimed = await tx.$queryRaw<{ scope: string }[]>`
      INSERT INTO "IdempotencyRecord" (scope, route, key, "requestHash", state, "lockedAt", "expiresAt", "createdAt")
      VALUES (${args.scope}, ${args.route}, ${args.key}, ${args.requestHash}, 'LOCKED', now(), ${args.expiresAt}, now())
      ON CONFLICT (scope, route, key) DO NOTHING
      RETURNING scope`;

    if (claimed.length === 0) {
      const row = await tx.idempotencyRecord.findUnique({
        where: { scope_route_key: { scope: args.scope, route: args.route, key: args.key } },
      });
      if (!row) return { kind: "conflict" as const }; // lost a race then vanished — treat as conflict
      if (row.requestHash !== args.requestHash) return { kind: "conflict" as const };
      if (row.state !== "COMPLETED") {
        // A crashed LOCKED claim past its lease is reclaimable; otherwise it's genuinely in-flight.
        if (row.expiresAt.getTime() > Date.now()) return { kind: "in_flight" as const };
        // Reclaim: overwrite the stale lease and fall through to run.
        await tx.idempotencyRecord.update({
          where: { scope_route_key: { scope: args.scope, route: args.route, key: args.key } },
          data: { state: "LOCKED", lockedAt: new Date(), expiresAt: args.expiresAt, requestHash: args.requestHash },
        });
      } else {
        return { kind: "replay" as const, statusCode: row.statusCode ?? 200, body: row.response };
      }
    }

    const result = await handler(tx);
    await tx.idempotencyRecord.update({
      where: { scope_route_key: { scope: args.scope, route: args.route, key: args.key } },
      data: {
        state: "COMPLETED",
        statusCode: result.statusCode,
        response: (result.body ?? null) as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    });
    return { kind: "run" as const, value: result };
  });
}

export async function pruneIdempotency(): Promise<number> {
  const { count } = await prisma.idempotencyRecord.deleteMany({
    where: {
      OR: [
        { state: "COMPLETED", createdAt: { lt: new Date(Date.now() - 72 * 3600_000) } },
        { state: "LOCKED", expiresAt: { lt: new Date() } },
      ],
    },
  });
  return count;
}

// ---------------- prepared intents / tracked transactions ----------------

export interface NewPreparedIntent {
  idempotencyKey: string;
  scope: string;
  action: string;
  functionName: string;
  to: string;
  selector: string;
  argsHash: string;
  chainId: number;
  jobRequestId?: string;
  jobId?: string;
}

/** Persist (or fetch existing) prepared intent — deterministic on the prepare's Idempotency-Key. */
export async function upsertPreparedIntent(intent: NewPreparedIntent, tx?: Prisma.TransactionClient) {
  const db = tx ?? prisma;
  return db.preparedIntent.upsert({
    where: { idempotencyKey: intent.idempotencyKey },
    update: {},
    create: {
      idempotencyKey: intent.idempotencyKey,
      scope: intent.scope.toLowerCase(),
      action: intent.action,
      functionName: intent.functionName,
      to: intent.to.toLowerCase(),
      selector: intent.selector,
      argsHash: intent.argsHash,
      chainId: intent.chainId,
      jobRequestId: intent.jobRequestId ?? null,
      jobId: intent.jobId ?? null,
    },
  });
}

export async function getPreparedIntent(preparedId: string) {
  return prisma.preparedIntent.findUnique({ where: { preparedId } });
}

export async function getPreparedByKey(idempotencyKey: string) {
  return prisma.preparedIntent.findUnique({ where: { idempotencyKey } });
}

/**
 * Begin tracking a submitted txHash, binding it to its prepared intent. For OPEN_JOB the
 * `UNIQUE(prepareKey) WHERE action='OPEN_JOB'` partial index enforces one-key→one-txHash: a second
 * distinct hash throws P2002, which the caller maps to IDEMPOTENCY_CONFLICT (the double-fund guard).
 */
export async function startTracking(args: {
  txHash: string;
  preparedId: string;
  prepareKey: string;
  action: string;
  chainId: number;
  toAddress: string;
  functionSelector: string;
  jobRequestId?: string;
  jobId?: string;
}) {
  const txHash = args.txHash.toLowerCase();
  return prisma.trackedTransaction.upsert({
    where: { txHash },
    update: {}, // tracking a known hash again is a benign no-op (idempotent on txHash)
    create: {
      txHash,
      preparedId: args.preparedId,
      prepareKey: args.prepareKey,
      action: args.action,
      chainId: args.chainId,
      toAddress: args.toAddress.toLowerCase(),
      functionSelector: args.functionSelector,
      jobRequestId: args.jobRequestId ?? null,
      jobId: args.jobId ?? null,
    },
  });
}

export async function getTrackedTx(txHash: string) {
  return prisma.trackedTransaction.findUnique({ where: { txHash: txHash.toLowerCase() } });
}

export async function updateTrackedTx(
  txHash: string,
  data: Partial<{
    status: string;
    confirmations: number;
    blockNumber: bigint;
    eventVerified: boolean;
    jobId: string;
    lastCheckedAt: Date;
  }>,
) {
  return prisma.trackedTransaction.update({ where: { txHash: txHash.toLowerCase() }, data });
}

// ---------------- feed ----------------

export async function appendFeedEvent(e: {
  kind: string;
  jobRequestId?: string;
  correlationId?: string;
  payload: Prisma.InputJsonValue;
}): Promise<void> {
  await prisma.feedEvent.create({
    data: {
      kind: e.kind,
      jobRequestId: e.jobRequestId ?? null,
      correlationId: e.correlationId ?? null,
      payload: e.payload,
    },
  });
}

export async function listFeedEvents(jobRequestId: string | undefined, limit = 100) {
  return prisma.feedEvent.findMany({
    where: jobRequestId ? { jobRequestId } : {},
    orderBy: [{ at: "desc" }, { id: "desc" }],
    take: Math.min(limit, 200),
  });
}
