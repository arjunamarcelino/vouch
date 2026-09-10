import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeAbiParameters, size } from "viem";
import {
  assertBytes32,
  buildVerdictPayload,
  VERDICT_ABI_PARAMS,
  VERDICT_PAYLOAD_BYTES,
} from "./encoding";

const HUB = "0x00000000000000000000000000000000000000A1" as const;
const COMMIT =
  "0x1111111111111111111111111111111111111111111111111111111111111111" as const;

test("7-tuple round-trips a covered PAYOUT verdict", () => {
  const payload = buildVerdictPayload({
    chainId: 5042002n,
    hub: HUB,
    jobId: 42n,
    covered: true,
    amount: 100_000_000n,
    evidenceCommitment: COMMIT,
    evaluatedAt: 1_700_000_000n,
  });
  const [chainId, hub, jobId, covered, amount, commitment, evaluatedAt] =
    decodeAbiParameters(VERDICT_ABI_PARAMS, payload);
  assert.equal(chainId, 5042002n);
  assert.equal((hub as string).toLowerCase(), HUB.toLowerCase());
  assert.equal(jobId, 42n);
  assert.equal(covered, true);
  assert.equal(amount, 100_000_000n);
  assert.equal((commitment as string).toLowerCase(), COMMIT.toLowerCase());
  assert.equal(evaluatedAt, 1_700_000_000n);
});

test("7-tuple round-trips a not-covered CLEAN_CLOSE verdict (covered=false, amount=0)", () => {
  const payload = buildVerdictPayload({
    chainId: 5042002n,
    hub: HUB,
    jobId: 7n,
    covered: false,
    amount: 0n,
    evidenceCommitment: COMMIT,
    evaluatedAt: 1n,
  });
  const [, , jobId, covered, amount] = decodeAbiParameters(
    VERDICT_ABI_PARAMS,
    payload,
  );
  assert.equal(jobId, 7n);
  assert.equal(covered, false);
  assert.equal(amount, 0n);
});

test("encoded payload is exactly 224 bytes (7 static slots, not packed)", () => {
  const payload = buildVerdictPayload({
    chainId: 1n,
    hub: HUB,
    jobId: 1n,
    covered: true,
    amount: 1n,
    evidenceCommitment: COMMIT,
    evaluatedAt: 1n,
  });
  assert.equal(size(payload), VERDICT_PAYLOAD_BYTES);
  assert.equal(size(payload), 224);
});

test("assertBytes32 rejects a wrong-length hex value", () => {
  assert.doesNotThrow(() => assertBytes32(COMMIT));
  assert.throws(() => assertBytes32("0x1234" as `0x${string}`), /32-byte/);
  assert.throws(
    () => assertBytes32(("0x" + "aa".repeat(31)) as `0x${string}`),
    /32-byte/,
  );
});

test("buildVerdictPayload rejects a non-bytes32 commitment", () => {
  assert.throws(
    () =>
      buildVerdictPayload({
        chainId: 1n,
        hub: HUB,
        jobId: 1n,
        covered: true,
        amount: 1n,
        evidenceCommitment: "0xdead" as `0x${string}`,
        evaluatedAt: 1n,
      }),
    /32-byte/,
  );
});
