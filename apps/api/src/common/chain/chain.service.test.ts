import { test, before } from "node:test";
import assert from "node:assert/strict";

const HUB = "0x1111111111111111111111111111111111111111";

// ChainService.encode/selector/eventTopic0/addressEq are PURE (no RPC). Set config before import.
before(() => {
  process.env.CHAIN_ENV = "development";
  process.env.VOUCH_CORE_ADDRESS = HUB;
  process.env.ARC_RPC_URL = "http://localhost:8545";
});

test("selectors + topic0 derive from the frozen ABI", async () => {
  const { ChainService } = await import("./chain.service");
  const svc = new ChainService();
  assert.match(svc.functionSelector("openJob"), /^0x[0-9a-f]{8}$/u);
  assert.match(svc.functionSelector("acceptJob"), /^0x[0-9a-f]{8}$/u);
  assert.notEqual(svc.functionSelector("openJob"), svc.functionSelector("acceptJob"));
  assert.match(svc.eventTopic0("JobCreated"), /^0x[0-9a-f]{64}$/u);
});

test("encode → calldata begins with the function selector", async () => {
  const { ChainService } = await import("./chain.service");
  const svc = new ChainService();
  const data = svc.encode("acceptJob", [1n]);
  assert.equal(svc.selectorOf(data), svc.functionSelector("acceptJob"));
});

test("addressEq folds checksum/case, rejects mismatch", async () => {
  const { ChainService } = await import("./chain.service");
  const svc = new ChainService();
  assert.equal(svc.addressEq(HUB.toUpperCase().replace("0X", "0x"), HUB), true);
  assert.equal(svc.addressEq("0x2222222222222222222222222222222222222222", HUB), false);
  assert.equal(svc.addressEq(null, HUB), false);
});

test("chainId derives from CHAIN_ENV", async () => {
  const { ChainService } = await import("./chain.service");
  assert.equal(new ChainService().chainId, 5042002); // arc-testnet (development maps to it)
});
