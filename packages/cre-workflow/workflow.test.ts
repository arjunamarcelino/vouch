import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeAbiParameters } from "viem";
import { buildVerdictPayload, VerdictParams } from "./workflow";

const HUB = "0x00000000000000000000000000000000000000A1" as const;

test("buildVerdictPayload round-trips the (chainId,hub,jobId,covered,amount) report", () => {
  const payload = buildVerdictPayload(5042002n, HUB, 42n, true, 100_000_000n);
  const [chainId, hub, jobId, covered, amount] = decodeAbiParameters(VerdictParams, payload);
  assert.equal(chainId, 5042002n);
  assert.equal((hub as string).toLowerCase(), HUB.toLowerCase());
  assert.equal(jobId, 42n);
  assert.equal(covered, true);
  assert.equal(amount, 100_000_000n);
});

test("buildVerdictPayload encodes a not-covered verdict with zero amount", () => {
  const payload = buildVerdictPayload(5042002n, HUB, 7n, false, 0n);
  const [, , jobId, covered, amount] = decodeAbiParameters(VerdictParams, payload);
  assert.equal(jobId, 7n);
  assert.equal(covered, false);
  assert.equal(amount, 0n);
});
