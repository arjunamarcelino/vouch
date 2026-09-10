import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeAbiParameters } from "viem";
import { buildVerdictPayload, VerdictParams } from "./workflow";

test("buildVerdictPayload round-trips the (uint256,bool,uint256) verdict tuple", () => {
  const payload = buildVerdictPayload(42n, true, 100_000_000n);
  const [jobId, regressed, amount] = decodeAbiParameters(VerdictParams, payload);
  assert.equal(jobId, 42n);
  assert.equal(regressed, true);
  assert.equal(amount, 100_000_000n);
});

test("buildVerdictPayload encodes a non-regressed verdict with zero amount", () => {
  const payload = buildVerdictPayload(7n, false, 0n);
  const [jobId, regressed, amount] = decodeAbiParameters(VerdictParams, payload);
  assert.equal(jobId, 7n);
  assert.equal(regressed, false);
  assert.equal(amount, 0n);
});
