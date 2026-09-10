import { test } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import type { Address } from "viem";
import { QuoteInvalidError } from "@vouch/shared/errors";
import type { JobRequest, QuoteCommitment } from "@vouch/shared/schemas";
import type { ProviderRiskResult } from "../graph/client";
import type { CommitmentConfig } from "../quote/commitment";
import type { StoredIntent } from "../pay/executor";
import { AgentCore, type CoreStore, type PaymentDriver, type HealthProbe } from "./core";

const SIGNER = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);
const ESCROW = "0x00000000000000000000000000000000000000ee" as Address;
const CFG: CommitmentConfig = { chainId: 5042002, verifyingContract: ESCROW, quoteTtlSeconds: 300n };
const NOW = 1_760_000_000n;

function job(): JobRequest {
  return {
    provider: "0x1111111111111111111111111111111111111111",
    payer: "0x2222222222222222222222222222222222222222",
    payee: "0x3333333333333333333333333333333333333333",
    token: "0x3600000000000000000000000000000000000000",
    taskFee: "20000000",
    requestedGuarantee: "100000000",
    providerCollateral: "100000000",
    coverageDurationSeconds: "86400",
    taskCategory: "CODE_FIX",
    verificationMethod: "PRIVATE_REGRESSION",
  };
}

const RISK: ProviderRiskResult = {
  kind: "features",
  envelope: {
    features: {
      completedJobs: "50",
      upheldClaimRateBps: "0",
      recentFailureRateBps: "0",
      averageCoverageRatioBps: "0",
      totalCoveredAmount: "0",
      totalPaidClaims: "0",
      sampleSize: "50",
      hasEnoughHistory: true,
    },
    dataConfidence: "FRESH",
    latestIndexedBlock: "1000",
    asOfBlock: "1000",
  },
} as ProviderRiskResult;

class FakeStore implements CoreStore {
  quotes = new Map<string, QuoteCommitment>();
  traces: { quoteId: string; seq: number; outcome: string; recordHash: string }[] = [];
  intents = new Map<string, StoredIntent>();
  async insertQuoteCommitment(c: QuoteCommitment) {
    this.quotes.set(c.quoteId, c);
  }
  async getQuoteCommitment(id: string) {
    return this.quotes.get(id) ?? null;
  }
  async appendTrace(t: { quoteId: string; seq: number; outcome: string; recordHash: string }) {
    this.traces.push({ quoteId: t.quoteId, seq: t.seq, outcome: t.outcome, recordHash: t.recordHash });
    return true;
  }
  async traceTip(quoteId: string) {
    const rows = this.traces.filter((t) => t.quoteId === quoteId);
    const tip = rows[rows.length - 1];
    return tip ? { seq: tip.seq, recordHash: tip.recordHash } : null;
  }
  async getIntent(key: string) {
    return this.intents.get(key) ?? null;
  }
  async listTraces(quoteId: string) {
    return this.traces.filter((t) => t.quoteId === quoteId);
  }
}

// Models the real executor's idempotency: a repeated (quoteId, action) returns the prior intent
// without a second on-chain call (dedup lives in the executor's reserve tx — review 034).
class FakePayments implements PaymentDriver {
  calls = 0;
  private byKey = new Map<string, StoredIntent>();
  async execute(req: { quoteId: string; action: "POST_BOND" | "REFUND_BOND"; amountBaseUnits: bigint; bondExpiresAt?: bigint }) {
    const key = `key-${req.quoteId}-${req.action}`;
    const seen = this.byKey.get(key);
    if (seen) return seen;
    this.calls += 1;
    const intent: StoredIntent = {
      idempotencyKey: key,
      quoteId: req.quoteId,
      action: req.action,
      amount: req.amountBaseUnits.toString(),
      destination: ESCROW,
      callData: "0xabcd",
      status: "CONFIRMED",
      providerRef: "tx-1",
      txHash: "tx-1",
      attempts: 1,
    };
    this.byKey.set(key, intent);
    return intent;
  }
}

const HEALTH: HealthProbe = { subgraphOk: async () => true, walletConfigured: () => true };

function core(store: FakeStore, payments: FakePayments) {
  let saltN = 0;
  return new AgentCore({
    getProviderRisk: async () => RISK,
    scoreParams: { baseGuaranteeCap: 100_000_000n },
    signerAccount: SIGNER,
    commitmentCfg: CFG,
    expectedSigner: SIGNER.address,
    bondAmount: 1_000_000n,
    escrowAddress: ESCROW,
    store,
    payments,
    health: HEALTH,
    now: () => NOW,
    salt: () => `salt-${saltN++}`,
  });
}

test("requestQuote scores, signs, persists, and writes a QUOTED trace (no USDC moves)", async () => {
  const store = new FakeStore();
  const payments = new FakePayments();
  const c = await core(store, payments).requestQuote(job(), "corr-1");
  assert.equal(store.quotes.size, 1);
  assert.equal(store.traces[0]!.outcome, "QUOTED");
  assert.equal(payments.calls, 0); // read-only
  assert.equal(c.nonce, c.quoteId);
});

test("verifyQuote round-trips against the original job", async () => {
  const store = new FakeStore();
  const ag = core(store, new FakePayments());
  const c = await ag.requestQuote(job(), "corr-1");
  const r = await ag.verifyQuote(c, job());
  assert.equal(r.valid, true);
});

test("executePayment POST_BOND consumes the nonce, moves the bond, and traces BOND_POSTED", async () => {
  const store = new FakeStore();
  const payments = new FakePayments();
  const ag = core(store, payments);
  const c = await ag.requestQuote(job(), "corr-1");
  const res = await ag.executePayment(c.quoteId, "POST_BOND", "corr-1");
  assert.equal(res.status, "CONFIRMED");
  assert.equal(payments.calls, 1);
  assert.ok(store.traces.some((t) => t.outcome === "BOND_POSTED"));
});

test("executePayment POST_BOND is a no-op on replay (executor idempotency)", async () => {
  const store = new FakeStore();
  const payments = new FakePayments();
  const ag = core(store, payments);
  const c = await ag.requestQuote(job(), "corr-1");
  await ag.executePayment(c.quoteId, "POST_BOND", "corr-1");
  await ag.executePayment(c.quoteId, "POST_BOND", "corr-1");
  assert.equal(payments.calls, 1); // second post did not move funds again
});

test("executePayment on an unknown quoteId throws VALIDATION_FAILED", async () => {
  const store = new FakeStore();
  const ag = core(store, new FakePayments());
  await assert.rejects(() => ag.executePayment(`0x${"9".repeat(64)}`, "POST_BOND", "c"));
});

test("expired quote at action time → QuoteInvalidError", async () => {
  const store = new FakeStore();
  let t = NOW;
  const ag = new AgentCore({
    getProviderRisk: async () => RISK,
    scoreParams: { baseGuaranteeCap: 100_000_000n },
    signerAccount: SIGNER,
    commitmentCfg: CFG,
    expectedSigner: SIGNER.address,
    bondAmount: 1_000_000n,
    escrowAddress: ESCROW,
    store,
    payments: new FakePayments(),
    health: HEALTH,
    now: () => t,
    salt: () => "s",
  });
  const c = await ag.requestQuote(job(), "corr-1");
  t = NOW + 1000n; // past expiry
  await assert.rejects(
    () => ag.executePayment(c.quoteId, "POST_BOND", "corr-1"),
    (e: unknown) => e instanceof QuoteInvalidError,
  );
});
