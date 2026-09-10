import { test } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import type { Address } from "viem";
import type { JobRequest, QuoteCommitment } from "@vouch/shared/schemas";
import type { ProviderRiskResult } from "../graph/client";
import type { CommitmentConfig } from "../quote/commitment";
import type { StoredIntent } from "../pay/executor";
import { AgentCore, type CoreStore, type PaymentDriver, type HealthProbe } from "./core";
import { createRestServer } from "./rest";

const SIGNER = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const ESCROW = "0x00000000000000000000000000000000000000ee" as Address;
const CFG: CommitmentConfig = { chainId: 5042002, verifyingContract: ESCROW, quoteTtlSeconds: 300n };

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

const RISK = {
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

class MemStore implements CoreStore {
  q = new Map<string, QuoteCommitment>();
  traces: { quoteId: string; seq: number; recordHash: string }[] = [];
  async insertQuoteCommitment(c: QuoteCommitment) {
    this.q.set(c.quoteId, c);
  }
  async getQuoteCommitment(id: string) {
    return this.q.get(id) ?? null;
  }
  async appendTrace(t: { quoteId: string; seq: number; recordHash: string }) {
    this.traces.push({ quoteId: t.quoteId, seq: t.seq, recordHash: t.recordHash });
    return true;
  }
  async traceTip(id: string) {
    const rows = this.traces.filter((t) => t.quoteId === id);
    const tip = rows[rows.length - 1];
    return tip ? { seq: tip.seq, recordHash: tip.recordHash } : null;
  }
  async getIntent() {
    return null as StoredIntent | null;
  }
  async listTraces(id: string) {
    return this.traces.filter((t) => t.quoteId === id);
  }
}

const payments: PaymentDriver = {
  async execute() {
    return {
      idempotencyKey: "k",
      quoteId: "q",
      action: "POST_BOND",
      amount: "0",
      destination: ESCROW,
      callData: "0xabcd",
      status: "CONFIRMED",
      providerRef: null,
      txHash: null,
      attempts: 0,
    };
  },
};
const health: HealthProbe = { subgraphOk: async () => true, walletConfigured: () => false };

function server(allowManualPay = false) {
  const core = new AgentCore({
    getProviderRisk: async () => RISK,
    scoreParams: { baseGuaranteeCap: 100_000_000n },
    signerAccount: SIGNER,
    commitmentCfg: CFG,
    expectedSigner: SIGNER.address,
    bondAmount: 1_000_000n,
    escrowAddress: ESCROW,
    store: new MemStore(),
    payments,
    health,
    now: () => 1_760_000_000n,
    salt: () => "s",
  });
  return createRestServer(core, { allowManualPay });
}

test("GET /health returns subgraph + wallet status", async () => {
  const app = server();
  const res = await app.inject({ method: "GET", url: "/health" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { subgraphOk: true, walletConfigured: false });
});

test("POST /quotes returns 201 with a signed commitment", async () => {
  const app = server();
  const res = await app.inject({ method: "POST", url: "/quotes", payload: job() });
  assert.equal(res.statusCode, 201);
  const body = res.json();
  assert.match(body.quoteId, /^0x[0-9a-f]{64}$/u);
  assert.equal(body.nonce, body.quoteId);
});

test("POST /quotes with an invalid body → 400", async () => {
  const app = server();
  const res = await app.inject({ method: "POST", url: "/quotes", payload: { provider: "not-an-address" } });
  assert.equal(res.statusCode, 400);
});

test("POST /quotes/verify round-trips valid", async () => {
  const app = server();
  const created = await app.inject({ method: "POST", url: "/quotes", payload: job() });
  const commitment = created.json();
  const res = await app.inject({ method: "POST", url: "/quotes/verify", payload: { commitment, job: job() } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().valid, true);
});

test("GET /quotes/:id 404 for unknown", async () => {
  const app = server();
  const res = await app.inject({ method: "GET", url: `/quotes/0x${"9".repeat(64)}` });
  assert.equal(res.statusCode, 404);
});

test("pay route is absent unless manual pay is enabled", async () => {
  const off = server(false);
  const r1 = await off.inject({ method: "POST", url: `/quotes/x/pay`, payload: { action: "POST_BOND" } });
  assert.equal(r1.statusCode, 404);
  const on = server(true);
  const created = await on.inject({ method: "POST", url: "/quotes", payload: job() });
  const { quoteId } = created.json();
  const r2 = await on.inject({ method: "POST", url: `/quotes/${quoteId}/pay`, payload: { action: "POST_BOND" } });
  assert.equal(r2.statusCode, 200);
});
