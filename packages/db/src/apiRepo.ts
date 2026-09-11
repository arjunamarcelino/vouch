import { randomUUID } from "node:crypto";
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

export type ClaimResult =
  | { kind: "claimed"; leaseToken: string }
  | { kind: "replay"; statusCode: number; body: unknown }
  | { kind: "conflict" } // same key, different fingerprint
  | { kind: "in_flight" }; // a live (unexpired) claim under this key is still running

/**
 * Claim a key in a SHORT transaction (advisory lock + INSERT ON CONFLICT DO NOTHING). The handler runs
 * OUTSIDE this tx (interceptor calls `completeKey`/`releaseKey` after), so no DB transaction is held
 * across RPC/agent calls (performance rule).
 *
 * Every claim carries a random **lease token** (review 052): `completeKey`/`releaseKey` only act while
 * the caller still owns the row, so a concurrent reclaimer (after a lease expiry) can never clobber
 * another request's active claim → no spurious 500 / lost memo. An UNEXPIRED LOCKED duplicate returns
 * `in_flight` (409); a reclaim after the lease horizon may legitimately re-run (advisory-only handlers).
 */
export async function claimKey(args: {
  scope: string;
  route: string;
  key: string;
  requestHash: string;
  lockKey: bigint;
  expiresAt: Date;
}): Promise<ClaimResult> {
  const leaseToken = randomUUID();
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${args.lockKey})`;
    const claimed = await tx.$queryRaw<{ scope: string }[]>`
      INSERT INTO "IdempotencyRecord" (scope, route, key, "requestHash", state, "leaseToken", "lockedAt", "expiresAt", "createdAt")
      VALUES (${args.scope}, ${args.route}, ${args.key}, ${args.requestHash}, 'LOCKED', ${leaseToken}, now(), ${args.expiresAt}, now())
      ON CONFLICT (scope, route, key) DO NOTHING
      RETURNING scope`;
    if (claimed.length > 0) return { kind: "claimed" as const, leaseToken };

    const row = await tx.idempotencyRecord.findUnique({
      where: { scope_route_key: { scope: args.scope, route: args.route, key: args.key } },
    });
    if (!row) return { kind: "conflict" as const };
    if (row.requestHash !== args.requestHash) return { kind: "conflict" as const };
    if (row.state === "COMPLETED") {
      return { kind: "replay" as const, statusCode: row.statusCode ?? 200, body: row.response };
    }
    // LOCKED: in-flight unless the lease expired (crashed claim) → reclaim with a fresh token.
    if (row.expiresAt.getTime() > Date.now()) return { kind: "in_flight" as const };
    await tx.idempotencyRecord.update({
      where: { scope_route_key: { scope: args.scope, route: args.route, key: args.key } },
      data: { state: "LOCKED", leaseToken, lockedAt: new Date(), expiresAt: args.expiresAt },
    });
    return { kind: "claimed" as const, leaseToken };
  });
}

/** Memoize the response — only if THIS caller still owns the lease (else a reclaimer superseded us). */
export async function completeKey(
  scope: string,
  route: string,
  key: string,
  leaseToken: string,
  statusCode: number,
  body: unknown,
): Promise<void> {
  await prisma.idempotencyRecord.updateMany({
    where: { scope, route, key, leaseToken },
    data: { state: "COMPLETED", statusCode, response: (body ?? null) as Prisma.InputJsonValue, completedAt: new Date() },
  });
}

/** Release our own claim on handler failure (lease-fenced — never deletes a reclaimer's row). */
export async function releaseKey(scope: string, route: string, key: string, leaseToken: string): Promise<void> {
  await prisma.idempotencyRecord.deleteMany({
    where: { scope, route, key, state: "LOCKED", leaseToken },
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

/**
 * Persist (or fetch existing) prepared intent — deterministic on (scope, Idempotency-Key). Caller-scoped
 * so one caller's key can never return another caller's intent (review 053).
 */
export async function upsertPreparedIntent(intent: NewPreparedIntent, tx?: Prisma.TransactionClient) {
  const db = tx ?? prisma;
  const scope = intent.scope.toLowerCase();
  return db.preparedIntent.upsert({
    where: { scope_idempotencyKey: { scope, idempotencyKey: intent.idempotencyKey } },
    update: {},
    create: {
      idempotencyKey: intent.idempotencyKey,
      scope,
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

// ---------------- job metadata (provisional + mirror) ----------------

export async function createProvisionalJob(data: {
  clientRequestId: string;
  clientAddress: string;
  providerAddress?: string;
  uiTitle?: string;
  repoRef?: string;
}) {
  return prisma.jobMetadata.create({
    data: {
      clientRequestId: data.clientRequestId,
      clientAddress: data.clientAddress.toLowerCase(),
      providerAddress: data.providerAddress?.toLowerCase() ?? null,
      uiTitle: data.uiTitle ?? "",
      repoRef: data.repoRef ?? null,
    },
  });
}

export async function getJobMetaByRequestId(clientRequestId: string) {
  return prisma.jobMetadata.findUnique({ where: { clientRequestId } });
}

export async function getJobMetaByJobId(jobId: string) {
  return prisma.jobMetadata.findUnique({ where: { jobId } });
}

/**
 * Reconcile the provisional row to its onchain jobId. Guarded so it only sets when the row's jobId is
 * NULL or already equal — a second, DIFFERENT jobId on the same intent (a two-prepare double-fund) is
 * NOT silently overwritten; it returns 0 rows so the caller can raise DUPLICATE_JOB (review 061).
 * Returns true iff reconciled (or already equal); false on a differing-jobId conflict.
 */
export async function reconcileJobId(clientRequestId: string, jobId: string): Promise<boolean> {
  const { count } = await prisma.jobMetadata.updateMany({
    where: { clientRequestId, OR: [{ jobId: null }, { jobId }] },
    data: { jobId },
  });
  return count > 0;
}

/**
 * One-directional status mirror (display only — never read for decisions). Monotonic guard: a stale
 * poll can't regress the mirror over a newer observation.
 */
export async function mirrorJobStatus(clientRequestId: string, cachedStatus: string, syncedBlock: bigint) {
  return prisma.jobMetadata.updateMany({
    where: {
      clientRequestId,
      OR: [{ lastSyncedBlock: null }, { lastSyncedBlock: { lte: syncedBlock } }],
    },
    data: { cachedStatus, lastSyncedBlock: syncedBlock, lastSyncedAt: new Date() },
  });
}

/** Jobs where the address is client or provider (backs GET /jobs/mine). */
export async function listJobsForAddress(address: string, limit = 100) {
  const addr = address.toLowerCase();
  return prisma.jobMetadata.findMany({
    where: { OR: [{ clientAddress: addr }, { providerAddress: addr }] },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 200),
  });
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

/**
 * Participant-scoped feed: only events for jobs where `address` is the client or provider (review 054 —
 * closes the IDOR). Optionally narrowed to one `jobRequestId` (which must belong to the caller). Scoping
 * by the operational client/provider addresses is a display-authz read, never a money/state decision.
 */
export async function listFeedEventsForAddress(
  address: string,
  jobRequestId: string | undefined,
  limit = 100,
) {
  const addr = address.toLowerCase();
  const participant = { OR: [{ clientAddress: addr }, { providerAddress: addr }] };
  return prisma.feedEvent.findMany({
    where: {
      job: participant,
      ...(jobRequestId ? { jobRequestId } : {}),
    },
    orderBy: [{ at: "desc" }, { id: "desc" }],
    take: Math.min(limit, 200),
  });
}

// ---------------- demo tooling (offchain operational state ONLY) ----------------

/**
 * Truncate ONLY the API-owned offchain operational tables. NEVER touches the agent-owned financial
 * store (Quote / PaymentIntent / DecisionTrace / UsedNonce) or any onchain state. NOTE: if the
 * FeedEvent is app-level immutable (no update/delete endpoint) but NOT DB-revoked, so this DELETE runs
 * on the app role (review 060) — the reset and the append-only guard are no longer mutually exclusive.
 */
export async function resetOperationalData(): Promise<void> {
  // Order: dependents first, then JobMetadata (cascades its children), then standalone tables.
  await prisma.trackedTransaction.deleteMany({});
  await prisma.preparedIntent.deleteMany({});
  await prisma.feedEvent.deleteMany({});
  await prisma.notificationState.deleteMany({});
  await prisma.agentRunLog.deleteMany({});
  await prisma.jobMetadata.deleteMany({});
  await prisma.idempotencyRecord.deleteMany({});
  await prisma.siweNonce.deleteMany({});
  await prisma.userProfile.deleteMany({});
}

/** Seed non-financial demo metadata (profiles + a provisional job + a feed event). */
export async function seedDemoData(seed: {
  client: string;
  provider: string;
  clientRequestId: string;
  uiTitle: string;
}): Promise<void> {
  await upsertProfile(seed.client, "Demo Client", "CLIENT");
  await upsertProfile(seed.provider, "Demo Provider", "PROVIDER");
  await createProvisionalJob({
    clientRequestId: seed.clientRequestId,
    clientAddress: seed.client,
    providerAddress: seed.provider,
    uiTitle: seed.uiTitle,
  });
  await appendFeedEvent({
    kind: "JOB_CREATED",
    jobRequestId: seed.clientRequestId,
    payload: { seeded: true, uiTitle: seed.uiTitle },
  });
}
