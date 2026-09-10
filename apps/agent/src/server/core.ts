import type { Address, LocalAccount } from "viem";
import { VouchError, QuoteInvalidError } from "@vouch/shared/errors";
import type { JobRequest, QuoteCommitment, PaymentAction, PaymentStatus } from "@vouch/shared/schemas";
import type { VerifyReasonCode } from "@vouch/shared/reasonCodes";
import { createLogger } from "@vouch/shared/logger";
import type { ProviderRiskResult } from "../graph/client";
import { scoreQuote, type ScoreParams } from "../risk/score";
import {
  buildQuoteCommitment,
  verifyQuote,
  verifyCommitmentIntegrity,
  type CommitmentConfig,
} from "../quote/commitment";
import { nextRecord, GENESIS_HASH, type TraceOutcome } from "../trace/log";
import type { StoredIntent } from "../pay/executor";

/**
 * Transport-agnostic agent core (plan §10.1) — the SINGLE source of truth behind both the REST and
 * MCP adapters. Contains NO framework types; each adapter validates its raw input with the shared zod
 * schemas and calls these methods, then maps thrown VouchErrors to HTTP/MCP errors.
 *
 * Agent-native parity (§0.6): `requestQuote` is READ-ONLY (score + sign + persist + trace — no USDC
 * moves); the bond is posted only via `executePayment` (destructive, idempotent, re-derives amount +
 * destination from agent config — inputs are data, not decisions). `verifyQuote` is PURE.
 */

const log = createLogger("agent:core");

export interface TraceTip {
  seq: number;
  recordHash: string;
}

export interface CoreStore {
  insertQuoteCommitment(c: QuoteCommitment): Promise<void>;
  getQuoteCommitment(quoteId: string): Promise<QuoteCommitment | null>;
  appendTrace(t: {
    quoteId: string;
    seq: number;
    correlationId: string;
    outcome: TraceOutcome;
    reasonCodes: string[];
    scoreInputs: Record<string, string>;
    txHash: string | null;
    prevRecordHash: string;
    recordHash: string;
  }): Promise<boolean>; // false on a chain-linearization conflict (caller retries against the tip)
  traceTip(quoteId: string): Promise<TraceTip | null>;
  getIntent(key: string): Promise<StoredIntent | null>;
  listTraces(quoteId: string): Promise<unknown[]>;
}

export interface PaymentDriver {
  execute(req: {
    quoteId: string;
    action: PaymentAction;
    amountBaseUnits: bigint;
    bondExpiresAt?: bigint;
  }): Promise<StoredIntent>;
}

export interface HealthProbe {
  /** subgraph fresh + reachable */
  subgraphOk(): Promise<boolean>;
  /** wallet configured (creds present) */
  walletConfigured(): boolean;
}

export interface CoreDeps {
  getProviderRisk(provider: string): Promise<ProviderRiskResult>;
  scoreParams: ScoreParams;
  signerAccount: LocalAccount;
  commitmentCfg: CommitmentConfig;
  expectedSigner: Address;
  bondAmount: bigint;
  escrowAddress: Address;
  store: CoreStore;
  payments: PaymentDriver;
  health: HealthProbe;
  /** injected clock (seconds) + salt for determinism/testability */
  now(): bigint;
  salt(): string;
}

export class AgentCore {
  constructor(private readonly deps: CoreDeps) {}

  /** READ-ONLY: score from live data, sign an expiring commitment, persist + trace. No USDC moves. */
  async requestQuote(job: JobRequest, correlationId: string): Promise<QuoteCommitment> {
    const result = await this.deps.getProviderRisk(job.provider);
    const score = scoreQuote(result, job, this.deps.scoreParams);
    const commitment = await buildQuoteCommitment({
      score,
      job,
      account: this.deps.signerAccount,
      cfg: this.deps.commitmentCfg,
      nowSeconds: this.deps.now(),
      salt: this.deps.salt(),
    });
    await this.deps.store.insertQuoteCommitment(commitment);
    await this.appendTrace(commitment.quoteId, correlationId, "QUOTED", score.reasonCodes, {
      premiumBps: score.premiumBps,
      exposureFactorBps: score.exposureFactorBps,
      recommendedGuaranteeLimit: score.recommendedGuaranteeLimit,
      assuranceServiceFee: score.assuranceServiceFee,
      asOfBlock: score.asOfBlock,
    });
    return commitment;
  }

