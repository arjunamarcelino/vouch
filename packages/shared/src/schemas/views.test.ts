import { test } from "node:test";
import assert from "node:assert/strict";
import {
  jobViewSchema,
  myJobSchema,
  claimStatusViewSchema,
  providerPerformanceSchema,
  integrationsHealthSchema,
  feedItemSchema,
  allowanceViewSchema,
  profileViewSchema,
  authMeSchema,
  apiErrorEnvelopeSchema,
} from "./views";

const ADDR = "0x1111111111111111111111111111111111111111";
const ADDR2 = "0x2222222222222222222222222222222222222222";

test("jobViewSchema accepts the real /jobs/:id chain body", () => {
  const v = jobViewSchema.parse({
    jobId: "7",
    source: "chain",
    status: "InitiallyApproved",
    client: ADDR,
    provider: ADDR2,
    taskFee: "20000000",
    guaranteeAmount: "100000000",
    serviceFee: "0",
    coverageEnd: "1757600000",
    submissionDeadline: "1757000000",
  });
  assert.equal(v.status, "InitiallyApproved");
  assert.equal(v.source, "chain");
});

test("jobViewSchema rejects a JS-number money field (must be a base-unit string)", () => {
  assert.throws(() =>
    jobViewSchema.parse({
      jobId: "1",
      source: "chain",
      status: "Funded",
      client: ADDR,
      provider: ADDR2,
      taskFee: 20000000,
      guaranteeAmount: "0",
      serviceFee: "0",
      coverageEnd: "0",
      submissionDeadline: "0",
    }),
  );
});

test("jobViewSchema rejects an unknown lifecycle status", () => {
  assert.throws(() =>
    jobViewSchema.parse({
      jobId: "1",
      source: "chain",
      status: "Frozen",
      client: ADDR,
      provider: ADDR2,
      taskFee: "0",
      guaranteeAmount: "0",
      serviceFee: "0",
      coverageEnd: "0",
      submissionDeadline: "0",
    }),
  );
});

test("myJobSchema coerces createdAt and allows null jobId/uiTitle", () => {
  const v = myJobSchema.parse({
    clientRequestId: "req-1",
    jobId: null,
    uiTitle: null,
    role: "client",
    cachedStatus: null,
    createdAt: "2026-09-11T00:00:00.000Z",
  });
  assert.ok(v.createdAt instanceof Date);
});

test("claimStatusViewSchema: PENDING without optional fields; COVERED_PAID with credit", () => {
  assert.equal(claimStatusViewSchema.parse({ jobId: "1", status: "PENDING" }).status, "PENDING");
  const paid = claimStatusViewSchema.parse({
    jobId: "1",
    status: "COVERED_PAID",
    serviceCredit: "100000000",
    evaluatedAt: "1757600000",
  });
  assert.equal(paid.serviceCredit, "100000000");
});

test("providerPerformanceSchema accepts the -1 ratio sentinel", () => {
  const v = providerPerformanceSchema.parse({
    id: ADDR,
    jobsCompleted: "3",
    jobsInitiallyApproved: "4",
    claimsUpheld: "1",
    claimsRejected: "0",
    totalPayoutAmount: "100000000",
    activeGuaranteeAmount: "0",
    lastUpheldClaimRateBps: "-1",
  });
  assert.equal(v.lastUpheldClaimRateBps, "-1");
});

test("integrationsHealthSchema parses the probe report", () => {
  const v = integrationsHealthSchema.parse({
    status: "ok",
    probes: [
      { name: "arc-rpc", status: "up", critical: true, latencyMs: 42, detail: { chainId: 5042002 } },
      { name: "agent", status: "degraded", critical: false, latencyMs: 5, error: "timeout" },
    ],
  });
  assert.equal(v.probes.length, 2);
});

test("feedItemSchema coerces `at` and tolerates an arbitrary kind + null refs", () => {
  const v = feedItemSchema.parse({
    id: "f1",
    kind: "SOME_FUTURE_KIND",
    jobRequestId: null,
    correlationId: null,
    payload: { foo: "bar" },
    at: "2026-09-11T00:00:00.000Z",
  });
  assert.ok(v.at instanceof Date);
});

test("allowanceView / profileView / authMe / errorEnvelope shapes", () => {
  assert.equal(
    allowanceViewSchema.parse({ owner: ADDR, spender: ADDR2, allowance: "0" }).allowance,
    "0",
  );
  assert.equal(
    profileViewSchema.parse({ address: ADDR, displayName: "", kind: null }).kind,
    null,
  );
  assert.deepEqual(authMeSchema.parse({ address: ADDR, roles: ["CLIENT"], displayName: "" }).roles, [
    "CLIENT",
  ]);
  assert.equal(
    apiErrorEnvelopeSchema.parse({ error: "STATE_CONFLICT", message: "Job is Funded" }).error,
    "STATE_CONFLICT",
  );
});
