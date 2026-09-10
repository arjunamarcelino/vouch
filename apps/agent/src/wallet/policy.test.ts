import { test } from "node:test";
import assert from "node:assert/strict";
import type { Address } from "viem";
import { makeSpendPolicy, checkSpend } from "./policy";

const ESCROW = "0x00000000000000000000000000000000000000ee" as Address;
const OTHER = "0x00000000000000000000000000000000000000ff" as Address;

test("within cap + allowlisted destination → ok", () => {
  const p = makeSpendPolicy(1_000_000n, [ESCROW]);
  assert.deepEqual(checkSpend(p, 500_000n, ESCROW), { ok: true });
});

test("over per-tx cap → PER_TX_CAP_EXCEEDED", () => {
  const p = makeSpendPolicy(1_000_000n, [ESCROW]);
  const r = checkSpend(p, 2_000_000n, ESCROW);
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.reasonCodes.includes("PER_TX_CAP_EXCEEDED"));
});

test("non-allowlisted destination → DESTINATION_NOT_ALLOWED", () => {
  const p = makeSpendPolicy(1_000_000n, [ESCROW]);
  const r = checkSpend(p, 100n, OTHER);
  assert.ok(!r.ok && r.reasonCodes.includes("DESTINATION_NOT_ALLOWED"));
});

test("allowlist match is checksum/case-insensitive", () => {
  const p = makeSpendPolicy(1_000_000n, [ESCROW.toUpperCase().replace("0X", "0x")]);
  assert.deepEqual(checkSpend(p, 100n, ESCROW), { ok: true });
});

test("both violations reported together", () => {
  const p = makeSpendPolicy(10n, [ESCROW]);
  const r = checkSpend(p, 100n, OTHER);
  assert.ok(!r.ok && r.reasonCodes.length === 2);
});
