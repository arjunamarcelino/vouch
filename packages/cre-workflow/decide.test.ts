import { test } from "node:test";
import assert from "node:assert/strict";
import { CLAIM_PENDING, decideVerdict, type DecideInput } from "./decide";

const COMMIT =
  "0x1111111111111111111111111111111111111111111111111111111111111111" as const;
const OTHER =
  "0x2222222222222222222222222222222222222222222222222222222222222222" as const;

function base(overrides: Partial<DecideInput> = {}): DecideInput {
  return {
    status: CLAIM_PENDING,
    failureCode: "REGRESSION", // default: covered failure (passRate 0.4 < 0.9)
    passRate: 0.4,
    threshold: 0.9,
    commitHash: COMMIT,
    submissionCommitment: COMMIT,
    ...overrides,
  };
}

test("status != ClaimPending -> REFUSE NOT_CLAIM_PENDING", () => {
  const v = decideVerdict(base({ status: 4 }));
  assert.deepEqual(v, { kind: "REFUSE", reason: "NOT_CLAIM_PENDING" });
});

test("NaN threshold -> REFUSE SECRET_MISSING (never CLEAN_CLOSE)", () => {
  const v = decideVerdict(base({ threshold: Number.NaN }));
  assert.deepEqual(v, { kind: "REFUSE", reason: "SECRET_MISSING" });
});

test("threshold > 1 -> REFUSE SECRET_MISSING (never all-PAYOUT)", () => {
  // A misprovisioned threshold of 90 (meant as 90%) would otherwise make every
  // passRate <= 1 a covered PAYOUT. Must fail closed. (todo 045)
  assert.deepEqual(decideVerdict(base({ threshold: 90 })), {
    kind: "REFUSE",
    reason: "SECRET_MISSING",
  });
});

test("threshold <= 0 -> REFUSE SECRET_MISSING (never all-CLEAN_CLOSE)", () => {
  assert.deepEqual(decideVerdict(base({ threshold: 0 })), {
    kind: "REFUSE",
    reason: "SECRET_MISSING",
  });
  assert.deepEqual(decideVerdict(base({ threshold: -0.5 })), {
    kind: "REFUSE",
    reason: "SECRET_MISSING",
  });
});

test("non-finite passRate -> REFUSE MALFORMED_RESPONSE", () => {
  const v = decideVerdict(base({ passRate: Number.POSITIVE_INFINITY }));
  assert.deepEqual(v, { kind: "REFUSE", reason: "MALFORMED_RESPONSE" });
});

test("out-of-range passRate (>1) -> REFUSE MALFORMED_RESPONSE", () => {
  assert.deepEqual(decideVerdict(base({ passRate: 1.5 })), {
    kind: "REFUSE",
    reason: "MALFORMED_RESPONSE",
  });
  assert.deepEqual(decideVerdict(base({ passRate: -0.1 })), {
    kind: "REFUSE",
    reason: "MALFORMED_RESPONSE",
  });
});

test("commitHash != submissionCommitment -> REFUSE COMMIT_MISMATCH", () => {
  const v = decideVerdict(base({ commitHash: OTHER }));
  assert.deepEqual(v, { kind: "REFUSE", reason: "COMMIT_MISMATCH" });
});

test("commit compare is case-insensitive", () => {
  const v = decideVerdict(
    base({ commitHash: COMMIT.toUpperCase().replace("0X", "0x") as `0x${string}` }),
  );
  // upper-cased hex of the same value must still MATCH (not COMMIT_MISMATCH)
  assert.notEqual(v.kind, "REFUSE");
});

test("NONE + definitive clean (passRate >= threshold) -> CLEAN_CLOSE (covered=false)", () => {
  const v = decideVerdict(base({ failureCode: "NONE", passRate: 0.95, threshold: 0.9 }));
  assert.deepEqual(v, { kind: "CLEAN_CLOSE", covered: false });
});

test("NONE + boundary passRate == threshold -> CLEAN_CLOSE", () => {
  const v = decideVerdict(base({ failureCode: "NONE", passRate: 0.9, threshold: 0.9 }));
  assert.deepEqual(v, { kind: "CLEAN_CLOSE", covered: false });
});

test("REGRESSION + confident covered failure (passRate < threshold) -> PAYOUT", () => {
  const v = decideVerdict(base({ failureCode: "REGRESSION", passRate: 0.42, threshold: 0.9 }));
  assert.deepEqual(v, { kind: "PAYOUT", covered: true });
});

test("BUILD failure with low passRate -> PAYOUT (a build failure is a covered failure)", () => {
  const v = decideVerdict(base({ failureCode: "BUILD", passRate: 0.1, threshold: 0.9 }));
  assert.deepEqual(v, { kind: "PAYOUT", covered: true });
});

test("TIMEOUT -> REFUSE INCONCLUSIVE (degraded evaluation, regardless of passRate)", () => {
  assert.deepEqual(decideVerdict(base({ failureCode: "TIMEOUT", passRate: 0.1 })), {
    kind: "REFUSE",
    reason: "INCONCLUSIVE",
  });
});

test("OTHER -> REFUSE INCONCLUSIVE", () => {
  assert.deepEqual(decideVerdict(base({ failureCode: "OTHER", passRate: 0.95 })), {
    kind: "REFUSE",
    reason: "INCONCLUSIVE",
  });
});

test("NONE but passRate < threshold (contradiction) -> REFUSE INCONCLUSIVE (never burns claim silently)", () => {
  assert.deepEqual(decideVerdict(base({ failureCode: "NONE", passRate: 0.1, threshold: 0.9 })), {
    kind: "REFUSE",
    reason: "INCONCLUSIVE",
  });
});

test("REGRESSION but passRate >= threshold (contradiction) -> REFUSE INCONCLUSIVE (never bad PAYOUT)", () => {
  assert.deepEqual(decideVerdict(base({ failureCode: "REGRESSION", passRate: 0.95, threshold: 0.9 })), {
    kind: "REFUSE",
    reason: "INCONCLUSIVE",
  });
});

test("verdict never encodes an amount (amount is caller-set, secret-independent)", () => {
  const v = decideVerdict(base({ passRate: 0.42 }));
  assert.equal("amount" in v, false);
});
