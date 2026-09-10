import { test } from "node:test";
import assert from "node:assert/strict";
import type { Address } from "viem";
import { uuidv5, idempotencyKey, paramsHash } from "./idempotency";

const QUOTE = `0x${"a".repeat(64)}`;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

test("uuidv5 is deterministic and RFC-4122 v5 formatted", () => {
  const a = uuidv5("x");
  assert.match(a, UUID_RE);
  assert.equal(a, uuidv5("x"));
  assert.notEqual(a, uuidv5("y"));
});

test("idempotencyKey is stable per (quoteId, action) and differs across actions", () => {
  assert.equal(idempotencyKey(QUOTE, "POST_BOND"), idempotencyKey(QUOTE, "POST_BOND"));
  assert.notEqual(idempotencyKey(QUOTE, "POST_BOND"), idempotencyKey(QUOTE, "REFUND_BOND"));
});

test("paramsHash changes when any material param changes (stale-amount guard)", () => {
  const base = {
    amount: "500000",
    destination: "0x00000000000000000000000000000000000000ee" as Address,
    token: "0x3600000000000000000000000000000000000000" as Address,
    chainId: 5042002,
  };
  const h = paramsHash(base);
  assert.equal(h, paramsHash(base));
  assert.notEqual(h, paramsHash({ ...base, amount: "500001" }));
  assert.notEqual(h, paramsHash({ ...base, chainId: 1 }));
});
