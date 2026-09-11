import { test, before } from "node:test";
import assert from "node:assert/strict";
import { hashCallArgs } from "./args-hash";

const HUB = "0x1111111111111111111111111111111111111111";

before(() => {
  process.env.CHAIN_ENV = "development";
  process.env.VOUCH_CORE_ADDRESS = HUB;
  process.env.ARC_RPC_URL = "http://localhost:8545";
});

test("hashCallArgs is stable and case-insensitive for hex/addresses", () => {
  const a = hashCallArgs(["0xAbCd", 100n, true]);
  const b = hashCallArgs(["0xabcd", 100n, true]);
  assert.equal(a, b);
  assert.notEqual(a, hashCallArgs(["0xabcd", 101n, true]));
});

test("prepare→track arg roundtrip matches; a tampered amount does not (the TX_MISMATCH gate)", async () => {
  const { ChainService } = await import("./chain.service");
  const svc = new ChainService();

  const args = [1n] as const; // acceptJob(jobId)
  const data = svc.encode("acceptJob", args);
  const decoded = svc.decodeCall(data, "acceptJob").args as readonly unknown[];
  assert.equal(hashCallArgs(decoded), hashCallArgs(args)); // honest tx verifies

  // A wallet that signed different calldata (different jobId) must NOT match the prepared intent.
  const tampered = svc.decodeCall(svc.encode("acceptJob", [2n]), "acceptJob").args as readonly unknown[];
  assert.notEqual(hashCallArgs(tampered), hashCallArgs(args));
});

test("openJob arg roundtrip survives mixed-case bytes32 + bigints", async () => {
  const { ChainService } = await import("./chain.service");
  const svc = new ChainService();
  const args = [
    "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "0x3600000000000000000000000000000000000000",
    20_000000n,
    100_000000n,
    1_000000n,
    2000000000n,
    86400n,
    `0x${"A".repeat(64)}`, // mixed case on the wire
    `0x${"b".repeat(64)}`,
  ] as const;
  const decoded = svc.decodeCall(svc.encode("openJob", args), "openJob").args as readonly unknown[];
  assert.equal(hashCallArgs(decoded), hashCallArgs(args));
});
