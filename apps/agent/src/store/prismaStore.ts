import {
  insertQuote,
  getQuoteRaw,
  reserveIntent as repoReserve,
  updateIntentStatus as repoUpdate,
  getIntent as repoGetIntent,
  findInFlightIntents as repoFindInFlight,
  appendTrace as repoAppendTrace,
  traceTip as repoTraceTip,
  listTraces as repoListTraces,
  Prisma,
  type SpendCaps,
} from "@vouch/db";
import { quoteCommitmentSchema, parseOrThrow, type QuoteCommitment } from "@vouch/shared/schemas";
import type { CoreStore, TraceTip } from "../server/core";
import type { IntentStore, StoredIntent, ReserveArgs, ReserveResult } from "../pay/executor";

/**
 * Postgres-backed persistence adapter (plan §9.1) implementing both the core's `CoreStore` and the
 * executor's `IntentStore` over `@vouch/db`. The agent OWNS these tables; the API/web read decision
 * traces via the agent's REST core, not by importing this repo (architecture P2).
 */
export class PrismaAgentStore implements CoreStore, IntentStore {
  constructor(private readonly caps: SpendCaps) {}

  // --- CoreStore ---
  async insertQuoteCommitment(c: QuoteCommitment): Promise<void> {
    await insertQuote({
      quoteId: c.quoteId,
      jobHash: c.jobHash,
      provider: c.score.provider,
      scoringFnVersion: c.score.scoringFnVersion,
      // Safe Number(): premiumBps is capped ≤ MAX_PREMIUM_BPS (2000), far under 2^53, and stored as an
      // Int column — this is the one non-BigInt in the money path and it is NOT a base-unit amount.
      premiumBps: Number(c.score.premiumBps),
      recommendedGuaranteeLimit: c.score.recommendedGuaranteeLimit,
      assuranceServiceFee: c.score.assuranceServiceFee,
      minProviderCollateral: c.score.minProviderCollateral,
      confidenceLevel: c.score.confidenceLevel,
      reasonCodes: c.score.reasonCodes,
      signature: c.signature,
      validAfter: BigInt(c.validAfter),
      expiresAt: BigInt(c.expiresAt),
      asOfBlock: BigInt(c.score.asOfBlock),
      // Plain JSON (commitment is all-string fields) → satisfies Prisma InputJsonValue.
      raw: JSON.parse(JSON.stringify(c)),
    });
  }

  async getQuoteCommitment(quoteId: string): Promise<QuoteCommitment | null> {
    const raw = await getQuoteRaw(quoteId);
    if (!raw) return null;
    return parseOrThrow(quoteCommitmentSchema, raw, "stored quote commitment");
  }

  async appendTrace(t: {
    quoteId: string;
    seq: number;
    correlationId: string;
    outcome: string;
    reasonCodes: string[];
    scoreInputs: Record<string, string>;
    txHash: string | null;
    prevRecordHash: string;
    recordHash: string;
  }): Promise<boolean> {
    try {
      await repoAppendTrace({
        quoteId: t.quoteId,
        seq: t.seq,
        correlationId: t.correlationId,
        outcome: t.outcome,
        reasonCodes: t.reasonCodes,
        scoreInputs: t.scoreInputs,
        txHash: t.txHash ?? undefined,
        prevRecordHash: t.prevRecordHash,
        recordHash: t.recordHash,
      });
      return true;
    } catch (err) {
      // A concurrent append lost the UNIQUE(quoteId,prevRecordHash)/(seq) race → caller retries against
      // the fresh tip (review 037). Any other error is a real failure.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return false;
      throw err;
    }
  }

  async traceTip(quoteId: string): Promise<TraceTip | null> {
    const tip = await repoTraceTip(quoteId);
    return tip ? { seq: tip.seq, recordHash: tip.recordHash } : null;
  }

  async listTraces(quoteId: string): Promise<unknown[]> {
    return repoListTraces(quoteId);
  }

  // --- IntentStore ---
  async reserveIntent(intent: ReserveArgs): Promise<ReserveResult> {
    return repoReserve(intent, this.caps);
  }

  async updateIntentStatus(
    key: string,
    status: StoredIntent["status"],
    fields?: { providerRef?: string; txHash?: string; incrementAttempt?: boolean },
  ): Promise<StoredIntent> {
    return toStoredIntent(await repoUpdate(key, status, fields));
  }

  async getIntent(key: string): Promise<StoredIntent | null> {
    const row = await repoGetIntent(key);
    return row ? toStoredIntent(row) : null;
  }

  async findInFlightIntents(): Promise<StoredIntent[]> {
    const rows = await repoFindInFlight();
    return rows.map(toStoredIntent);
  }
}

interface IntentRow {
  idempotencyKey: string;
  quoteId: string;
  action: string;
  amount: string;
  destination: string;
  callData: string;
  status: string;
  providerRef: string | null;
  txHash: string | null;
  attempts: number;
}

function toStoredIntent(r: IntentRow): StoredIntent {
  return {
    idempotencyKey: r.idempotencyKey,
    quoteId: r.quoteId,
    action: r.action as StoredIntent["action"],
    amount: r.amount,
    destination: r.destination,
    callData: r.callData,
    status: r.status as StoredIntent["status"],
    providerRef: r.providerRef,
    txHash: r.txHash,
    attempts: r.attempts,
  };
}
