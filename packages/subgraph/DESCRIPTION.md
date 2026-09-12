# Vouch Subgraph — Studio listing copy

Paste-ready metadata for the Subgraph Studio page (slug `vouch`).

---

## Short description (one line — manifest `description:` / Studio subtitle)

> Load-bearing reputation index for Vouch — turns `AssuranceHub` outcome-assurance events on Arc into
> the on-chain provider performance history that an autonomous risk agent prices coding-work guarantees from.

## Full description (Studio "Description" field)

**Vouch** is a confidential, post-completion **outcome-assurance protocol** for AI-agent coding work.
A provider voluntarily locks a capped, provider-funded **guarantee**; during a coverage window after
payment, a **confidential regression test** can prove a covered failure and trigger a service-credit
payout to the client. This subgraph is the protocol's **authoritative reputation layer**.

Built **from scratch**, it indexes every `AssuranceHub` lifecycle event on **Arc** and derives each
provider's performance history — the signal an autonomous **risk agent** consumes over live GraphQL to
size and price guarantees. The contract stores **no** reputation aggregates on-chain and there is **no
database mirror or fixture**: remove or stale this subgraph and the agent can only refuse. That makes
The Graph genuinely **load-bearing**, not a passive mirror.

**What it indexes** — the full assurance lifecycle across 13 events
(`JobCreated`, `ProviderAccepted`, `DeliverableSubmitted`, `InitialEvaluationResolved`,
`CoverageStarted`, `ClaimOpened`, `ConfidentialEvaluationResolved`, `ClaimTimedOut`, `GuaranteePaid`,
`CollateralReleased`, `JobExpired`, `JobCancelled`, `ServiceFeePaid`) into 13 entities:
`Protocol · Provider · Client · Job · Coverage · Claim · Submission · InitialEvaluation ·
ConfidentialEvaluation · GuaranteePayout · CollateralMovement · ProviderRiskSnapshot ·
ProviderDailyMetric`.

**Risk features, as integer basis points** — the `Provider` and `ProviderRiskSnapshot` entities expose
auditable, float-free reputation signals the agent quotes on:
`upheldClaimRate`, `claimFrequency`, `averageCoverageRatio`, and `payoutToCoveredValue` (all in bps,
with a `-1` sentinel for undefined ratios), plus a trailing-window `ProviderDailyMetric` rollup and a
`hasEnoughHistory` gate. A proven (upheld) claim raises the provider's risk and makes the next quote
more expensive; a clean coverage window that closes with no claim improves it.

**Confidentiality & honesty** — only ids, amounts, addresses, booleans, and `bytes32` commitments are
ever indexed. Private test contents, evaluation criteria, thresholds, and credentials live exclusively
inside the Chainlink CRE TEE and never touch events, IPFS, or this subgraph. Consumers apply a
fail-closed freshness gate (`_meta` block + indexing-error check) and refuse to serve stale reputation
rather than fabricate history.

**Network:** Arc testnet (`eip155:5042002`), `AssuranceHub` at
`0xB30e054557533f28753B4ACdf646B393E2072bf9`.

---

## Paste-ready blurb (single Studio "Description" field)

Prose version of the above for pasting into the one Studio description field (kept here so the two
never drift — do not maintain a separate file):

```text
Vouch is a confidential, post-completion outcome-assurance protocol for AI coding work: a provider locks a capped, self-funded guarantee, and during a coverage window after payment a confidential regression test can prove a covered failure and pay the client a service credit.

Built from scratch, this subgraph indexes every AssuranceHub lifecycle event on Arc and derives each provider's performance history — the live signal an autonomous risk agent prices guarantees from. No reputation is stored on-chain and there is no DB mirror: stale the subgraph and the agent can only refuse, so The Graph is genuinely load-bearing.

It exposes auditable, float-free risk features in basis points (upheld-claim rate, claim frequency, coverage ratio, payout-to-covered-value) across 13 entities. Only ids, amounts, addresses and bytes32 commitments are indexed — private tests, criteria and credentials stay inside the Chainlink CRE TEE.

Network: Arc testnet (eip155:5042002).
```

---

## Suggested Studio metadata

- **Categories:** DeFi · Analytics · AI (AI tooling / AI use case)
- **Website:** the Vouch repo README / project site
- **Source code:** https://github.com/arjunamarcelino/vouch (`packages/subgraph`)
- **Query (HTTP):** `https://api.studio.thegraph.com/query/1760065/vouch/<version>`

## Example query (provider reputation the agent reads)

```graphql
{
  provider(id: "0x827a7342a27b8220102704a8fb82985caec18050") {
    jobsAccepted
    claimsUpheld
    claimsRejected
    totalPayoutAmount
    lastUpheldClaimRateBps
    lastSampleSize
    lastHasEnoughHistory
  }
  _meta { block { number } hasIndexingErrors }
}
```
