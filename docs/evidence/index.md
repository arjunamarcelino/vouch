# Evidence Index — sponsor submission artifacts

This is the map of `docs/evidence/`: what each artifact proves, how it's labeled, and which prize
requirement it backs. The honesty rules and the "never commit" list live in
[`README.md`](README.md) (read it first) — this file is the **index + provenance table**.

> **Honesty rule (repeated):** nothing here fakes a transaction or hard-codes a chain result. An
> artifact exists **only after** a real `cre workflow simulate` run or the deterministic
> `harness.ts`, with volatile fields normalized. If a run hasn't happened, the file is absent — an
> empty slot is honest, a fabricated one is not.

---

## Labels (required on every artifact)

The two-axis labeling taxonomy (enclave: `TEE` / `fallback` / `harness` · broadcast: `dry-run` /
`--broadcast`) is defined once in **[`README.md`](README.md#labeling-required-on-every-artifact)** —
see there. Every artifact in the table below must carry both axes.

---

## CRE Confidential Workflow evidence (Chainlink track — $2,000)

| Artifact | Produced by | Proves | Label |
|---|---|---|---|
| `simulate-valid-failure.txt` | `simulate:harness fixtures/valid-failure.json` (or CLI) | **Covered failure → PAYOUT**; 224-byte 7-tuple; secret absent from logs | harness/TEE · dry-run |
| `simulate-valid-pass.txt` | `…/valid-pass.json` | **No covered failure → CLEAN_CLOSE**, no report | harness/TEE · dry-run |
| `simulate-invalid-commit.txt` | `…/invalid-commit.json` | Commit mismatch → **REFUSE** (fail-closed) | harness/TEE · dry-run |
| `simulate-replay.txt` | `…/replay.json` | Replay handled → no double action (idempotency) | harness/TEE · dry-run |
| `simulate-timeout-error.txt` | `…/timeout-error.json` | Upstream timeout → **REFUSE** (fail-closed) | harness/TEE · dry-run |
| `simulate-cli-payout.txt` | **live `cre workflow simulate`** (cli v1.33.0) | **`REPORTED:PAYOUT`** via the official CLI: Nitro TEE sim → getJob (jobId 4, ClaimPending) → confidential fetch 200 → decide PAYOUT → consensus → dry-run writeReport. Secret stays a `{{.token}}` template. | cre CLI/TEE-sim · dry-run |
| `MANIFEST` | capture step | Exact command, `cre --version`, `@chainlink/cre-sdk` version, **per-file sha256** | — |

**How to (re)generate** (runnable now, no CRE account):
```bash
pnpm --filter @vouch/cre-workflow simulate:harness fixtures/valid-failure.json
```
CLI submission evidence (needs the CRE CLI + a CRE account) — **EVM-log trigger, so use
`--evm-tx-hash`/`--evm-event-index`, not `--http-payload`**:
```bash
cre workflow simulate vouch-outcome-assurance --target staging-settings --non-interactive \
  --trigger-index 0 --evm-tx-hash <ClaimOpened-tx-hash> --evm-event-index <n>
```
Before committing any capture: run `pnpm gate:secrets` (the blocking grep-gate) — it must pass, and
the artifact must be labeled on both axes.

### What the simulate evidence does and does NOT prove
- ✅ The confidential decide+encode path runs; the 7-tuple matches `AssuranceHub.onReport`'s decoder;
  the secret never appears in output.
- ❌ It is **not** proof of on-chain delivery (simulate is a single local node, no DON quorum) and
  **not** a Nitro attestation (the SDK exposes none). See [`../security.md`](../security.md) §3.

---

## The Graph evidence ($5,000)

Not a static file — captured live in the demo + reproducible via the subgraph tooling. The subgraph is
**live on Subgraph Studio**: slug `vouch`, v0.0.2, endpoint
`https://api.studio.thegraph.com/query/1760065/vouch/v0.0.2` (deployment CID
`QmaoAwseMjoD3EMFwhQf3KBqqyac7sa4anpUBxK7iwEM8p`, start block `61747921`, network `eip155:5042002`).
- `pnpm --filter @vouch/subgraph health-check` → synced, no indexing errors, lag in budget.
- `pnpm --filter @vouch/subgraph validate-endpoint -- <provider>` → every `risk-agent-input.graphql`
  field present against the live Studio endpoint.
- The agent quote **changing** after the upheld claim on jobId 1 is indexed (`lastUpheldClaimRateBps`
  `10000` → `5000`; next quote `premiumBps 2000`, reason `UPHELD_CLAIM_RISK`), and a **503** when the
  index is stale. Runbook: [`../the-graph-demo.md`](../the-graph-demo.md).

## Arc / Circle Agent Stack evidence ($3,500)

- Confirmed **`testnet.arcscan.app/tx/…`** links (Arc testnet, chain `5042002`) for the real USDC
  lifecycle: agent `postBond` `0x5d9d1af8…` and its refund `0xd668c466…` (Circle wallet
  `0x482e0a53d97b0a9be1045f58cdbf9d244bd303be`); covered-claim payout on jobId 1 `0x9659db91…`
  (`GuaranteePaid` → `ClaimPaid`); no-claim `withdrawCollateral` on jobId 3 `0x0edec39d…`. Callout:
  policy-capped Circle wallet, contract-execution (not a bare transfer), agent never touches guarantee
  principal (settlement is the CRE receiver path). Hashes are captured in the deployment runbook §18.

---

## Requirement → evidence crosswalk

Full mapping in [`../prize-requirements.md`](../prize-requirements.md). In short: **Graph** →
health-check + live Studio query + re-quote + fail-closed; **Arc** → arcscan `postBond`/refund +
lifecycle payout/withdraw txs + FE/BE dashboard; **Chainlink** → the live `simulate-cli-payout.txt`
(`REPORTED:PAYOUT`, cli v1.33.0) + five deterministic `simulate-*.txt` harness captures + MANIFEST
(`handlerInTee`, secret-never-leaks, 7-tuple = sole `onReport` gate).
