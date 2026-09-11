import { test } from "node:test";
import assert from "node:assert/strict";
import { configSchema, configWithChainCheck } from "./config";

const GOOD = {
  chainSelectorName: "arc-testnet",
  chainId: "5042002",
  assuranceHubAddress: "0x00000000000000000000000000000000000000a1",
  owner: "0x00000000000000000000000000000000000000b2",
  gasLimit: "500000",
  testApiUrl: "https://example.invalid/private-test",
  workflowId: "0x00000000000000000000000000000000000000000000000000000000deadbeef",
} as const;

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
const ZERO_B32 = `0x${"0".repeat(64)}`;

test("config: the happy config parses", () => {
  assert.doesNotThrow(() => configWithChainCheck.parse(GOOD));
});

test("config: zero assuranceHubAddress is rejected (fail loud on unreplaced placeholder)", () => {
  assert.throws(() => configSchema.parse({ ...GOOD, assuranceHubAddress: ZERO_ADDR }));
});

test("config: zero owner is rejected", () => {
  assert.throws(() => configSchema.parse({ ...GOOD, owner: ZERO_ADDR }));
});

test("config: zero workflowId is rejected", () => {
  assert.throws(() => configSchema.parse({ ...GOOD, workflowId: ZERO_B32 }));
});

test("config: a malformed address is rejected", () => {
  assert.throws(() => configSchema.parse({ ...GOOD, assuranceHubAddress: "0xnothex" }));
});

test("config: a short bytes32 workflowId is rejected", () => {
  assert.throws(() => configSchema.parse({ ...GOOD, workflowId: "0xdeadbeef" }));
});

test("config: a non-decimal gasLimit is rejected", () => {
  assert.throws(() => configSchema.parse({ ...GOOD, gasLimit: "5e5" }));
});

test("config: chainId that disagrees with chainSelectorName is rejected", () => {
  // Base schema accepts it (chainId is a valid positive-int string)...
  assert.doesNotThrow(() => configSchema.parse({ ...GOOD, chainId: "1" }));
  // ...but the chain-check refine catches the mismatch (arc-testnet must be 5042002).
  assert.throws(() => configWithChainCheck.parse({ ...GOOD, chainId: "1" }));
});
