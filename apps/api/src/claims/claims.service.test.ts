import { test, before } from "node:test";
import assert from "node:assert/strict";
import type { OnchainJob } from "../common/chain/chain.service";

const ZERO = `0x${"0".repeat(64)}`;
const NONZERO = `0x${"a".repeat(64)}`;

before(() => {
  process.env.CHAIN_ENV = "development";
});

function stubChain(over: Record<string, unknown> = {}) {
  return {
    chainId: 5042002,
    hubAddress: () => "0x1111111111111111111111111111111111111111",
    functionSelector: () => "0x11223344",
    encode: () => "0xdead",
    claimFiled: async () => false,
    confidentialResolution: async () => null,
    getJob: async () => ({ status: "ClaimPending" }) as OnchainJob,
    ...over,
  } as never;
}

const ctx = { address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", idempotencyKey: "k" };

test("getClaimStatus: covered verdict → COVERED_PAID with serviceCredit", async () => {
  const { ClaimsService } = await import("./claims.service");
  const svc = new ClaimsService(
    stubChain({ confidentialResolution: async () => ({ covered: true, serviceCredit: 100n, evidenceCommitment: NONZERO, evaluatedAt: 5n }) }),
  );
  assert.deepEqual(await svc.getClaimStatus("1"), { jobId: "1", status: "COVERED_PAID", serviceCredit: "100", evaluatedAt: "5" });
});

test("getClaimStatus: zero commitment → TIMED_OUT (legitimate, not malformed)", async () => {
  const { ClaimsService } = await import("./claims.service");
  const svc = new ClaimsService(
    stubChain({ confidentialResolution: async () => ({ covered: false, serviceCredit: 0n, evidenceCommitment: ZERO, evaluatedAt: 9n }) }),
  );
  assert.equal((await svc.getClaimStatus("1")).status, "TIMED_OUT");
});

test("getClaimStatus: covered=false → REJECTED_CONSUMED", async () => {
  const { ClaimsService } = await import("./claims.service");
  const svc = new ClaimsService(
    stubChain({ confidentialResolution: async () => ({ covered: false, serviceCredit: 0n, evidenceCommitment: NONZERO, evaluatedAt: 3n }) }),
  );
  assert.equal((await svc.getClaimStatus("1")).status, "REJECTED_CONSUMED");
});

test("getClaimStatus: no verdict + ClaimPending → PENDING", async () => {
  const { ClaimsService } = await import("./claims.service");
  const svc = new ClaimsService(stubChain());
  assert.equal((await svc.getClaimStatus("1")).status, "PENDING");
});

test("getClaimStatus: no verdict + latched on InitiallyApproved → REJECTED_CONSUMED", async () => {
  const { ClaimsService } = await import("./claims.service");
  const svc = new ClaimsService(
    stubChain({ getJob: async () => ({ status: "InitiallyApproved" }) as OnchainJob, claimFiled: async () => true }),
  );
  assert.equal((await svc.getClaimStatus("1")).status, "REJECTED_CONSUMED");
});

test("prepareOpenClaim rejects a job not InitiallyApproved", async () => {
  const { ClaimsService } = await import("./claims.service");
  const svc = new ClaimsService(stubChain());
  const job = { status: "Submitted", coverageEnd: 0n } as OnchainJob;
  await assert.rejects(svc.prepareOpenClaim(ctx, "1", job, { commitment: NONZERO }), /can only open on an InitiallyApproved/);
});

test("prepareOpenClaim rejects after the coverage window closed", async () => {
  const { ClaimsService } = await import("./claims.service");
  const svc = new ClaimsService(stubChain());
  const job = { status: "InitiallyApproved", coverageEnd: 1n } as OnchainJob; // long past
  await assert.rejects(svc.prepareOpenClaim(ctx, "1", job, { commitment: NONZERO }), /Coverage window has closed/);
});

test("prepareOpenClaim rejects a preimage-shaped (extra-field) body — secrets boundary", async () => {
  const { ClaimsService } = await import("./claims.service");
  const svc = new ClaimsService(stubChain());
  const job = { status: "InitiallyApproved", coverageEnd: BigInt(Math.floor(Date.now() / 1000) + 3600) } as OnchainJob;
  await assert.rejects(
    svc.prepareOpenClaim(ctx, "1", job, { commitment: NONZERO, privateTest: "secret leak attempt" }),
    /commitment/i,
  );
});
