import { test } from "node:test";
import assert from "node:assert/strict";
import { quoteGuarantee } from "./quote";
import type { ProviderReputation } from "@vouch/shared/schemas";

const ZERO_ADDR = `0x${"0".repeat(40)}`;

function reputation(overrides: Partial<ProviderReputation>): ProviderReputation {
  return {
    id: ZERO_ADDR,
    jobsCompleted: "10",
    guaranteesLocked: "5",
    regressions: "0",
    totalPaidOut: "0",
    totalGuaranteedValue: "1000000000",
    ...overrides,
  };
}

test("clean provider has zero regression rate and base-level cap", () => {
  const quote = quoteGuarantee(reputation({}), 100_000_000n);
  assert.equal(quote.regressionRate, 0);
  assert.equal(quote.recommendedGuaranteeCap, "100000000");
});

test("higher observed risk widens the recommended guarantee cap", () => {
  const clean = quoteGuarantee(reputation({}), 100_000_000n);
  const risky = quoteGuarantee(
    reputation({ regressions: "5", totalPaidOut: "500000000" }),
    100_000_000n,
  );
  assert.ok(
    BigInt(risky.recommendedGuaranteeCap) > BigInt(clean.recommendedGuaranteeCap),
    "risky provider should be quoted a larger cap",
  );
  assert.ok(risky.regressionRate > 0);
});

test("division by zero is guarded for providers with no completed jobs", () => {
  const quote = quoteGuarantee(reputation({ jobsCompleted: "0" }), 100_000_000n);
  assert.equal(quote.regressionRate, 0);
});
