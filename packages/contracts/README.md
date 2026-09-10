# @vouch/contracts

Foundry package for **AssuranceHub** — the canonical onchain financial settlement contract for the
Vouch confidential outcome-assurance protocol, deployed to **Circle Arc**.

## Responsibilities

- **Owns all onchain financial settlement on Arc.** Escrow of the client **task fee** + optional
  **service fee**, the provider-funded **guarantee** (collateral), the post-acceptance **coverage
  window**, the capped **service credit** payout, and all refunds.
- Enforces the `AssuranceJob` state machine: `Funded → AcceptedByProvider → Submitted →
  InitiallyApproved → (ClaimPending → ClaimPaid) | Completed`, plus `Cancelled` / `Expired`.
- **Two trust surfaces:** `EVALUATOR_ROLE` resolves the public submission (approve/reject); the CRE
  receiver (`ReceiverBase`: forwarder + workflow identity) is the **only** path that finalizes a
  confidential claim and can trigger a guarantee payout.
- **Solvency-guaranteed:** maintains `totalLiabilities` and holds the invariant
  `usdc.balanceOf(this) >= totalLiabilities` (proven by a stateful Foundry invariant suite).
- Uses the **6-decimal USDC ERC-20** interface for all accounting; **non-payable** (no `msg.value`).
- Emits the canonical events (`JobCreated`, `JobFunded`, `ProviderAccepted`, `DeliverableSubmitted`,
  `InitialEvaluationResolved`, `CoverageStarted`, `ClaimOpened`, `ConfidentialEvaluationResolved`,
  `GuaranteePaid`, `CollateralReleased`, `JobExpired`, `JobCancelled`, `ServiceFeePaid`) that the
  subgraph indexes as the reputation source of truth.

## Security

- OZ v5 `SafeERC20` + storage `ReentrancyGuard` (evm_version=paris) + strict Checks-Effects-Interactions.
- `AccessControl` (DEFAULT_ADMIN_ROLE + EVALUATOR_ROLE) + `Pausable` (pauses **entries only**, never
  fund exits) with **bounded authority: no admin function can seize principal**
  (`test_NoAdminCanSeizeFunds`).
- Anti-abuse: `settled` + `claimFiled` latches + monotonic state prevent double payout, replayed
  evaluation, duplicate withdrawal, and claim-after-expiry. `resolveClaimTimeout` prevents a stalled
  CRE from stranding collateral.
- Only salted **commitments** (bytes32) are stored for private material — never preimages.

## Trust assumptions (see docs/decisions/005)

- The **CRE forwarder** may be a KeystoneForwarder or an authorized relay EOA. With an EOA relay and
  no on-chain DON-signature verification, the relay operator is a **trusted oracle** able to force a
  covered payout on any pending claim (it cannot pay an arbitrary address — recipients are job-bound).
  Production use requires a real KeystoneForwarder or in-contract signature verification.
- The **initial evaluator** is a trusted liveness/correctness oracle (can reject/approve; cannot pay
  itself). Hold `DEFAULT_ADMIN_ROLE` and `EVALUATOR_ROLE` in a multisig.
- The **service fee** is protocol revenue (admin may set `feeRecipient`); it is not principal.

## Non-responsibilities

- **NOT** offchain data (job titles, descriptions, UI cache) — that lives in Postgres/Prisma
  (`packages/db`), never a source of truth for money or reputation.
- **NOT** secret material — private tests, evaluation criteria, and repo credentials live only inside
  the Chainlink CRE confidential (TEE) layer (`packages/cre-workflow`).
- **NOT** reputation aggregation — provider performance counters are derived in the subgraph
  (`packages/subgraph`), not stored onchain.

## Layout

```
src/
  AssuranceHub.sol         core settlement contract (SafeERC20 + ReentrancyGuard + AccessControl + Pausable)
  ReceiverBase.sol         abstract CRE receiver: forwarder + workflow-identity gating (packed metadata), ERC-165
  interfaces/IReceiver.sol Chainlink CRE receiver interface (onReport + IERC165)
  libraries/Errors.sol     gas-cheap custom errors
script/
  Deploy.s.sol             env-driven, fail-loud deploy (no guessed addresses)
  sync-abis.mjs            regenerates BOTH packages/shared/src/abis/assuranceHub.ts and
                           packages/subgraph/abis/AssuranceHub.json from the build (single source of truth)
test/
  AssuranceHubBase.sol     shared setUp + actors + CRE report/metadata helpers + state driver
  AssuranceHub.t.sol       happy transitions + timeout + exits
  AssuranceHub.neg.t.sol   auth / wrong-state / expiry / replay / pause / no-seize
  AssuranceHub.fuzz.t.sol  monetary conservation + payout<=cap
  AssuranceHub.reentrancy.t.sol  ReentrantUSDC on every outbound path
  invariant/               solvency + conservation + shadow-match (bounded handler)
  mocks/{MockUSDC,ReentrantUSDC}.sol
```

## Commands

```bash
pnpm --filter @vouch/contracts build           # forge build
pnpm --filter @vouch/contracts test:contracts  # forge test -vvv (41 tests incl. invariants)
pnpm --filter @vouch/contracts abi:sync         # regenerate the shared TS ABI + subgraph JSON ABI

# Deploy (Blockscout verify). Copy .env.example -> .env and fill in first. Never commit real keys.
forge script script/Deploy.s.sol:Deploy --rpc-url arc_testnet --broadcast \
  --verify --verifier blockscout --verifier-url https://testnet.arcscan.app/api/
```
