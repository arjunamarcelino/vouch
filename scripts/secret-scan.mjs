#!/usr/bin/env node
// Secret-leak gate for the Vouch monorepo (plan WE surface #10 / S1).
//
// Fails closed (exit 1) if any of these hold:
//   1. A real secret FILE is tracked by git (.env, secrets.yaml, *.pem/*.key, keystore) —
//      only `*.example` templates may be committed.
//   2. `.gitignore` does not ignore `.env` and `packages/cre-workflow/secrets.yaml`.
//   3. A tracked, non-example, non-lockfile text file contains either (a) a self-identifying token
//      shape (JWT / ghp_ / github_pat_ / AKIA / Slack / PEM PRIVATE KEY / Circle key) — flagged
//      everywhere including test/fixture files — or (b) a real (non-placeholder, high-entropy) 64-hex
//      value assigned near a SECRET_VARS name. All-same-char hex (0x000…/0x1111…) is treated as a
//      placeholder; a bare Solidity bytes32 constant (no secret-var name) is not flagged.
//   4. (Positive control) the CRE local harness runs, reports it CONSUMED a secret, produces the
//      PAYOUT verdict the private threshold drives, and does NOT echo the sentinel value — a harness
//      that throws is a FAILURE, not a skip.
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

function sh(cmd, opts = {}) {
  return execSync(cmd, { cwd: ROOT, encoding: "utf8", ...opts });
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
// Secret variable names that, when set to a real hex value, indicate a leaked key.
const SECRET_VARS =
  /(PRIVATE_KEY|DEPLOYER_PK|QUOTE_SIGNER_PK|CIRCLE_API_KEY|CIRCLE_ENTITY_SECRET|SESSION_SECRET|GRAPH_DEPLOY_KEY|AGENT_API_KEY|PASS_THRESHOLD|PRIVATE_TEST|BEARER|AUTHORIZATION)/i;
// Real 64-hex key (0x-prefixed or bare), not all-zero.
const HEX64 = /(?:0x)?(?![0]{64}\b)[0-9a-fA-F]{64}\b/;
// Self-identifying token shapes — real regardless of surrounding context or file type.
const CIRCLE = /\b(?:TEST|LIVE)_API_KEY:[0-9a-f]{6,}:[0-9a-f]{6,}/i;
const TOKEN_SHAPES = [
  ["circle-api-key", CIRCLE],
  ["jwt", /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
  ["github-pat", /\bghp_[A-Za-z0-9]{36}\b/],
  ["github-fine-grained-pat", /\bgithub_pat_[A-Za-z0-9_]{50,}\b/],
  ["aws-access-key", /\bAKIA[0-9A-Z]{16}\b/],
  ["slack-token", /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
  ["pem-private-key", /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/],
];
// A 64-hex VALUE that is obviously a placeholder (applied to the matched token, NOT the line).
function isPlaceholderHex(v) {
  const h = v.replace(/^0x/i, "").toLowerCase();
  return /^(.)\1+$/.test(h); // all-same-char (0x000…, 0x1111…, 0xaaaa…); real keys are high-entropy
}

const SKIP =
  /(^|\/)(node_modules|\.git|\.next|\.turbo|dist|build|out|generated|coverage)\//;
const SKIP_FILE =
  /\.example$|pnpm-lock\.yaml$|\.(png|jpg|jpeg|gif|svg|ico|lock|wasm|map|pdf|zip|gz|woff2?|ttf|eot|jar)$/i;
// This scanner defines the token-shape patterns above as source; skip itself to avoid self-match.
const SELF = /(^|\/)scripts\/secret-scan\.mjs$/;

let scanned = 0;
for (const f of tracked) {
  if (SKIP.test(f) || SKIP_FILE.test(f) || SELF.test(f)) continue;
  let text;
  try {
    text = readFileSync(join(ROOT, f), "utf8");
  } catch {
    continue; // unreadable (I/O error) — readFileSync does NOT throw on binary content
  }
  if (text.includes("\u0000")) continue; // binary sniff (NUL byte)
  scanned++;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Auditable escape hatch for intentional test vectors (e.g. a PUBLIC Hardhat/anvil key used to
    // test redaction). Mark the line, or the line above, with `secret-scan-allow`.
    if (/secret-scan-allow/.test(line) || (i > 0 && /secret-scan-allow/.test(lines[i - 1]))) continue;
    // (a) self-identifying token shapes — flagged everywhere, including test/fixture files.
    for (const [name, re] of TOKEN_SHAPES) {
      if (re.test(line)) {
        problems.push(`${f}:${i + 1}  ${name} → ${line.trim().slice(0, 80)}`);
      }
    }
    // (b) a real (non-placeholder) 64-hex assigned near a SECRET_VARS name. Requiring the secret-var
    //     keyword means a bare Solidity bytes32 constant (no secret name) is NOT flagged, so test
    //     files no longer get a blanket skip — a real key assigned to a secret var IS caught there.
    if (SECRET_VARS.test(line)) {
      const m = line.match(HEX64);
      if (m && !isPlaceholderHex(m[0])) {
        problems.push(`${f}:${i + 1}  secret-var hex value → ${line.trim().slice(0, 80)}`);
      }
    }
  }
}
notes.push(`content-scanned ${scanned} tracked text files (token-shapes + secret-var hex)`);

// ---- 4. positive control: the CRE secret path executes AND stays redacted ----
// A static "no secret printed" line proves nothing on its own, so we assert three things that a
// placeholder / no-op path could NOT satisfy together:
//   (a) the exact sentinel token value never appears in stdout (redaction actually holds),
//   (b) the harness reports it CONSUMED >=1 secret (the getSecret path ran — see harness.ts),
//   (c) the verdict is PAYOUT (the private threshold secret drove the decision).
// A harness that throws is a FAILURE (RED), not a silent skip — the control must run.
const SENTINEL_TOKEN = "SENTINEL_TOKEN_1a2b3c4d5e6f7081"; // fake value from harness.ts SENTINEL.token
try {
  const out = sh(
    "pnpm --filter @vouch/cre-workflow simulate:harness fixtures/valid-failure.json",
    { maxBuffer: 1 << 24 },
  );
  if (out.includes(SENTINEL_TOKEN)) {
    problems.push("CRE harness LEAKED the sentinel secret value to stdout");
  } else if (!/secret\(s\) were consumed/i.test(out)) {
    problems.push("CRE harness positive-control never ran the secret path (no 'consumed' marker)");
  } else if (!/verdict:\s*PAYOUT/i.test(out)) {
    problems.push("CRE harness positive-control: expected PAYOUT (the threshold secret drives it)");
  } else {
    notes.push("CRE harness consumed the secret path, produced PAYOUT, and did not leak the sentinel");
  }
} catch (e) {
  problems.push(`CRE harness positive-control FAILED to run: ${(e.message || "").slice(0, 80)}`);
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
