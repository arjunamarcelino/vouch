/**
 * Deterministic local/simulation harness (SDK-independent).
 *
 * Loads a fixture (the confidential test-API response body) from argv, drives
 * `runEvaluation` with a mock `EvalPort` that has a FIXED clock, sentinel
 * secrets, and a seeded `getJob`, then prints the decision and the would-be
 * report payload (hex + base64) WITHOUT printing any secret.
 *
 * No `Date.now()` / `Math.random()` — fully reproducible.
 *
 *   node --import tsx harness.ts fixtures/valid-failure.json
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { configSchema, type Config } from "./config";
import { runEvaluation, type EvalPort, type JobView } from "./port";

// ---- Deterministic inputs -------------------------------------------------
const FIXED_NOW = 1_700_000_000n; // fixed clock (seconds) — never Date.now()
const SEEDED_JOB: JobView = {
  status: 5, // ClaimPending
  guaranteeAmount: 100_000_000n, // 100 USDC (6 decimals)
  submissionCommitment:
    "0x1111111111111111111111111111111111111111111111111111111111111111",
};

// High-entropy sentinels for LOCAL SIM ONLY. These are fake — never real secrets.
const SENTINEL = {
  token: "SENTINEL_TOKEN_1a2b3c4d5e6f7081",
  threshold: "0.9",
} as const;

const CFG: Config = configSchema.parse({
  chainSelectorName: "arc-testnet",
  chainId: "5042002",
  consumerAddress: "0x00000000000000000000000000000000000000a1",
  contractAddress: "0x00000000000000000000000000000000000000a1",
  owner: "0x00000000000000000000000000000000000000b2",
  gasLimit: "500000",
  testApiUrl: "https://example.invalid/private-test",
  workflowId:
    "0x00000000000000000000000000000000000000000000000000000000deadbeef",
});

const JOB_ID = 42n;

function hexToBase64(hex: `0x${string}`): string {
  return Buffer.from(hex.slice(2), "hex").toString("base64");
}

async function main(): Promise<void> {
  const fixturePath = process.argv[2];
  if (fixturePath === undefined) {
    console.error(
      "usage: node --import tsx harness.ts <fixture.json>\n" +
        "example: node --import tsx harness.ts fixtures/valid-failure.json",
    );
    process.exit(2);
    return;
  }

  // Load the fixture via a dynamic JSON import (the CRE sandbox types `node:fs`
  // as `never`; JSON module imports avoid it and work under Node/tsx).
  const fixtureUrl = pathToFileURL(resolve(process.cwd(), fixturePath)).href;
  const mod = (await import(fixtureUrl, { with: { type: "json" } })) as {
    default: unknown;
  };
  const body: unknown = mod.default;

  const port: EvalPort = {
    async getSecret(id) {
      if (id === "token") return SENTINEL.token;
      if (id === "PASS_THRESHOLD") return SENTINEL.threshold;
      return undefined;
    },
    async confidentialFetch() {
      return { ok: true, body };
    },
    async getJob() {
      return SEEDED_JOB;
    },
    async emitReport() {
      // Dry-run: never broadcasts. Report emission is simulated.
      return { ok: true, txHash: `0x${"00".repeat(32)}` };
    },
    now() {
      return FIXED_NOW;
    },
  };

  const result = await runEvaluation(port, CFG, JOB_ID);

  console.log("=== Vouch CRE confidential workflow — local harness (dry-run) ===");
  console.log(`fixture:      ${fixturePath}`);
  console.log(`jobId:        ${JOB_ID}`);
  console.log(`fixed clock:  ${FIXED_NOW} (unix seconds)`);
  console.log(`verdict:      ${result.verdict.kind}`);
  if (result.verdict.kind === "REFUSE") {
    console.log(`refuse reason:${result.verdict.reason}`);
  }
  console.log(`action:       ${result.action}`);
  if (result.payload !== undefined) {
    console.log(`payload hex:  ${result.payload}`);
    console.log(`payload b64:  ${hexToBase64(result.payload)}`);
    console.log(`payload bytes:${(result.payload.length - 2) / 2}`);
  } else {
    console.log("payload:      (none — no report on REFUSE)");
  }
  console.log("note: no secret is printed above; the credential/threshold stay confidential.");
}

void main();
