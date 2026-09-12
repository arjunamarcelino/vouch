# Vouch — Live Deployment (Arc testnet)

Public record of the live end-to-end deployment. **Public values only** — no keys, API secrets, or
the entity secret appear here (those live in gitignored `.env` / `.env.deploy` / `recovery/`).

**Network:** Arc testnet — chain id **5042002** (`eip155:5042002`) · explorer `https://testnet.arcscan.app`
· USDC (native + ERC-20) `0x3600000000000000000000000000000000000000` (6-dec ERC-20 interface).

## Contracts (Foundry)

| Contract | Address | Deploy tx |
|---|---|---|
| `AssuranceHub` | [`0xB30e054557533f28753B4ACdf646B393E2072bf9`](https://testnet.arcscan.app/address/0xB30e054557533f28753B4ACdf646B393E2072bf9) | [`0x72c92d8d…`](https://testnet.arcscan.app/tx/0x72c92d8d18e3248982ad0f811b40c1c6f69c70c8b0e0f6d4a5f534e51d0bb9cc) |
| `QuoteBondEscrow` | [`0x3ca2d854d5f042dd0ddd39eaf80644be0e80048c`](https://testnet.arcscan.app/address/0x3ca2d854d5f042dd0ddd39eaf80644be0e80048c) | [`0x3a7cad0c…`](https://testnet.arcscan.app/tx/0x3a7cad0c974d82c23bfee9f997cf601fce411058a21736557bd5c3afa7d87ecf) |

Deploy block: **61747921** (= subgraph `startBlock`). CRE identity: `workflowId = keccak256("vouch-assurance-v1")`,
`workflowName = "vouchclaim"` (bytes10); on testnet the forwarder/relay + admin/evaluator/feeRecipient roles
are the operator EOA (see `docs/security.md` for the honest trust model — trusted-relay, no on-chain DON-sig).

## The Graph

- **Subgraph Studio** slug `vouch`, version `v0.0.2` — Studio accepted `arc-testnet`.
- Query endpoint: `https://api.studio.thegraph.com/query/1760065/vouch/v0.0.2`
- Deployment CID: `QmaoAwseMjoD3EMFwhQf3KBqqyac7sa4anpUBxK7iwEM8p`
- Health: synced to chain head, `hasIndexingErrors: false`, lag within budget.
- Manifest points at `AssuranceHub` above from `startBlock 61747921` (`subgraph.yaml` / `networks.json`).

## Circle Agent Stack (agent wallet)

- Agent wallet (SCA, ARC-TESTNET): [`0x482e0a53d97b0a9be1045f58cdbf9d244bd303be`](https://testnet.arcscan.app/address/0x482e0a53d97b0a9be1045f58cdbf9d244bd303be)
- Entity secret registered via SDK (recovery file kept off-repo). One-time `approve(QuoteBondEscrow)`:
  [`0x748a94…`](https://testnet.arcscan.app/tx/0x748a94614c5245c1671b4e05921aa99165cda608defed0056ad1a0a6c78e9d4a)

## End-to-end lifecycle proven live

| Scenario | Result | Tx |
|---|---|---|
| **Covered claim** (jobId 1) | client received the 2-USDC guarantee (`GuaranteePaid`), state → `ClaimPaid` | [`0x9659db91…`](https://testnet.arcscan.app/tx/0x9659db91e1ca8c8781cd44a21fa61719c23ade64605641c704e533e41a400bce) |
| **Rejected claim** (jobId 2) | `onReport(covered=false)` → back to `InitiallyApproved`, no funds moved | — |
| **No-claim** (jobId 3) | coverage expired, `withdrawCollateral` → `Completed`, 0.5-USDC collateral returned (subgraph `jobsCompleted=1`) | [`0x0edec39d…`](https://testnet.arcscan.app/tx/0x0edec39dc4748cbcbd03fe0cd78c9c124ff0ecaf4374241a1a5d06ef8022a66a) |
| **Real agent bond** | policy-capped Circle wallet → `escrow.postBond` (1 USDC), from a reputation-priced signed quote | [`0x5d9d1af8…`](https://testnet.arcscan.app/tx/0x5d9d1af8a0516fbf588e9962bcc4928c40a088e820d15707c2be10adfded040a) |
| **Bond refund** | `refundBond` → escrow 1→0, agent wallet restored (round-trip) | [`0xd668c466…`](https://testnet.arcscan.app/tx/0xd668c466666465d5db9360218c220c9cbc76f212961946ab51a0ea5404909fd4) |

**Reputation loop (The Graph → agent):** after the upheld claim indexed, the provider's
`lastUpheldClaimRateBps` moved (10000 → 5000 as the rejected claim followed), and a fresh agent quote
priced it in — `premiumBps 2000` (capped) with reason `UPHELD_CLAIM_RISK` and a lowered guarantee limit.
This is the canonical "next quote is more expensive" step, proven end-to-end on live data.

## Chainlink CRE evidence

Two layers, both in [`docs/evidence/`](evidence/index.md) (`simulate-*.txt` + `MANIFEST`,
sha256-checksummed), all with **no secret in the output** (blocking `pnpm gate:secrets`; the
credential stays a `{{.token}}` template):

- **Deterministic harness** — all 5 fixtures: verdicts PAYOUT / CLEAN_CLOSE / REFUSE (SDK-free, runs
  with no CRE account).
- **Live `cre workflow simulate`** (official CLI, cli v1.33.0) — `docs/evidence/simulate-cli-payout.txt`:
  **`REPORTED:PAYOUT`** end-to-end against the live Arc deployment — Nitro TEE simulator → `getJob`
  (jobId 4, `ClaimPending`) → confidential HTTP fetch (200) → decide PAYOUT → consensus → **dry-run
  `writeReport`**. EVM-log trigger via `--evm-tx-hash 0x029c4a58…988a57 --evm-event-index 0`. The
  workflow also gates correctly fail-closed (`REFUSED:NOT_CLAIM_PENDING` on a settled job,
  `REFUSED:FETCH_FAILED` on an unreachable test API).

Two CRE-runtime bugs were found + fixed while getting the CLI simulate to run end-to-end: the config
schema's `z.string().url()` (rejected by the javy/WASM zod) → `z.string().trim().min(1).refine(startsWith "https://")`
(keeps an https guarantee on the credential destination without the WASM-incompatible `.url()`), and
`emitReport` throwing on a dry-run SUCCESS-without-txHash. A live enclave **deploy** (`--broadcast` on a
DON) still needs private-beta enrollment; the simulate PAYOUT above is the accepted evidence.

## Redeploy checklist (update these in lockstep)

When `AssuranceHub` is redeployed, the deployed coordinates live in several tracked files across two
packages. Update **all** of them in the same commit — the subgraph preflight (`packages/subgraph/scripts/preflight.mjs`)
will FAIL the deploy if `subgraph.yaml` and `networks.json` disagree, but the CRE files are not
cross-checked, so they need manual care.

1. **This file** — the `Contracts` table addresses + deploy-tx links, and the deploy block.
2. `packages/subgraph/subgraph.yaml` — `dataSources[0].source.address` + `source.startBlock`.
3. `packages/subgraph/networks.json` — `arc-testnet.AssuranceHub.address` + `.startBlock` (must equal #2; preflight enforces this).
4. `packages/cre-workflow/config.staging.json` — `assuranceHubAddress`, `owner`, and `workflowId` (only if the workflow identity changes; `workflowId = keccak256("vouch-assurance-v1")`).
5. `packages/cre-workflow/project.yaml` — `workflow-owner-address`.

Then re-verify: `pnpm --filter @vouch/subgraph preflight` (green) → subgraph deploy → `cre workflow simulate` → regenerate `docs/evidence/` + its `MANIFEST` sha256 sums.
