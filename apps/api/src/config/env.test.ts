import { test } from "node:test";
import assert from "node:assert/strict";
import { loadEnv } from "./env";

test("defaults in development", () => {
  const env = loadEnv({ CHAIN_ENV: "development" } as NodeJS.ProcessEnv);
  assert.equal(env.PORT, 3001);
  assert.equal(env.CHAIN_ENV, "development");
  assert.equal(env.CONFIRMATIONS_REQUIRED, 3);
  assert.deepEqual(env.ADMIN_ADDRESSES, []);
  assert.equal(env.DEMO_MODE, false);
});

test("ADMIN_ADDRESSES parsed + lowercased", () => {
  const env = loadEnv({ ADMIN_ADDRESSES: "0xAbC, 0xDEF ,, 0x123" } as NodeJS.ProcessEnv);
  assert.deepEqual(env.ADMIN_ADDRESSES, ["0xabc", "0xdef", "0x123"]);
});

test("non-development requires session/SIWE/CORS material (fail-closed)", () => {
  assert.throws(() => loadEnv({ CHAIN_ENV: "arc-testnet" } as NodeJS.ProcessEnv), /Invalid api environment/);
});

test("non-development requires AGENT_API_KEY (API presents it to the agent; fail-closed)", () => {
  assert.throws(
    () =>
      loadEnv({
        CHAIN_ENV: "arc-testnet",
        SESSION_SECRET: "x".repeat(32),
        SIWE_DOMAIN: "app.vouch.xyz",
        WEB_ORIGIN: "https://app.vouch.xyz",
        // AGENT_API_KEY intentionally omitted
      } as NodeJS.ProcessEnv),
    /Invalid api environment/,
  );
});

test("non-development accepts full session config; WEB_ORIGIN parses to an allowlist", () => {
  const env = loadEnv({
    CHAIN_ENV: "arc-testnet",
    SESSION_SECRET: "x".repeat(32),
    SIWE_DOMAIN: "app.vouch.xyz",
    WEB_ORIGIN: "https://app.vouch.xyz, https://withvouch.xyz",
    AGENT_API_KEY: "test-agent-key",
  } as NodeJS.ProcessEnv);
  assert.equal(env.SIWE_DOMAIN, "app.vouch.xyz");
  assert.deepEqual(env.WEB_ORIGIN, ["https://app.vouch.xyz", "https://withvouch.xyz"]);
});
