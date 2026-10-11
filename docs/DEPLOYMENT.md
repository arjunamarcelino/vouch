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

## Arc Mainnet deployment (Arc Microgrants)

**Network:** Arc mainnet — chain id **5042** (`eip155:5042`) · RPC `https://rpc.drpc.mainnet.arc.io`
· explorer `https://explorer.arc.io` · USDC predeploy `0x3600000000000000000000000000000000000000`
(same address as testnet; verified live to have bytecode — `Deploy.s.sol`'s `usdc.code.length > 0`
assertion passes). CRE identity is unchanged: `workflowId = keccak256("vouch-assurance-v1")`
= `0xd38944d8afd25c7f280faf6f59d673e021c285abb59160d25bc8d2a28fb5e467`,
`workflowName = bytes10("vouchclaim")` = `0x766f756368636c61696d…`.

### Contracts (live on Arc mainnet, 2026-10-12)

| Contract | Address | Deploy tx | Block |
|---|---|---|---|
| `AssuranceHub` | [`0xB30e054557533f28753B4ACdf646B393E2072bf9`](https://explorer.arc.io/address/0xB30e054557533f28753B4ACdf646B393E2072bf9) | [`0x5872bad6…`](https://explorer.arc.io/tx/0x5872bad67b2835a53a0a28b92b3da5829455dfc5a9232be5ed6b8f9cd98b5b6d) | 25456280 |
| `QuoteBondEscrow` | [`0x3ca2d854D5f042dd0ddd39Eaf80644be0e80048c`](https://explorer.arc.io/address/0x3ca2d854D5f042dd0ddd39Eaf80644be0e80048c) | [`0x7e4395c4…`](https://explorer.arc.io/tx/0x7e4395c4cdc76360b90f24a2c425f191f218c8ca0f602e4c7cb26f362f2e75b7) | 25456336 |

Deploy block: **25456280** (= mainnet subgraph `startBlock`). Deployer / operator EOA (all roles):
`0x9A39bC6C499C4f51336692871233164Ae621D52E`. `AssuranceHub.usdc()` verified = the canonical
`0x3600…0000` predeploy; total deploy gas ≈ 0.064 USDC.

### Deploy steps

1. Fill `packages/contracts/.env` (copy from `.env.example`): `ARC_MAINNET_RPC_URL`,
   `ARC_USDC_ADDRESS` (canonical predeploy), the two CRE identity values above,
   `CRE_WORKFLOW_OWNER` / `CRE_FORWARDER_ADDRESS` (operator relay EOA — trusted-relay model, non-zero
   suffices), `ADMIN_ADDRESS` / `EVALUATOR_ADDRESS` / `FEE_RECIPIENT_ADDRESS`, `PRIVATE_KEY`
   (deployer funded with real USDC for gas).
2. Deploy (Foundry `arc_mainnet` alias is wired in `foundry.toml`):
   ```
   cd packages/contracts
   forge script script/Deploy.s.sol:Deploy --rpc-url arc_mainnet --broadcast
   forge script script/DeployEscrow.s.sol:DeployEscrow --rpc-url arc_mainnet --broadcast
   # optional verify: --verify --verifier blockscout --verifier-url https://explorer.arc.io/api/
   ```
3. Prove one real lifecycle on mainnet (`openJob → acceptJob → approve → withdrawCollateral`, or a
   covered claim) and record the tx hashes in the Contracts table / a lifecycle table here.
4. Repoint the app: set `CHAIN_ENV=arc-mainnet` in the `apps/*` envs so `withvouch.xyz` serves mainnet.
5. (Optional — only if The Graph supports the `arc` mainnet network) update the subgraph per the
   lockstep checklist below and redeploy. The microgrant does **not** require the subgraph; the
   escrow/guarantee/payout flow is authoritative on its own. If Studio rejects `arc`, demo the
   contract flow directly — the agent quote path fail-closes without a live subgraph by design.

### One-line post-deploy edits (scaffolding already in place)

- `packages/subgraph/networks.json` → the `"arc"` entry is pre-stubbed with a zero address +
  `startBlock 0` (fail-closed placeholder); replace both with the real mainnet address + deploy block.
- `packages/subgraph/subgraph.yaml` → change `network: arc-testnet` → `network: arc`, and the
  `address` + `startBlock` to match networks.json (preflight enforces the match; run
  `pnpm --filter @vouch/subgraph preflight arc`).

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
