# Vouch — Demo Flow (2–4 min video script)

This is the script for the ETHOnline 2026 submission video. It walks the **canonical 6-step flow**
once, and also gives a **standalone demo path per track** so each prize is demonstrable in
isolation (per architecture reviewer M5) — judges for any one track can verify that track without
watching the others.

> **Rule reminder:** show real output only. No faked transactions, no hard-coded chain results.
> Unconfigured integrations show an explicit "not configured" state — do not stage around it.

---

## The canonical 6-step flow

1. **Client pays 20 USDC.** Client funds a job to fix an authentication bug (task fee = 20 USDC).
2. **Provider locks 100 USDC.** Provider posts capped guarantee collateral.
3. **Public tests pass → task fee released.** The 20 USDC task fee is released to the provider.
4. **Coverage window opens (24h).** A **private regression test** runs confidentially inside the
   CRE TEE.
5. **Regression proven → guarantee pays out.** The confidential verdict proves a covered
   regression; the client receives the 100 USDC guarantee.
6. **Onchain performance history updates.** The verdict becomes part of the provider's onchain
   reputation, indexed by The Graph.

Suggested narration arc (≈3 min): 0:00 problem framing → 0:30 steps 1–3 (fund, lock, release) →
1:15 step 4 (confidential coverage) → 2:00 step 5 (payout) → 2:30 step 6 (reputation) → 2:50 close.

---

## What to show on camera, per track

### Arc — agentic economy on Arc with the Circle Agent Stack
- The **agent's Circle wallet** (`apps/agent`) holding **USDC** on Arc testnet.
- A **real USDC transaction** on Arc, with the confirming **tx link on `testnet.arcscan.app`**
  open in the browser.
- The `apps/web` dashboard showing **live USDC balances** and the job/guarantee state served by
  `apps/api`.
- Callout: the wallet is **policy-bound** (per-tx / daily caps + destination allowlist) and holds
  only minimal funds — it never settles the guarantee.

### The Graph — live data feeding an AI decision
- A **live GraphQL query** (`queries/risk-agent-input.graphql`) against the deployed subgraph endpoint
  (Studio for `arc`, or local `graph-node`) returning real indexed provider reputation + risk bps.
- The **agent's risk quote** computed from that live data — show `upheldClaimRateBps` /
  `recentFailureRateBps` flowing into `premiumBps` and the quoted guarantee cap, stamped with
  `asOfBlock` + `scoringFnVersion`.
- The quote **changing after an upheld claim** (before/after), and the agent **refusing** (503 /
  `SUBGRAPH_STALE`) when pointed at a lagging index — no fabricated history.
- Callout: the data is **live, non-mocked**, and the quote is **impossible without** the subgraph
  (load-bearing). Full runbook: `docs/the-graph-demo.md`.

### Chainlink — confidential workflow, secret never leaks
- The **runnable-now proof:** `pnpm --filter @vouch/cre-workflow simulate:harness
  fixtures/valid-failure.json` — the deterministic local harness that drives the real decide+encode
  path (no CRE account/secrets). The npm `simulate` script itself is an **echo-only stub** that
  prints the CLI command; the harness is what produces real output today.
- The **terminal output** proving the verdict is produced from the enclave path — and the
  **secret (repo token / private test / pass-threshold) never appears in the logs**. Pause on the
  log output to make this explicit.
- The verdict `{jobId, covered, amount}` being the **sole gate** on the payout in the receiver
  contract.
- Callout: with the CRE CLI + a CRE account, `cre workflow simulate … --trigger-index 0
  --evm-tx-hash <ClaimOpened-tx> --evm-event-index <n>` output is **accepted as submission
  evidence** — live deployment is not required to qualify. (EVM-log trigger ⇒ `--evm-tx-hash`, not
  `--http-payload`.) Honest note: simulate is a single local node — not proof of on-chain delivery.

---

## Standalone demo path per track (each demonstrable in isolation)

Each path below stands alone so a single-track judge can verify that track end-to-end without the
others running.

### Arc standalone
1. Start `apps/api` + `apps/web`.
2. Run `apps/agent` pointed at Arc testnet with a funded Circle Agent Wallet.
3. Trigger a USDC transfer via the agent; show the balance change in the dashboard and the tx on
   `testnet.arcscan.app`.
   *Requires only:* Circle Agent Stack creds + Arc testnet RPC + funded wallet (native + USDC from
   the faucet).

### The Graph standalone
1. Deploy `packages/subgraph` (Studio for Arc mainnet, or local `graph-node` for `arc-testnet`);
   `pnpm --filter @vouch/subgraph health-check` shows it synced.
2. Run a GraphQL query directly against the endpoint (e.g. `queries/provider-history.graphql`, or
   `validate-endpoint.mjs` to prove the risk-agent-input contract).
3. Run `apps/agent`'s risk-quote path and show it consuming that live query result (and failing closed
   when the index lags).
   *Requires only:* a deployed subgraph endpoint + an Arc RPC (lag gate) + the agent's GraphQL client.
   No Circle or CRE dependency.

### Chainlink standalone
1. **Runnable now (no CRE account):** `pnpm --filter @vouch/cre-workflow simulate:harness
   fixtures/valid-failure.json` (PAYOUT), `…/valid-pass.json` (CLEAN_CLOSE), `…/invalid-commit.json`
   (REFUSE). Show the decision + 7-tuple payload; confirm no secret in the output.
2. **Submission evidence (needs the CRE CLI + a CRE account):** copy `.env`/`secrets.yaml` from the
   `.example` files (SENTINEL values), then
   `cre workflow simulate vouch-outcome-assurance --target staging-settings --non-interactive
   --trigger-index 0 --evm-tx-hash <ClaimOpened-tx-hash> --evm-event-index <n>`.
   ⚠️ EVM-log trigger ⇒ `--evm-tx-hash`/`--evm-event-index`, **not** `--http-payload`.
3. Show the enclave verdict in the terminal and confirm the secret is absent from the logs.
   *Requires only:* the workflow package (harness) — or additionally the CRE CLI + account for the
   CLI evidence. No Arc deploy or subgraph needed to prove the confidential step (the receiver wiring
   is shown separately in `packages/contracts`).

---

## Pre-record checklist
- [ ] Env templates copied and real (non-committed) values set for whichever track(s) you record.
- [ ] Arc wallet funded with **both** native (gas) and USDC from the faucet.
- [ ] Subgraph deployed and `_meta` shows no indexing errors.
- [ ] `cre workflow simulate` runs clean; scan the logs to confirm no secret leaks before recording.
- [ ] arcscan tx link opens to a real, confirmed transaction.
- [ ] Total runtime between 2 and 4 minutes.
