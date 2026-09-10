import type { Address, LocalAccount } from "viem";
import { VouchError, QuoteInvalidError } from "@vouch/shared/errors";
import type { JobRequest, QuoteCommitment, PaymentAction } from "@vouch/shared/schemas";
import type { VerifyReasonCode } from "@vouch/shared/reasonCodes";
import type { ProviderRiskResult } from "../graph/client";
import { scoreQuote, type ScoreParams } from "../risk/score";
import {
  buildQuoteCommitment,
  verifyQuote,
  verifyCommitmentIntegrity,
  type CommitmentConfig,
} from "../quote/commitment";
import { idempotencyKey } from "../pay/idempotency";
import { nextRecord, GENESIS_HASH, type TraceOutcome } from "../trace/log";
import type { StoredIntent } from "../pay/executor";

/**
 * Transport-agnostic agent core (plan §10.1) — the SINGLE source of truth behind both the REST and
 * MCP adapters. Contains NO framework types; each adapter validates its raw input with the shared zod
 * schemas and calls these methods, then maps thrown VouchErrors to HTTP/MCP errors.
 *
 * Agent-native parity (§0.6): `requestQuote` is READ-ONLY (score + sign + persist + trace — no USDC
 * moves); the bond is posted only via `executePayment` (destructive, idempotent, re-derives amount +
 * destination from the stored quote — inputs are data, not decisions). `verifyQuote` is PURE.
 */

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
  }): Promise<void>;
  traceTip(quoteId: string): Promise<TraceTip | null>;
  consumeNonce(nonce: string, quoteId: string): Promise<boolean>;
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
   * re-derived (never accepted from the caller). POST_BOND consumes the quote's nonce atomically at
   * action time; a replay is a no-op.
   */
  async executePayment(
    quoteId: string,
    action: PaymentAction,
    correlationId: string,
  ): Promise<{ idempotencyKey: string; status: string }> {
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
      // Consume the nonce atomically; a replayed post is a no-op.
      const fresh = await this.deps.store.consumeNonce(commitment.nonce, quoteId);
      if (!fresh) {
        const existing = await this.deps.store.getIntent(idempotencyKey(quoteId, action));
        return { idempotencyKey: idempotencyKey(quoteId, action), status: existing?.status ?? "ALREADY_POSTED" };
      }
    }

    const intent = await this.deps.payments.execute({
      quoteId,
      action,
      amountBaseUnits: this.deps.bondAmount,
      // POST_BOND encodes the escrow's on-chain expiry from the signed commitment.
      bondExpiresAt: action === "POST_BOND" ? BigInt(commitment.expiresAt) : undefined,
    });
    await this.appendTrace(
      quoteId,
      correlationId,
      action === "POST_BOND" ? "BOND_POSTED" : "BOND_REFUNDED",
      [],
      { action, amount: this.deps.bondAmount.toString() },
      intent.txHash,
    );
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

  private async appendTrace(
    quoteId: string,
    correlationId: string,
    outcome: TraceOutcome,
    reasonCodes: string[],
    scoreInputs: Record<string, string>,
    txHash: string | null = null,
  ): Promise<void> {
    const tip = await this.deps.store.traceTip(quoteId);
    const rec = nextRecord(tip?.recordHash ?? GENESIS_HASH, tip?.seq ?? null, {
      quoteId,
      correlationId,
      outcome,
      reasonCodes,
      scoreInputs,
      txHash,
    });
    await this.deps.store.appendTrace(rec);
  }
}
