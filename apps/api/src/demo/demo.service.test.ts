import { test } from "node:test";
import assert from "node:assert/strict";

// The allowlist gate is fail-closed and hermetic (throws before any DB call).
test("demo tooling refuses when DEMO_MODE is off", async () => {
  process.env.CHAIN_ENV = "development";
  delete process.env.DEMO_MODE;
  const { DemoService } = await import("./demo.service");
  await assert.rejects(new DemoService().reset(), /Demo tooling is disabled/);
  await assert.rejects(new DemoService().seed(), /Demo tooling is disabled/);
});

test("demo tooling refuses on a non-demo chain even with DEMO_MODE=true (allowlist, not denylist)", async () => {
  // Mainnet env requires session config for loadEnv to pass; supply it so the DEMO gate is what rejects.
  process.env.CHAIN_ENV = "arc-mainnet";
  process.env.DEMO_MODE = "true";
  process.env.SESSION_SECRET = "x".repeat(40);
  process.env.SIWE_DOMAIN = "app.vouch.xyz";
  process.env.WEB_ORIGIN = "https://app.vouch.xyz";
  const { DemoService } = await import("./demo.service");
  await assert.rejects(new DemoService().reset(), /Demo tooling is disabled/);
});
