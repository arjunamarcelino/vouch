---
title: "A secret-leak gate that passes clean but misses real secrets (whole-line allowlist, test-file skip, fail-open positive control)"
category: security-issues
tags: [security, secret-scanning, tooling, ci, false-negative, regex, gate]
module: scripts/secret-scan.mjs
symptom: "`pnpm gate:secrets` reports PASS on a clean repo and even flags an obvious planted key — yet several real secrets slip through: keys on lines containing common tokens, keys in test/fixture files, and non-hex tokens (JWT/PAT/AWS). The 'positive control' claims to prove redaction but passes even when it never ran."
root_cause: "Three independent false-negative vectors: (1) the placeholder allowlist was matched against the WHOLE LINE, so `...`/`${`/`<>`/`example` whitelisted any line; (2) a blanket skip of test/fixture files; (3) a positive control keyed on an UNCONDITIONAL log marker + generic patterns, caught in a try/catch that recorded a 'skip' (not a failure) — so it failed open."
date: 2026-09-12
---

# A secret-leak gate that looks like it works but has false negatives

## Symptom

`scripts/secret-scan.mjs` (`pnpm gate:secrets`) passed clean, and a quick negative test (planting a
`PRIVATE_KEY=0x…`) made it fail — so it *looked* verified. A closer review found it would silently
miss real secrets in several common shapes, while a security doc credited it with protecting things it
never scanned.

## Why it's subtle

A secret gate's **only** value is its true-positive rate on secrets it claims to cover. It always
"passes" on a clean repo, and a single crafted negative test can pass while whole classes of leak slip
through. A gate you don't adversarially probe across *shapes* is security theater.

## Root cause — three independent false-negative vectors

1. **Whole-line placeholder allowlist.** The allowlist regex (`...`, `${`, `<…>`, `example`, …) was
   tested against the entire line, not the candidate secret value:
   ```js
   // WRONG: any line containing "...", "${", "<x>", or "example" is skipped wholesale.
   if (PLACEHOLDER.test(line)) continue;
   const looksReal = (HEX64.test(line) && SECRET_VARS.test(line)) || CIRCLE.test(line);
   ```
   So `const PRIVATE_KEY = "0x<64 real hex>" // e.g. example` — or any secret line that also contains
   a spread, template literal, tag, or the word "example" — was skipped.
2. **Blanket test/fixture skip.** `if (SOFT.test(f) && !CIRCLE.test(line)) continue;` dropped any
   `SECRET_VARS`-assigned hex in `test/`, `fixtures/`, `*.t.sol`, `*.test.ts`. Real keys are routinely
   pasted into test config/fixtures — exactly the miss.
3. **Only hex + one Circle shape.** Base64 tokens, JWTs (`eyJ…`), AWS keys (`AKIA…`), GitHub PATs
   (`ghp_…`), Slack tokens, and PEM `PRIVATE KEY` blocks were invisible even when assigned to a
   secret var — yet the docs claimed "API bearer" coverage.
4. **Fail-open positive control.** It checked for a static, *unconditional* `console.log` marker plus
   generic patterns; a harness exception was caught and recorded as a "skipped" note while the gate
   still PASSed. A static log line is not evidence the secret path executed.

## Solution

Scope placeholder-detection to the **matched value**, flag by **shape** everywhere, and make the
positive control *falsifiable*:

```js
// (a) placeholder check on the VALUE, not the line — all-same-char hex is a placeholder; real keys
//     are high-entropy. A bare bytes32 constant (no secret-var name) is simply never matched.
const isPlaceholderHex = (v) => /^(.)\1+$/.test(v.replace(/^0x/i, "").toLowerCase());

// (b) self-identifying token shapes — flagged EVERYWHERE, including test/fixture files.
const TOKEN_SHAPES = [
  ["jwt", /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
  ["github-pat", /\bghp_[A-Za-z0-9]{36}\b/],
  ["aws-access-key", /\bAKIA[0-9A-Z]{16}\b/],
  ["pem-private-key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  // …plus a Circle `TEST_API_KEY:hex:hex` shape.
];

// (c) drop the blanket test-file skip; a real key assigned to a SECRET_VARS name is caught in tests
//     too. For legitimate PUBLIC test vectors (e.g. a Hardhat key used to test redaction), use an
//     AUDITABLE inline directive instead of a silent skip:
if (/secret-scan-allow/.test(line) || /secret-scan-allow/.test(lines[i - 1] ?? "")) continue;
```

Positive control that a no-op path cannot satisfy — assert the specific sentinel is **absent**, that
the secret was **consumed** (a *conditional* marker emitted only after `getSecret` ran), and that the
secret actually **drove** the result; treat a throw as a failure, not a skip:

```js
try {
  const out = sh("… run the redaction harness …", { maxBuffer: 1 << 24 });
  if (out.includes(SENTINEL_VALUE)) fail("leaked the sentinel");
  else if (!/secret\(s\) were consumed/.test(out)) fail("secret path never ran");
  else if (!/verdict:\s*PAYOUT/.test(out)) fail("secret didn't drive the decision");
} catch (e) { fail(`positive control could not run: ${e.message}`); } // NOT a silent skip
```

Also: sniff for a NUL byte before scanning (`readFileSync(f,"utf8")` does **not** throw on binary — it
returns a lossy string), and anchor file-name patterns (an unanchored `keystore` matches
`keystoreManager.ts`).

## Prevention

- **A gate must be proven non-vacuous across SHAPES, not just "it fails on one planted key."** Keep a
  negative-test set: a key in a `.test.ts`, a JWT, a GitHub PAT, a PEM block — the gate must catch
  every one, and pass clean afterwards.
- **Apply allowlists to the candidate value, never the whole line.** A line-level allowlist silently
  neutralizes the detector.
- **Prefer an auditable `…-allow` inline directive** over skipping whole file classes; a blanket skip
  is an invisible hole.
- **A positive control must be falsifiable** — key it on something a no-op/placeholder run cannot
  produce (consumption marker + secret-driven output + sentinel-absence), and make an exception RED.
- **Keep the doc's claims scoped to what the tool actually does** (see the companion fix: the
  security doc over-credited the gate with bundle/DB/log coverage it never performed).
- **Wire the gate into CI** so "blocking" is true, not aspirational.

## References

- PR #7 review todos `073` (false-negative vectors), `079` (anchoring/cwd/gitignore polish),
  `075` (scope the security-doc claims), `076` (run the gate in CI).
- Related: [`chainlink-cre-ts-sdk-confidential-workflow-wiring.md`](../integration-issues/chainlink-cre-ts-sdk-confidential-workflow-wiring.md)
  (the CRE harness the positive control drives).
