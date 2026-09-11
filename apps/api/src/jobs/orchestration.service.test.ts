import { test, before } from "node:test";
import assert from "node:assert/strict";
import type { OnchainJob } from "../common/chain/chain.service";

const CLIENT = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const PROVIDER = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const USDC = "0x3600000000000000000000000000000000000000";
const HUB = "0x1111111111111111111111111111111111111111";

before(() => {
  process.env.CHAIN_ENV = "development";
});

// Stub ChainService covering the reads the guards hit. Prepare-method validation throws BEFORE build()
// (which writes a PreparedIntent), so these branches are hermetic — no DB required.
function stubChain(over: Partial<Record<string, unknown>> = {}) {
  return {
    chainId: 5042002,
    paused: async () => false,
    allowance: async () => 10_000_000n,
    usdc: async () => USDC,
    hubAddress: () => HUB,
    functionSelector: () => "0x11223344",
    encode: () => "0xdeadbeef",
    ...over,
  } as never;
}

const ctx = { address: CLIENT, idempotencyKey: "key-1" };
const validOpenJob = {
  provider: PROVIDER,
  taskFee: "20000000",
  guaranteeAmount: "100000000",
  serviceFee: "1000000",
  submissionDeadline: String(Math.floor(Date.now() / 1000) + 86400),
  coverageDuration: "86400",
  publicCriteriaHash: `0x${"0".repeat(64)}`,
  privateCriteriaCommitment: `0x${"1".repeat(64)}`,
  uiTitle: "fix auth bug",
};

test("prepareApprove rejects a zero amount", async () => {
  const { OrchestrationService } = await import("./orchestration.service");
  const svc = new OrchestrationService(stubChain());
  await assert.rejects(svc.prepareApprove(ctx, { amount: "0" }), /must be > 0/);
});

test("prepareOpenJob rejects self-dealing (provider == client)", async () => {
  const { OrchestrationService } = await import("./orchestration.service");
  const svc = new OrchestrationService(stubChain());
  await assert.rejects(svc.prepareOpenJob(ctx, { ...validOpenJob, provider: CLIENT }), /SelfDealing/);
});

test("prepareOpenJob refuses while paused", async () => {
  const { OrchestrationService } = await import("./orchestration.service");
  const svc = new OrchestrationService(stubChain({ paused: async () => true }));
  await assert.rejects(svc.prepareOpenJob(ctx, validOpenJob), /paused/);
});

test("prepareOpenJob rejects out-of-range coverage", async () => {
  const { OrchestrationService } = await import("./orchestration.service");
  const svc = new OrchestrationService(stubChain());
  await assert.rejects(svc.prepareOpenJob(ctx, { ...validOpenJob, coverageDuration: "60" }), /coverageDuration/);
});

test("prepareOpenJob gates on sufficient allowance", async () => {
  const { OrchestrationService } = await import("./orchestration.service");
  const svc = new OrchestrationService(stubChain({ allowance: async () => 0n }));
  await assert.rejects(svc.prepareOpenJob(ctx, validOpenJob), /Insufficient USDC allowance/);
});

test("prepareAcceptJob rejects a job not in Funded", async () => {
  const { OrchestrationService } = await import("./orchestration.service");
  const svc = new OrchestrationService(stubChain());
  const job = { status: "Submitted", guaranteeAmount: 1n } as OnchainJob;
  await assert.rejects(svc.prepareAcceptJob({ ...ctx, address: PROVIDER }, "1", job), /expected Funded/);
});

test("prepareWithdrawCollateral refuses while coverage is open", async () => {
  const { OrchestrationService } = await import("./orchestration.service");
  const svc = new OrchestrationService(stubChain());
  const job = { status: "InitiallyApproved", coverageEnd: BigInt(Math.floor(Date.now() / 1000) + 3600) } as OnchainJob;
  await assert.rejects(svc.prepareWithdrawCollateral({ ...ctx, address: PROVIDER }, "1", job), /Coverage window is still open/);
});