  /** PURE verification — returns reason codes, never throws, never consumes the nonce. */
  async verifyQuote(
    commitment: QuoteCommitment,
    job: JobRequest,
  ): Promise<{ valid: boolean; reasonCodes: VerifyReasonCode[] }> {
    return verifyQuote({
      commitment,
      job,
      expectedSigner: this.deps.expectedSigner,
      cfg: this.deps.commitmentCfg,
      nowSeconds: this.deps.now(),
    });
  }

  /**
   * DESTRUCTIVE + idempotent: post or refund the bond for a stored quote. Amount + destination are
   * re-derived from agent config (never accepted from the caller). POST_BOND consumes the quote's nonce
   * atomically in the reserve tx (executor); a replay is a no-op.
   */
  async executePayment(
    quoteId: string,
    action: PaymentAction,
    correlationId: string,
  ): Promise<{ idempotencyKey: string; status: PaymentStatus }> {
    const commitment = await this.deps.store.getQuoteCommitment(quoteId);
    if (!commitment) throw new VouchError("VALIDATION_FAILED", `Unknown quoteId ${quoteId}`);

    if (action === "POST_BOND") {
      // Action-time integrity: signature + expiry only (agent trusts its own signed commitment; the
      // client-facing jobHash binding is checked in verifyQuote against the caller's job).
      const v = await verifyCommitmentIntegrity({
        commitment,
        expectedSigner: this.deps.expectedSigner,
        cfg: this.deps.commitmentCfg,
        nowSeconds: this.deps.now(),
      });
      if (!v.valid) throw new QuoteInvalidError(v.reasonCodes);
    }

    // The executor consumes the quote nonce ATOMICALLY inside its reserve transaction (review 034), and
    // is idempotent on the deterministic key — a replayed POST_BOND returns the existing intent, never
    // a second on-chain call.
    const intent = await this.deps.payments.execute({
      quoteId,
      action,
      amountBaseUnits: this.deps.bondAmount,
      // POST_BOND encodes the escrow's on-chain expiry from the signed commitment.
      bondExpiresAt: action === "POST_BOND" ? BigInt(commitment.expiresAt) : undefined,
    });
    // Trace is best-effort AFTER the on-chain action: a logging failure must not report a successful
    // payment as failed (review 037). The record is reconstructable and reconcile re-observes state.
    try {
      await this.appendTrace(
        quoteId,
        correlationId,
        action === "POST_BOND" ? "BOND_POSTED" : "BOND_REFUNDED",
        [],
        { action, amount: this.deps.bondAmount.toString() },
        intent.txHash,
      );
    } catch (err) {
      log.error({ quoteId, err: err instanceof Error ? err.message : String(err) }, "trace append failed post-payment");
    }
    return { idempotencyKey: intent.idempotencyKey, status: intent.status };
  }

  async getTransactionStatus(key: string): Promise<StoredIntent | null> {
    return this.deps.store.getIntent(key);
  }

  async getQuote(quoteId: string): Promise<QuoteCommitment | null> {
    return this.deps.store.getQuoteCommitment(quoteId);
  }

  /** The hash-chained decision log for a quote (demo/audit surface, plan §9). */
  async getDecisionTrace(quoteId: string): Promise<unknown[]> {
    return this.deps.store.listTraces(quoteId);
  }

  async getHealth(): Promise<{ subgraphOk: boolean; walletConfigured: boolean }> {
    return { subgraphOk: await this.deps.health.subgraphOk(), walletConfigured: this.deps.health.walletConfigured() };
  }

  /**
   * Append a decision record, retrying against the fresh tip on a concurrent-append conflict
   * (store.appendTrace returns false on a UNIQUE(quoteId,prevRecordHash)/(seq) violation — review 037).
   * The per-quote chain stays linearized; the DB constraints prevent forks.
   */
  private async appendTrace(
    quoteId: string,
    correlationId: string,
    outcome: TraceOutcome,
    reasonCodes: string[],
    scoreInputs: Record<string, string>,
    txHash: string | null = null,
  ): Promise<void> {
    for (let attempt = 0; attempt < TRACE_APPEND_RETRIES; attempt++) {
      const tip = await this.deps.store.traceTip(quoteId);
      const rec = nextRecord(tip?.recordHash ?? GENESIS_HASH, tip?.seq ?? null, {
        quoteId,
        correlationId,
        outcome,
        reasonCodes,
        scoreInputs,
        txHash,
      });
      if (await this.deps.store.appendTrace(rec)) return;
    }
    throw new VouchError("VALIDATION_FAILED", `trace append contended for ${quoteId}`);
  }
}

const TRACE_APPEND_RETRIES = 5;
