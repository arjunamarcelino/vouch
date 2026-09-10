# ADR-002 — Confidential verification via CRE TEE, not a plain server

**Status:** Accepted

## Context

The core novelty of Vouch is proving a **covered failure after payment** using a **private** test
or private evaluation criteria. That verification handles genuinely sensitive material: the private
regression test itself, the pass/fail thresholds, and the repository credentials needed to fetch
the code under test. If any of that leaks — to a node operator, to Postgres, to onchain metadata,
or to the subgraph — providers can game the guarantee and the private criteria lose their value.

A plain offchain API server *could* run the test, but it cannot **prove** to a client or a judge
that the operator never saw the secret material. We need a verification path whose confidentiality
is a hard guarantee, not a promise, and whose verdict can be trusted enough to move money.

## Decision

Confidential verification runs inside a **Chainlink CRE Confidential Workflow** in a **TEE**.
Secrets are released by the **Vault DON directly into the enclave**; runtime data, secrets, and
computation are confidential from node operators. The workflow fetches the private test/criteria at
runtime (never inlined in source, since the source/binary are *not* confidential), evaluates the
regression, and declassifies only the minimal verdict `{jobId, regressed, amount}` for a DON-signed
report.

**TypeScript SDK reality (per plan §17.2):** the TS SDK has **no** `handlerInTee` / `TeeRuntime` /
`usingTheDons`. In TypeScript, confidentiality is delivered by **`ConfidentialHTTPClient`** (secret
injected inside the enclave via `{{.token}}` templating, never in node memory) within a normal
`handler`. If the prize hard-requires the `HandlerInTee` symbol, write the confidential handler in
**Go**, where `cre.HandlerInTee` exists.

## Consequences

- **Positive:** private tests, criteria, and repo credentials are provably secret from operators.
  Only `hashes / commitments / verdicts` ever leave the enclave. This is the guarantee a plain
  server cannot provide.
- **Positive:** evidence via `cre workflow simulate` is explicitly accepted by the prize — no
  live private-beta access required to qualify.
- **Negative / watch-outs:** source code is *not* confidential, so private logic must be fetched
  at runtime — a design constraint on the workflow. The exact TS `EVMClient.writeReport` signature,
  Arc `chainSelectorName`, and SDK/CLI versions must be confirmed at build time.
- **Follow-on:** the enclave verdict still needs a trust-minimized path to move funds on Arc — see
  ADR-004.
