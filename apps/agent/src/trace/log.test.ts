import { test } from "node:test";
import assert from "node:assert/strict";
import { recordHash, nextRecord, canonicalizeTrace, GENESIS_HASH, type TraceBody } from "./log";

const base: Omit<TraceBody, "seq" | "prevRecordHash"> = {
  quoteId: `0x${"a".repeat(64)}`,
  correlationId: "corr-1",
  outcome: "QUOTED",
  reasonCodes: ["FRESH_DATA", "UPHELD_CLAIM_RISK"],
  scoreInputs: { premiumBps: "200", upheldClaimRateBps: "500" },
  txHash: null,
};

test("recordHash is deterministic and stable under key/array order", () => {
  const a: TraceBody = { ...base, seq: 0, prevRecordHash: GENESIS_HASH };
  const b: TraceBody = {
    ...base,
    reasonCodes: ["UPHELD_CLAIM_RISK", "FRESH_DATA"], // reordered
    scoreInputs: { upheldClaimRateBps: "500", premiumBps: "200" }, // reordered
    seq: 0,
    prevRecordHash: GENESIS_HASH,
  };
  assert.equal(recordHash(a), recordHash(b));
});

test("changing any field changes the hash (tamper-evident)", () => {
  const a: TraceBody = { ...base, seq: 0, prevRecordHash: GENESIS_HASH };
  const tampered: TraceBody = { ...a, scoreInputs: { premiumBps: "999", upheldClaimRateBps: "500" } };
  assert.notEqual(recordHash(a), recordHash(tampered));
});

test("chain links: seq increments and prevRecordHash points at the prior record", () => {
  const first = nextRecord(GENESIS_HASH, null, base);
  assert.equal(first.seq, 0);
  assert.equal(first.prevRecordHash, GENESIS_HASH);

  const second = nextRecord(first.recordHash, first.seq, { ...base, outcome: "BOND_POSTED" });
  assert.equal(second.seq, 1);
  assert.equal(second.prevRecordHash, first.recordHash);
  assert.notEqual(second.recordHash, first.recordHash);
});

test("prevRecordHash is part of the hashed payload (link tampering detected)", () => {
  const a: TraceBody = { ...base, seq: 1, prevRecordHash: `0x${"1".repeat(64)}` };
  const relinked: TraceBody = { ...a, prevRecordHash: `0x${"2".repeat(64)}` };
  assert.notEqual(recordHash(a), recordHash(relinked));
  assert.ok(canonicalizeTrace(a).includes("prevRecordHash"));
});
