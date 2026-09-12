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
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Anchor to the repo root relative to this script (scripts/ is at the repo root), so the gate
// behaves identically regardless of the caller's cwd (house pattern; matches subgraph/scripts).
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];
const notes = [];

function sh(cmd, opts = {}) {
  return execSync(cmd, { cwd: ROOT, encoding: "utf8", ...opts });
}

// ---- 1. no real secret files tracked ------------------------------------------------
// -z + NUL split so paths with unusual bytes (git core.quotePath) never break the split.
const tracked = sh("git ls-files -z").split("\u0000").filter(Boolean);
const SECRET_FILE =
  /(^|\/)(\.env(\..+)?|secrets\.ya?ml)$|\.(pem|key)$|(^|\/)[^/]*keystore[^/]*$/i;
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
// Accept the common gitignore styles for env files (`.env`, `.env*`, `/.env`, `.env.*`).
let giOk = true;
for (const [label, need] of [
  ["env", /^\/?\.env(\*|\.\*)?\s*$/m],
  ["secrets.yaml", /secrets\.ya?ml/m],
]) {
  if (!need.test(gi)) {
    problems.push(`.gitignore missing an ignore for ${label}`);
    giOk = false;
  }
}
if (giOk) notes.push(".gitignore ignores .env + secrets.yaml"); // gated on THIS check, not global

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
  // Keyed provider RPC / gateway URLs (Alchemy/Infura style .../v2/<key>, .../v3/<key>) and
  // ?api_key=/&apikey= query params — no token shape and not 64-hex, so the rules above miss them.
  // Deliberately NOT matching `user:pass@host` userinfo (local DB defaults like vouch:vouch@localhost
  // are expected in *.example templates; real DB URLs live only in gitignored .env files).
  ["keyed-provider-url", /:\/\/[^/\s]+\/(?:v2|v3)\/[A-Za-z0-9_-]{20,}/],
  ["url-apikey-param", /[?&]api[_-]?key=[A-Za-z0-9_-]{16,}/i],
];
// A 64-hex VALUE that is obviously a placeholder (applied to the matched token, NOT the line).
function isPlaceholderHex(v) {
  const h = v.replace(/^0x/i, "").toLowerCase();
  return /^(.)\1+$/.test(h); // all-same-char (0x000…, 0x1111…, 0xaaaa…); real keys are high-entropy
}
// A 32-hex value (Studio deploy keys are ~32 hex — below the 64-hex rule), non-placeholder.
const HEX32 = /(?:0x)?(?![0]{32}\b)[0-9a-fA-F]{32}\b/;
// Key-type vars that MUST be blank/placeholder in any committed *.example template (a real value
// here would ship a live credential even though it isn't hex/token-shaped, e.g. a base64 session
// secret). Thresholds/refs (PASS_THRESHOLD, PRIVATE_TEST_REF) are intentionally excluded.
const EXAMPLE_MUST_BE_BLANK =
  /\b(PRIVATE_KEY|DEPLOYER_PK|QUOTE_SIGNER_PK|CIRCLE_API_KEY|CIRCLE_ENTITY_SECRET|SESSION_SECRET|GRAPH_DEPLOY_KEY|AGENT_API_KEY)\b/i;
