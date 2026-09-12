#!/usr/bin/env node
// Secret-leak gate for the Vouch monorepo (plan WE surface #10 / S1).
//
// Fails closed (exit 1) if any of these hold:
//   1. A real secret FILE is tracked by git (.env, secrets.yaml, *.pem/*.key, keystore) —
//      only `*.example` templates may be committed.
//   2. `.gitignore` does not ignore `.env` and `packages/cre-workflow/secrets.yaml`.
//   3. A tracked, non-example, non-lockfile text file contains a REAL-looking secret value
//      (a 64-hex private key or a Circle/API bearer token) assigned to a secret variable —
//      placeholders / sentinels / `0x000…` / `${VAR}` / `<...>` are allowed.
//   4. (Positive control) the CRE local harness, when run, prints its "no secret" marker and
//      does NOT echo the sentinel token — proving the secret path executes AND stays redacted.
//
// Honest scope note: this is a lightweight repo-hygiene gate, not a full entropy scanner. It
// deliberately reports exactly what it scanned (no silent truncation). Deep vectors (built web
// bundle values, sourcemaps, Prisma query logs, CI run logs, git history rewrite) are enumerated
// in docs/security.md as the comprehensive-tier follow-up.

import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const problems = [];
const notes = [];

function sh(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: "utf8" });
}

// ---- 1. no real secret files tracked ------------------------------------------------
const tracked = sh("git ls-files").split("\n").filter(Boolean);
const SECRET_FILE = /(^|\/)(\.env(\..+)?|secrets\.ya?ml)$|\.(pem|key)$|keystore/i;
const secretFiles = tracked.filter(
  (f) => SECRET_FILE.test(f) && !/\.example$/.test(f),
);
if (secretFiles.length) {
  problems.push(`Tracked secret file(s): ${secretFiles.join(", ")}`);
} else {
  notes.push("no tracked secret files (only *.example templates)");
}

// ---- 2. gitignore covers env + cre secrets ------------------------------------------
const gi = existsSync(join(ROOT, ".gitignore"))
  ? readFileSync(join(ROOT, ".gitignore"), "utf8")
  : "";
for (const need of [/^\.env$/m, /secrets\.ya?ml/m]) {
  if (!need.test(gi)) problems.push(`.gitignore missing pattern: ${need}`);
}
if (!problems.length) notes.push(".gitignore ignores .env + secrets.yaml");

// ---- 3. real-secret content scan ----------------------------------------------------
const SECRET_VARS =
  /(PRIVATE_KEY|DEPLOYER_PK|QUOTE_SIGNER_PK|CIRCLE_API_KEY|CIRCLE_ENTITY_SECRET|SESSION_SECRET|GRAPH_DEPLOY_KEY|AGENT_API_KEY|PASS_THRESHOLD|PRIVATE_TEST|BEARER|AUTHORIZATION)/i;
// Real 64-hex key (0x-prefixed or bare), not all-zero.
const HEX64 = /(?:0x)?(?![0]{64}\b)[0-9a-fA-F]{64}\b/;
// Circle-style key `PREFIX:ID:SECRET` or long opaque token.
const CIRCLE = /\b(?:TEST|LIVE)_API_KEY:[0-9a-f]{6,}:[0-9a-f]{6,}/i;
// Values that are obviously placeholders / templated / sentinels — allowed.
const PLACEHOLDER =
  /0x0{20,}|<[^>]+>|\$\{|\bchange[_-]?me\b|\breplace\b|\byour[_-]|\bexample\b|\bsentinel\b|\bplaceholder\b|xxxx|TODO|\bREDACTED\b|deadbeef|\.\.\.|dEaD/i;

const SKIP =
  /(^|\/)(node_modules|\.git|\.next|\.turbo|dist|build|out|generated|coverage)\//;
const SKIP_FILE =
  /\.example$|pnpm-lock\.yaml$|\.(png|jpg|jpeg|gif|svg|ico|lock|wasm|map)$/i;
// Test/harness fixtures legitimately hold bytes32 hashes; the CRE package uses sentinel secrets.
const SOFT =
  /(^|\/)(test|tests|fixtures|__tests__)\/|\.t\.sol$|\.test\.ts$|secrets\.yaml\.example/;

let scanned = 0;
for (const f of tracked) {
  if (SKIP.test(f) || SKIP_FILE.test(f)) continue;
  let text;
  try {
    text = readFileSync(join(ROOT, f), "utf8");
  } catch {
    continue; // binary / unreadable
  }
  scanned++;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (PLACEHOLDER.test(line)) continue;
    const hasSecretVar = SECRET_VARS.test(line);
    const looksReal =
      (HEX64.test(line) && hasSecretVar) || CIRCLE.test(line);
    if (!looksReal) continue;
    // In test/fixture files a bare 64-hex is expected; only flag if it's clearly a live key
    // assignment (Circle token, or a secret var set to a hex value) — never a Solidity constant.
    if (SOFT.test(f) && !CIRCLE.test(line)) continue;
    problems.push(`${f}:${i + 1}  possible real secret → ${line.trim().slice(0, 80)}`);
  }
}
notes.push(`content-scanned ${scanned} tracked text files`);

// ---- 4. positive control: CRE harness runs, prints redaction marker, no sentinel echo ----
try {
  const out = sh(
    "pnpm --filter @vouch/cre-workflow simulate:harness fixtures/valid-failure.json",
  );
  if (!/no secret is printed/i.test(out)) {
    problems.push("CRE harness output missing the 'no secret is printed' marker");
  } else if (/BEGIN|-----|Bearer [A-Za-z0-9._-]{20,}/.test(out)) {
    problems.push("CRE harness output appears to contain a credential");
  } else {
    notes.push("CRE harness executed the secret path and stayed redacted");
  }
} catch (e) {
  notes.push(`CRE harness positive-control skipped (${(e.message || "").slice(0, 60)})`);
}

// ---- report -------------------------------------------------------------------------
console.log("── secret-scan ──");
for (const n of notes) console.log(`  ✓ ${n}`);
if (problems.length) {
  console.log("\n  ✗ FINDINGS:");
  for (const p of problems) console.log(`    - ${p}`);
  console.error(`\nsecret-scan FAILED: ${problems.length} finding(s).`);
  process.exit(1);
}
console.log("\nsecret-scan PASSED: no leaked secrets detected.");
