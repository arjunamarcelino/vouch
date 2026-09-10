import { prisma } from "./index";
import { Prisma } from "./generated/prisma/client";

/**
 * Operational persistence for the agent's quotes, payment intents, nonces, and decision log
 * (plan §9.1). The tricky correctness properties live HERE, not in the executor:
 *
 * - **Atomic cap-reserve** (`reserveIntent`): a per-wallet advisory lock + a SUM over all
 *   NON-TERMINAL intents inside one transaction, so N concurrent intents can't each read a
 *   sub-cap total and all pass (data-integrity C1 / security H3). The SUM casts the base-unit
 *   string column with `::numeric`.
 * - **Atomic nonce consume** (`consumeNonce`): `INSERT … ON CONFLICT DO NOTHING`; a conflict is
 *   a replay — never SELECT-then-INSERT (security H2 / data-integrity H2).
 * - **Chain-linearized trace append** (`appendTrace`): the DB UNIQUE(quoteId, prevRecordHash)
 *   rejects a forked chain; callers retry against the fresh tip (data-integrity H1).
 */

export interface NewQuote {
  quoteId: string;
  jobHash: string;
  provider: string;
  scoringFnVersion: string;
  premiumBps: number;
  recommendedGuaranteeLimit: string;
  assuranceServiceFee: string;
  minProviderCollateral: string;
  confidenceLevel: string;
  reasonCodes: string[];
  signature: string;
  validAfter: bigint;
  expiresAt: bigint;
  asOfBlock: bigint;
  /** Full signed QuoteCommitment for exact reconstruction. */
  raw: Prisma.InputJsonValue;
}

export interface NewIntent {
  idempotencyKey: string;
  quoteId: string;
  action: string;
  amount: string; // base-unit integer string
  token: string;
  destination: string;
  chainId: number;
  paramsHash: string;
}

export interface SpendCaps {
  perTxCap: bigint;
  dailyCap: bigint;
  /** Stable integer key for the per-wallet advisory lock (one agent wallet → one key). */
  walletLockKey: number;
}

export type ReserveResult =
  | { ok: true; idempotencyKey: string }
  | { ok: false; reasonCodes: string[] };

export async function insertQuote(q: NewQuote): Promise<void> {
  await prisma.quote.create({ data: q });
}

/** The full stored QuoteCommitment (the `raw` column), or null. */
export async function getQuoteRaw(quoteId: string): Promise<unknown | null> {
  const row = await prisma.quote.findUnique({ where: { quoteId }, select: { raw: true } });
  return row?.raw ?? null;
}

/**
 * Reserve spend and persist the intent as `PLANNED` atomically. Returns machine-readable reason
 * codes on a policy breach instead of inserting. Idempotent on the deterministic key: if the intent
 * already exists it is returned as-is (a benign retry, not a duplicate — plan §6.4).
 */
export async function reserveIntent(intent: NewIntent, caps: SpendCaps): Promise<ReserveResult> {
  const amount = BigInt(intent.amount);
  if (amount > caps.perTxCap) return { ok: false, reasonCodes: ["PER_TX_CAP_EXCEEDED"] };

  return prisma.$transaction(async (tx) => {
    // Idempotent replay: existing intent → return it, do not re-reserve.
    const existing = await tx.paymentIntent.findUnique({
      where: { idempotencyKey: intent.idempotencyKey },
    });
    if (existing) return { ok: true, idempotencyKey: existing.idempotencyKey };

    // Serialize concurrent reservations for this wallet.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${caps.walletLockKey})`;

    // SUM over all NON-TERMINAL intents (PLANNED/SUBMITTING/SUBMITTED/CONFIRMED) — counts
    // in-flight so ambiguous retries can't breach the cap.
    const rows = await tx.$queryRaw<{ spent: string }[]>`
      SELECT COALESCE(SUM(amount::numeric), 0)::text AS spent
      FROM "PaymentIntent"
      WHERE status NOT IN ('FAILED', 'ABANDONED')`;
    const spentToday = BigInt(rows[0]?.spent ?? "0");
    if (spentToday + amount > caps.dailyCap) {
      return { ok: false, reasonCodes: ["DAILY_CAP_EXCEEDED"] };
    }

    await tx.paymentIntent.create({ data: { ...intent, status: "PLANNED", attempts: 0 } });
    return { ok: true, idempotencyKey: intent.idempotencyKey };
  });
}

/** Consume a quote's nonce atomically. Returns true if consumed, false if already used (replay). */
export async function consumeNonce(nonce: string, quoteId: string): Promise<boolean> {
  const inserted = await prisma.$executeRaw`
    INSERT INTO "UsedNonce" (nonce, "quoteId", "usedAt")
    VALUES (${nonce}, ${quoteId}, now())
    ON CONFLICT (nonce) DO NOTHING`;
  return inserted === 1;
}

export async function updateIntentStatus(
  idempotencyKey: string,
  status: string,
  fields: { providerRef?: string; txHash?: string; incrementAttempt?: boolean } = {},
): Promise<void> {
  await prisma.paymentIntent.update({
    where: { idempotencyKey },
    data: {
      status,
      ...(fields.providerRef !== undefined ? { providerRef: fields.providerRef } : {}),
      ...(fields.txHash !== undefined ? { txHash: fields.txHash } : {}),
      ...(fields.incrementAttempt ? { attempts: { increment: 1 } } : {}),
    },
  });
}

export async function getIntent(idempotencyKey: string) {
  return prisma.paymentIntent.findUnique({ where: { idempotencyKey } });
}

/** Intents needing crash reconciliation on startup (plan §6.4). */
export async function findInFlightIntents() {
  return prisma.paymentIntent.findMany({ where: { status: { in: ["SUBMITTING", "SUBMITTED"] } } });
}

export interface NewTrace {
  quoteId: string;
  seq: number;
  correlationId: string;
  outcome: string;
  reasonCodes: string[];
  scoreInputs: Record<string, string>;
  txHash?: string;
  prevRecordHash: string;
  recordHash: string;
}

/**
 * Append a decision record. The UNIQUE(quoteId, prevRecordHash)/(quoteId, seq) constraints
 * DB-enforce linearization; a fork attempt throws P2002 and the caller must retry against the
 * fresh tip (data-integrity H1).
 */
export async function appendTrace(t: NewTrace): Promise<void> {
  await prisma.decisionTrace.create({
    data: { ...t, scoreInputs: t.scoreInputs as Prisma.InputJsonValue },
  });
}

/** The current chain tip (highest seq) for a quote, or null for the genesis record. */
export async function traceTip(quoteId: string) {
  return prisma.decisionTrace.findFirst({
    where: { quoteId },
    orderBy: { seq: "desc" },
  });
}

/** The full decision chain for a quote, oldest→newest (demo/audit read surface). */
export async function listTraces(quoteId: string) {
  return prisma.decisionTrace.findMany({ where: { quoteId }, orderBy: { seq: "asc" } });
}
