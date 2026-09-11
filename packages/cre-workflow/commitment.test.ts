import { test } from "node:test";
import assert from "node:assert/strict";
import { size } from "viem";
import {
  buildEvidenceCommitmentPreimage,
  evidenceCommitment,
  type EvidenceCommitmentFields,
} from "./commitment";

const GOLDEN: EvidenceCommitmentFields = {
  chainId: 5042002n,
  hub: "0x00000000000000000000000000000000000000A1",
  jobId: 42n,
  covered: true,
  amount: 100_000_000n,
  evaluatedCommit:
    "0x1111111111111111111111111111111111111111111111111111111111111111",
  evaluatedAt: 1_700_000_000n,
  workflowId:
    "0x00000000000000000000000000000000000000000000000000000000deadbeef",
};

// Stable golden hash (computed from the fixed inputs above). A change here means
// the preimage schema or field order changed — update the contract side too.
const GOLDEN_HASH =
  "0xf2cd2853600d00baadc78928fb5fef80a64dfd79faa27025c2897ca75cea65df";

test("evidenceCommitment matches the golden vector", () => {
  assert.equal(evidenceCommitment(GOLDEN), GOLDEN_HASH);
});

test("preimage is the 8-field static abi.encode (256 bytes)", () => {
  // 8 static 32-byte slots.
  assert.equal(size(buildEvidenceCommitmentPreimage(GOLDEN)), 256);
});

test("preimage contains no secret sentinel strings", () => {
  const sentinels = [
    "SENTINEL_TOKEN_1a2b3c4d5e6f7081",
    "SENTINEL_THRESHOLD_9f8e7d6c5b4a3021",
    "SENTINEL_TEST_REF_deadc0debaadf00d",
    "Bearer ",
  ];
  const preimage = buildEvidenceCommitmentPreimage({
    ...GOLDEN,
    covered: false,
    amount: 0n,
  }).toLowerCase();
  for (const s of sentinels) {
    assert.equal(
      preimage.includes(s.toLowerCase()),
      false,
      `preimage must not contain sentinel ${s}`,
    );
  }
});
