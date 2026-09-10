# @vouch/contracts

Foundry package for **VouchCore** — the onchain settlement contract for the Vouch
confidential outcome-assurance protocol, deployed to **Circle Arc**.

## Responsibilities

- **Owns all onchain financial settlement on Arc.** Escrow of the client task fee, the
  provider-funded **capped** performance guarantee, the post-acceptance **coverage window**,
  and the **capped + idempotent** payout.
- Enforces the protocol state machine: `Created → GuaranteeLocked → CoverageOpen →
  (Settled | Cancelled)` (plan §3.1).
- Gates payouts on a **DON-signed CRE report** delivered by an authorized transport and
  **bound to a specific workflow identity** (`expectedWorkflowId` / `expectedWorkflowOwner`),
  so neither an unauthorized caller (E8) nor a different workflow on the same forwarder
  (E8b) can settle Vouch jobs (plan §17.3).
- Uses the **6-decimal USDC ERC-20** interface for all accounting; the contract is
  **non-payable** and takes no native `msg.value` (plan E10/M3).
- Emits the canonical events (`JobCreated`, `GuaranteeLocked`, `TaskFeeReleased`,
  `CoverageOpened`, `RegressionProven`, `GuaranteePaid`, `GuaranteeReleased`,
  `JobCancelled`) that the subgraph indexes as the reputation source of truth.

## Non-responsibilities

- **NOT** responsible for offchain data (job titles, descriptions, UI cache) — that lives
  in Postgres/Prisma (`packages/db`), which is never the source of truth for money or reputation.
- **NOT** responsible for any **secret** material — private regression tests, evaluation
  criteria, and repository credentials live **only** inside the Chainlink CRE confidential
  (TEE) layer (`packages/cre-workflow`). Events/entities carry only `jobId`, `amount`,
  `toClient`, and booleans — never test ids, criteria hashes, or failure strings (plan §17.6 M2).
- **NOT** responsible for **reputation aggregation** — provider performance counters and
  `regressionRate` are derived in the subgraph (`packages/subgraph`), not stored onchain
  (ADR-003).
- **NOT** a risk-quotation oracle — the agent quotes/monitors; it never has unilateral
  payout authority (ADR-004 / §17.3).

## Layout

```
src/
  VouchCore.sol            core settlement contract (OZ v5 SafeERC20 + ReentrancyGuard + Ownable2Step)
  ReceiverBase.sol         abstract CRE receiver: forwarder + workflow-identity gating, ERC-165
  interfaces/IReceiver.sol Chainlink CRE receiver interface (onReport + IERC165)
  libraries/Errors.sol     gas-cheap custom errors
script/
  Deploy.s.sol             env-driven deploy (no hard-coded values)
  sync-abis.mjs            regenerates packages/shared/src/abis/vouchCore.ts from the build
test/
  VouchCore.t.sol          happy path + E1–E11, E8b, cap fuzz, conservation, admin guards
  mocks/MockUSDC.sol       6-decimal ERC-20 mock
  mocks/ReentrantUSDC.sol  malicious token proving the reentrancy guard (E11)
```

## Commands

```bash
pnpm --filter @vouch/contracts build           # forge build
pnpm --filter @vouch/contracts test:contracts  # forge test -vvv
pnpm --filter @vouch/contracts abi:sync         # regenerate the TS ABI in packages/shared
forge script script/Deploy.s.sol:Deploy --rpc-url arc_testnet --broadcast
```

Copy `.env.example` to `.env` and fill in the values before deploying. Never commit real keys.
