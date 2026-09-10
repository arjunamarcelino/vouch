# The Graph — Live Demo Runbook & Checklist

This is the operator checklist proving the Vouch subgraph is **load-bearing**: the risk agent's
guarantee quote depends on live indexed Arc data, and it **fails closed** (never fabricates history)
when the index is unavailable or materially stale.

> Prereqs: `AssuranceHub` deployed to Arc (address + deploy block in `packages/subgraph/networks.json`),
> the subgraph deployed (Studio for `arc`, or local `graph-node` for `arc-testnet`), and env set:
> `SUBGRAPH_URL`, `SUBGRAPH_DEPLOYMENT_ID`, `SUBGRAPH_STATUS_URL`, `ARC_RPC_URL`,
> `SUBGRAPH_MAX_LAG_BLOCKS`, `SUBGRAPH_MAX_STALENESS_SECONDS`. See `.env.arc-testnet.example`.

---

## 1. Generate real Arc contract events

Drive a real job lifecycle on Arc (Foundry scripts in `packages/contracts`, or the app UI). A covered
claim produces the richest history:

- [ ] `openJob` (client funds task fee + guarantee terms) → `JobCreated` + `JobFunded`
- [ ] `acceptJob` (provider locks collateral) → `ProviderAccepted`
- [ ] `submitDeliverable` → `DeliverableSubmitted`
- [ ] `resolveInitialEvaluation(approve)` → `InitialEvaluationResolved` + `CoverageStarted` (+ `ServiceFeePaid`)
- [ ] `openClaim` (client, in coverage) → `ClaimOpened`
- [ ] CRE `onReport(covered=true)` → `ConfidentialEvaluationResolved` + `GuaranteePaid` (+ `CollateralReleased` remainder)

Record the tx hashes; open one on `testnet.arcscan.app` for the video.

## 2. Confirm they are indexed

```bash
pnpm --filter @vouch/subgraph health-check
```

- [ ] Prints `✓ HEALTHY` with `latestIndexedBlock`, `chainHead`, and `lag` within budget.
- [ ] `deployment` matches `SUBGRAPH_DEPLOYMENT_ID`.
- [ ] Exit code `0`. (A behind/errored index prints `✗ UNHEALTHY` and exits `1`.)

## 3. Query them from the live endpoint

```bash
pnpm --filter @vouch/subgraph validate-endpoint -- <providerAddress>
```

- [ ] `✓ VALID` — every risk-agent-input field present, typed, and fresh.
- [ ] Spot-check with the sample queries in `packages/subgraph/queries/` against the live endpoint:
  - [ ] `provider-history.graphql` — counters + risk snapshots move after the claim.
  - [ ] `open-coverage.graphql` — LOCKED coverage windows.
  - [ ] `claims.graphql` — the claim + its confidential verdict.
  - [ ] `risk-agent-input.graphql` — the exact agent input (snapshot + trailing window + `_meta`).

## 4. Show the risk agent changing its quote after a successful (upheld) claim

- [ ] Run the agent against the provider **before** the claim resolves; note `recommendedGuaranteeCap`
      and `premiumBps` (rationale prints `upheldClaimRate`/`recentFailureRate` in bps).
      ```bash
      pnpm --filter @vouch/agent start
      ```
- [ ] Resolve the claim as **covered** (step 1's `onReport`), confirm indexing (step 2).
- [ ] Re-run the agent. The quote **changes**: an upheld claim raises `upheldClaimRateBps`, which
      widens `premiumBps` (higher risk premium) → a larger `recommendedGuaranteeCap`, all computed
      from live indexed data. Every quote is stamped with `asOfBlock` + `scoringFnVersion` (auditable).

## 5. Show safe handling of indexing lag (fail closed)

Demonstrate the agent **refusing** rather than fabricating history:

- [ ] Point the agent at a lagging/paused index, or an index whose head is far behind
      (e.g. temporarily lower `SUBGRAPH_MAX_LAG_BLOCKS`, or pause `graph-node`).
- [ ] The agent throws `SUBGRAPH_LAGGING`/`SUBGRAPH_STALE` and produces **no quote** (non-zero path);
      the API returns **503**, never a 200 with empty/fake history.
- [ ] Restore the index; the agent quotes again. Contrast with a **new provider** (fresh index, no
      history): the agent returns a conservative 1.5x-base quote (not a refusal, not fabricated).

---

### Why this proves The Graph is load-bearing
The agent has **no other source** of provider history: the contract stores no reputation aggregates
(ADR-003), there is no DB mirror, and there is no fixture. Remove or stale the subgraph and the agent
can only refuse — which is exactly what steps 4–5 show.
