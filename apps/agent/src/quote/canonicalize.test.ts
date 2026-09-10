import { test } from "node:test";
import assert from "node:assert/strict";
import type { JobRequest } from "@vouch/shared/schemas";
import { canonicalizeJob, jobHash } from "./canonicalize";

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

test("canonicalization is stable and address-case-insensitive", () => {
  const lower = job({ provider: "0xabcabcabcabcabcabcabcabcabcabcabcabcabca" });
  const upper = job({ provider: "0xABCABCABCABCABCABCABCABCABCABCABCABCABCA" });
  assert.equal(canonicalizeJob(lower), canonicalizeJob(upper));
  assert.equal(jobHash(lower), jobHash(upper));
});

test("any changed term changes the hash", () => {
  const a = jobHash(job());
  assert.notEqual(a, jobHash(job({ taskFee: "20000001" })));
  assert.notEqual(a, jobHash(job({ taskCategory: "AUDIT" })));
  assert.notEqual(a, jobHash(job({ coverageDurationSeconds: "172800" })));
});
