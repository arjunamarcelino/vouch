import { test } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import type { Address } from "viem";
import type { JobRequest } from "@vouch/shared/schemas";
import type { ProviderRiskResult } from "../graph/client";
import { scoreQuote, type ScoreParams } from "../risk/score";
import { buildQuoteCommitment, verifyQuote, type CommitmentConfig } from "./commitment";

const SIGNER = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);
const OTHER = privateKeyToAccount(
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
);

const CFG: CommitmentConfig = {
  chainId: 5042002,
  verifyingContract: "0x00000000000000000000000000000000000000ee" as Address,
  quoteTtlSeconds: 300n,
};
const PARAMS: ScoreParams = { baseGuaranteeCap: 100_000_000n };
const NOW = 1_760_000_000n;

function job(overrides: Partial<JobRequest> = {}): JobRequest {
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
    ...overrides,
  };
}

function score(j: JobRequest) {
  const result: ProviderRiskResult = {
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
  return scoreQuote(result, j, PARAMS);
}

async function build(j: JobRequest, now = NOW) {
  return buildQuoteCommitment({
    score: score(j),
    job: j,
    account: SIGNER,
    cfg: CFG,
    nowSeconds: now,
    salt: "test-salt-1",
  });
}

test("build → verify round-trip is valid; nonce == quoteId", async () => {
  const j = job();
  const c = await build(j);
  assert.equal(c.nonce, c.quoteId);
  const r = await verifyQuote({ commitment: c, job: j, expectedSigner: SIGNER.address, cfg: CFG, nowSeconds: NOW });
  assert.equal(r.valid, true);
  assert.deepEqual(r.reasonCodes, []);
});

test("expired quote → QUOTE_EXPIRED", async () => {
  const j = job();
  const c = await build(j);
  const r = await verifyQuote({
    commitment: c,
    job: j,
    expectedSigner: SIGNER.address,
    cfg: CFG,
    nowSeconds: NOW + 1000n, // past expiry (ttl 300)
  });
  assert.equal(r.valid, false);
  assert.ok(r.reasonCodes.includes("QUOTE_EXPIRED"));
});

test("not-yet-valid quote → QUOTE_NOT_YET_VALID", async () => {
  const j = job();
  const c = await build(j);
  const r = await verifyQuote({ commitment: c, job: j, expectedSigner: SIGNER.address, cfg: CFG, nowSeconds: NOW - 10n });
  assert.ok(r.reasonCodes.includes("QUOTE_NOT_YET_VALID"));
});

test("altered job parameter → JOB_PARAMS_ALTERED", async () => {
  const j = job();
  const c = await build(j);
  const tampered = job({ requestedGuarantee: "999999999" });
  const r = await verifyQuote({ commitment: c, job: tampered, expectedSigner: SIGNER.address, cfg: CFG, nowSeconds: NOW });
  assert.equal(r.valid, false);
  assert.ok(r.reasonCodes.includes("JOB_PARAMS_ALTERED"));
});

test("wrong expected signer → BAD_SIGNER", async () => {
  const j = job();
  const c = await build(j);
  const r = await verifyQuote({ commitment: c, job: j, expectedSigner: OTHER.address, cfg: CFG, nowSeconds: NOW });
  assert.equal(r.valid, false);
  assert.ok(r.reasonCodes.includes("BAD_SIGNER"));
});

test("chain / verifyingContract mismatch → BAD_SIGNER (domain is part of the signature)", async () => {
  const j = job();
  const c = await build(j);
  const wrongChain: CommitmentConfig = { ...CFG, chainId: 1 };
  const r = await verifyQuote({ commitment: c, job: j, expectedSigner: SIGNER.address, cfg: wrongChain, nowSeconds: NOW });
  assert.ok(r.reasonCodes.includes("BAD_SIGNER"));
});

test("distinct salts yield distinct quoteIds for identical requests", async () => {
  const j = job();
  const c1 = await buildQuoteCommitment({ score: score(j), job: j, account: SIGNER, cfg: CFG, nowSeconds: NOW, salt: "a" });
  const c2 = await buildQuoteCommitment({ score: score(j), job: j, account: SIGNER, cfg: CFG, nowSeconds: NOW, salt: "b" });
  assert.notEqual(c1.quoteId, c2.quoteId);
});