// Is an env VALUE (right of `=`) a blank or obvious placeholder (never a real secret)?
function isPlaceholderValue(v) {
  const t = (v ?? "").trim().replace(/^["']|["']$/g, "");
  if (!t) return true;
  if (/^\$\{/.test(t)) return true; // ${VAR} interpolation
  if (/^(<.*>|changeme|change-me|change_me|your[_-]|xxx+|todo|tbd|sentinel|placeholder|example|replace|set-a-|dev-review)/i.test(t)) return true;
  return /^(.)\1+$/.test(t.replace(/^0x/i, "")); // all-same-char
}

const SKIP =
  /(^|\/)(node_modules|\.git|\.next|\.turbo|dist|build|out|generated|coverage)\//;
// NOTE: `.example` is intentionally NOT skipped — example CONTENT is scanned (a forgotten real value
// in a template is a leak). SVG is handled by a dedicated text pass below (see SVG scan). Raster
// images (png/jpg/…) can't be text-scanned; screenshot secret-hygiene is an enforced capture
// checklist (docs/deployment-hosting.md + docs/submission-checklist.md), not this gate.
const SKIP_FILE =
  /pnpm-lock\.yaml$|\.(png|jpg|jpeg|gif|svg|ico|lock|wasm|map|pdf|zip|gz|woff2?|ttf|eot|jar)$/i;
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
  const isExample = /\.example$/.test(f);
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
      // (c) a real 32-hex near a secret var (Studio GRAPH_DEPLOY_KEY etc. is ~32 hex, below HEX64).
      //     Guard with the RHS value: a sentinel/placeholder (e.g. SENTINEL_TEST_REF_deadc0de…) that
      //     merely embeds a 32-hex run is not a leak.
      const rhs32 = (line.match(/=(.*)$/)?.[1] ?? "");
      const m32 = line.match(HEX32);
      if (m32 && !isPlaceholderHex(m32[0]) && !isPlaceholderValue(rhs32)) {
        problems.push(`${f}:${i + 1}  secret-var 32-hex value → ${line.trim().slice(0, 80)}`);
      }
    }
    // (d) in *.example templates, key-type vars MUST be blank/placeholder — a real value (even a
    //     non-hex/non-token-shaped one, e.g. a base64 SESSION_SECRET) would ship a live credential.
    if (isExample && EXAMPLE_MUST_BE_BLANK.test(line)) {
      const eq = line.match(/^\s*(?:export\s+)?[A-Z0-9_]*(?:PRIVATE_KEY|DEPLOYER_PK|QUOTE_SIGNER_PK|CIRCLE_API_KEY|CIRCLE_ENTITY_SECRET|SESSION_SECRET|GRAPH_DEPLOY_KEY|AGENT_API_KEY)[A-Z0-9_]*\s*=(.*)$/i);
      // Strip a trailing dotenv inline comment (` # …`) before judging the value.
      const val = eq ? eq[1].replace(/\s+#.*$/, "") : "";
      if (eq && !isPlaceholderValue(val)) {
        problems.push(`${f}:${i + 1}  *.example key-type var has a non-placeholder value → ${line.trim().slice(0, 80)}`);
      }
    }
  }
}
notes.push(`content-scanned ${scanned} tracked text files (token-shapes + secret-var hex + example blanks)`);

// ---- 3b. SVG text pass (SVGs are XML text but skipped above to avoid hex-in-path false positives).
// A browser-exported diagram can bake in absolute home paths (leaking a username), Bearer tokens, or
// api keys. Scan tracked .svg for those specific markers + token shapes + non-blank key-type vars.
let svgScanned = 0;
const SVG_LEAK = [
  ["home-path", /\/(?:Users|home)\/[A-Za-z0-9._-]+\//],
  ["bearer", /Bearer\s+[A-Za-z0-9._-]{8,}/],
  ["apikey", /[?&]api[_-]?key=[A-Za-z0-9_-]{8,}/i],
];
for (const f of tracked) {
  if (!/\.svg$/i.test(f) || SKIP.test(f)) continue;
  let text;
  try {
    text = readFileSync(join(ROOT, f), "utf8");
  } catch {
    continue;
  }
  if (text.includes("\u0000")) continue;
  svgScanned++;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const [name, re] of [...SVG_LEAK, ...TOKEN_SHAPES]) {
      if (re.test(line)) problems.push(`${f}:${i + 1}  svg ${name} → ${line.trim().slice(0, 80)}`);
    }
  }
}
notes.push(`scanned ${svgScanned} tracked .svg files (home-path / bearer / apikey / token-shapes)`);

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
