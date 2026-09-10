# `docs/evidence/` — sanitized Chainlink CRE submission evidence

This directory holds the **sanitized** artifacts that back the Chainlink "Best Confidential Workflow"
submission. See [`../chainlink-confidential-workflow.md`](../chainlink-confidential-workflow.md) §7
for the full required-evidence list.

> **Honesty rule:** no file here fakes a transaction or hard-codes a chain result. Nothing is
> fabricated — evidence is committed **only** after a real `cre workflow simulate` run (or the
> deterministic local harness), with the volatile fields normalized. If a run has not happened, the
> file does not exist yet.

## What goes here

- **`simulate-<fixture>.txt`** — one per fixture (`valid-pass`, `valid-failure`, `invalid-commit`,
  `replay`, `timeout-error`). The sanitized terminal output of a `cre workflow simulate` run (or the
  `node --import tsx harness.ts fixtures/<f>.json` fallback). Volatile fields (log timestamps,
  dry-run `0x000…` hashes) are normalized so the file is reproducible.
- **`MANIFEST`** — records the exact command, `cre --version`, the `@chainlink/cre-sdk` version, and a
  **per-file sha256** so every artifact here is verifiable.

## Labeling (required on every artifact)

Each file must state, in-band, both axes so a reviewer is never misled:

- **TEE (`handlerInTee`) vs fallback** — full-enclave evidence, or the credential-only
  `ConfidentialHTTPClient`-in-normal-handler fallback (which does **not** protect response data), or
  the deterministic local harness.
- **dry-run vs `--broadcast`** — a simulated (no real onchain write) run, or a real Arc transaction.

## Never commit here

- ❌ Credentials, bearer tokens, API keys, or the real test-API host.
- ❌ Private test content, criteria, thresholds, or `passRate` values that could invert the criteria.
- ❌ Raw `--broadcast` output that has not passed the blocking grep gate.

The blocking grep gate (a pattern scan over source **and** `docs/evidence/*`, **plus** a positive
"secret-path-executed" assertion) must pass before any file is committed here — it catches real
secrets in addition to sentinels.
