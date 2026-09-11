import { test } from "node:test";
import assert from "node:assert/strict";
import { resilient, NonRetryableError } from "./retry";

test("resilient retries transient faults then succeeds", async () => {
  let calls = 0;
  const value = await resilient(
    async () => {
      calls += 1;
      if (calls < 3) throw new Error("ETIMEDOUT transient");
      return "ok";
    },
    { timeoutMs: 500, retries: 5 },
  );
  assert.equal(value, "ok");
  assert.equal(calls, 3);
});

test("resilient aborts immediately on a non-retryable (semantic) failure", async () => {
  let calls = 0;
  await assert.rejects(
    resilient(
      async () => {
        calls += 1;
        throw new NonRetryableError(new Error("TX_MISMATCH"));
      },
      { timeoutMs: 500, retries: 5 },
    ),
  );
  assert.equal(calls, 1); // no retries burned on a deterministic failure
});
