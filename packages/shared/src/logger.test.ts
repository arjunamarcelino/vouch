import { test } from "node:test";
import assert from "node:assert/strict";
import { pino, type Logger } from "pino";
import { REDACT_PATHS } from "./logger";

/** Capture pino output through a stream to assert redaction of the secret env keys (review 039). */
function capture(fn: (log: Logger) => void): string {
  const chunks: string[] = [];
  const stream = { write: (s: string) => void chunks.push(s) };
  const log = pino({ redact: { paths: REDACT_PATHS, censor: "[REDACTED]" } }, stream);
  fn(log);
  return chunks.join("");
}

test("redacts the agent secret env keys, top-level and nested", () => {
  const secrets = {
    CIRCLE_API_KEY: "KEY:abc:def",
    CIRCLE_ENTITY_SECRET: "entity-secret-value",
    QUOTE_SIGNER_PK: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  };
  // top-level (logging the env object directly) and nested (logging { env })
  const out = capture((log) => {
    log.info(secrets, "top-level env");
    log.info({ env: secrets }, "nested env");
  });
  assert.ok(!out.includes("KEY:abc:def"), "CIRCLE_API_KEY leaked");
  assert.ok(!out.includes("entity-secret-value"), "CIRCLE_ENTITY_SECRET leaked");
  assert.ok(!out.includes("0x59c6995e"), "QUOTE_SIGNER_PK leaked");
  assert.ok(out.includes("[REDACTED]"), "expected redaction marker");
});

test("still redacts the original suffix patterns", () => {
  const out = capture((log) => log.info({ wallet: { apiKey: "sk-live-xyz", entitySecret: "es-123" } }, "wallet"));
  assert.ok(!out.includes("sk-live-xyz"));
  assert.ok(!out.includes("es-123"));
});
