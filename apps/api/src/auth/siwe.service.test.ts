import { test, before } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { createSiweMessage, generateSiweNonce } from "viem/siwe";

// SIWE binding checks short-circuit BEFORE the Postgres nonce consume, so they're testable without a
// DB. The happy path (nonce consume + signature) is exercised by the live server / DB-backed e2e.
before(() => {
  process.env.CHAIN_ENV = "development"; // expected chainId = arc-testnet 5042002
  delete process.env.SIWE_DOMAIN; // dev: domain check skipped
  delete process.env.ARC_RPC_URL; // EOA offline path
});

const account = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");

test("rejects a message bound to the wrong chain (before touching the DB)", async () => {
  const { SiweService } = await import("./siwe.service");
  const message = createSiweMessage({
    address: account.address,
    chainId: 999, // != 5042002
    domain: "localhost",
    nonce: generateSiweNonce(),
    uri: "http://localhost",
    version: "1",
  });
  await assert.rejects(new SiweService().verify(message, "0x00"), /Wrong chain/);
});

test("rejects a malformed SIWE message", async () => {
  const { SiweService } = await import("./siwe.service");
  await assert.rejects(new SiweService().verify("not a siwe message", "0x00"), /Malformed SIWE message/);
});
