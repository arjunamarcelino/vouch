# Arc Agent Stack — Vouch risk-quotation & settlement agent

How `apps/agent` (`@vouch/agent`) satisfies Arc's **"Best Agentic Economy Application with the Circle
Agent Stack"** requirement: it **holds and controls a wallet** through the supported Agent Stack flow,
**reasons from real signals** (live The Graph reputation), and performs a **real USDC action on Arc**
(posting a refundable quote bond) — autonomously, without manual transaction construction.

> **Honesty rule:** no module fakes a transaction or hard-codes a chain result. Unconfigured paths
> surface an explicit "not configured" state. The one live testnet transaction is gated behind the
> [blocking checklist](#blocking-checklist-live-arc-testnet-transaction) — never a fabricated tx hash.

---

## 1. Official Agent Stack packages used

| Component | Package / product | Role in Vouch |
|---|---|---|
| **Agent Wallets** | `@circle-fin/developer-controlled-wallets` **v10.8.0** | The agent's policy-capped USDC wallet on Arc. Verified surface: `initiateDeveloperControlledWalletsClient`, `getWalletTokenBalance`, `createTransaction`, `getTransaction`. `Blockchain.ArcTestnet = "ARC-TESTNET"`, `Blockchain.Arc = "ARC"` (confirmed in the installed SDK). |
| Circle CLI / MCP server / Skills | (reference) | Headline Agent-Stack narrative surface; the SDK above is the load-bearing integration. |
| x402 | (future) | Complementary HTTP-402 payment leg; not required for this MVP. |

Vouch's ≥1 Agent-Stack component is **Agent Wallets** (`src/wallet/agentWallet.ts`).

## 2. Wallet lifecycle

1. **Entity secret** generated once; its **ciphertext registered** via the Circle console
   (`generateEntitySecretCiphertext`); recovery file stored securely — never auto-registered at runtime.
2. **Wallet set** + a **wallet on `ARC-TESTNET`** created (`accountType: "SCA"`), id → `AGENT_WALLET_ID`.
3. Wallet **funded** with USDC (and native gas — USDC *is* Arc's native gas token) from the faucet,
   at or **below the daily cap** so the balance itself is a hard ceiling.
4. **Policy binding:** Circle-side spending controls (per-tx/daily caps + destination allowlist) are the
   **primary, authoritative** limit; `src/wallet/policy.ts` is defense-in-depth (an entity secret can
   move funds for the whole entity and bypasses any in-process check).
5. The wallet holds **minimal** USDC and moves only its **own refundable bond** — never guarantee
   principal.

## 3. USDC flow — the real financial action

The agent's real on-chain USDC action is a **refundable quote bond** it posts from its own wallet
(decision: [ADR-008](decisions/008-agent-operational-payments.md)):

```
agent wallet ──postBond(quoteId, amount)──▶ QuoteBondEscrow        (real USDC out on Arc)
QuoteBondEscrow ──refundBond / releaseBond──▶ agent wallet         (deposit returned)
QuoteBondEscrow ──consumeBond (slash)──────▶ slashSink             (proven-bad quote; optional)
```

- This is **agent-as-transport / self-custody** of operational capital — **never** the 100-USDC
  guarantee payout, which stays on the CRE→forwarder→`AssuranceHub.onReport` DON-signed path
  (ADR-004/005, untouched).
- Exactly-once: Circle's `idempotencyKey` (deterministic UUIDv5) + the persisted `PaymentIntent` state
  machine; `paramsHash` guards against stale-amount reuse; crash reconciliation re-drives in-flight
  intents (`src/pay/executor.ts`).
- **Bond transport modes.** The prize-qualifying real USDC action is a Circle DCW transfer to the bond
  destination. The **trust-minimized** `QuoteBondEscrow` contract (`packages/contracts`, 12 Foundry
  tests) is built and tested; wiring the agent to call `postBond`/`refundBond` via Circle DCW
  **contract-execution** (approve + contract call) is the remaining integration step (below).

## 4. Decision signals (reasoning from real data)

- Live **The Graph** provider reputation (`upheldClaimRateBps`, `recentFailureRateBps`, `completedJobs`,
  `sampleSize`) via `src/graph/client.ts`, freshness-gated (fail closed on stale/lagging).
- Job characteristics: task fee, requested guarantee, coverage duration, category, verification method,
  provider collateral.
- → **deterministic** integer-bps pricing model (`src/risk/score.ts`): base rate + upheld/recent/
  duration/ratio surcharges − history discount + insufficient-history surcharge, **every output capped**,
  machine-readable **reason codes**. The LLM may only explain; it never chooses an amount.

## 5. Autonomous action

`src/orchestrator.ts` + `src/monitor/watch.ts`: on startup the executor **reconciles** in-flight
intents; the agent then **watches** `JobCreated`/`JobFunded`/`CoverageStarted` and initiates the next
allowed action (finality-gated, deduped per job) **without manual transaction construction**. Quotes
are requested/verified/paid via **REST** (`src/server/rest.ts`, default) and **MCP**
(`src/server/mcp.ts`) over a shared core (`src/server/core.ts`). Select the transport with
`AGENT_TRANSPORT` (`rest` | `mcp`); `pnpm --filter @vouch/agent start:mcp` runs the stdio MCP server (in
that mode logs go to **stderr** so stdout stays clean for the JSON-RPC framing). A chain-safety +
escrow-deployed preflight runs before any real USDC action.

> **Known limitation:** the on-chain `JobCreated` event does not carry the agent's `quoteId`, so a
> precise quote↔job link needs an off-chain jobHash match or a future event field. This build records
> the observation; the prize-qualifying real USDC action (posting the bond) happens at quote-issue time.

## 6. Transaction links required for submission

_Fill after running the live testnet transaction (see checklist below). Never fabricate._

| Action | Arcscan link |
|---|---|
| Bond post (agent → escrow/custody) | `https://testnet.arcscan.app/tx/0x…` **[pending live run]** |
| Bond refund (escrow → agent) | `https://testnet.arcscan.app/tx/0x…` **[pending live run]** |

## Blocking checklist — live Arc testnet transaction

Everything is built and config-gated; a real tx is blocked only on credentials + a funded wallet.

- [ ] `CIRCLE_API_KEY` (`PREFIX:ID:SECRET`) provisioned.
- [ ] `CIRCLE_ENTITY_SECRET` generated; **ciphertext registered** via console; recovery file stored.
- [ ] Circle wallet created on **`ARC-TESTNET`**; `AGENT_WALLET_ID` + `AGENT_USDC_TOKEN_ID` set.
- [ ] Wallet **funded** (USDC-as-gas) from the faucet, **at/below `AGENT_DAILY_CAP`**.
- [ ] **⚠️ RPC host resolved [BLOCKING VERIFY]:** repo `chains.ts`/`.env` use `rpc.testnet.arc.network`;
      Circle/Arc docs say **`rpc.testnet.arc.io`**. Confirm the live host; make `chains.ts` + env agree.
- [ ] `USDC_ADDRESS` = `0x3600…0000` confirmed at `docs.arc.io/.../contract-addresses`.
- [ ] **DB integrity constraints applied:** after `prisma db push`, run `pnpm --filter @vouch/db
      db:constraints` (sets the amount CHECKs, the rolling-cap partial index, and REVOKEs UPDATE/DELETE
      on `DecisionTrace` from the app role — set `APP_DB_ROLE`). Without it the append-only/tamper-evident
      guarantees and money-column domain checks are not enforced.
- [ ] **🔴 B1:** Circle-side spending controls (per-tx/daily caps + allowlist) **active** — confirm field
      names — as the *primary* limit (app-side `policy.ts` is defense-in-depth only).
- [x] **🔴 B3:** `POST /quotes` (+ `/verify`, `/pay`) fronted by Bearer auth + rate-limit — done (todo
      `038`). Set `AGENT_API_KEY` before any funded run (unset = auth disabled, with a startup warning).
- [x] **H1:** redaction paths cover `CIRCLE_API_KEY`/`CIRCLE_ENTITY_SECRET`/`QUOTE_SIGNER_PK` with a
      redaction test — done (todo `039`).
- [ ] `QUOTE_SIGNER_PK` (dedicated, ≠ payment wallet) set; `QUOTE_BOND_ESCROW_ADDRESS` = the **deployed
      QuoteBondEscrow contract** (the executor calls `postBond` via contract-execution; the pre-send
      guard refuses a non-contract / `0x…dEaD`).
- [ ] **One-time `approve`:** the agent wallet must `approve(QuoteBondEscrow, USDC)` once (postBond pulls
      via `transferFrom`); without it `postBond` reverts and the intent goes `FAILED` (fails loud, no
      fund loss).
- [ ] Run the bond post → capture the **real** `testnet.arcscan.app/tx/0x…` link → paste into §6 + demo.

## Mainnet-readiness tasks (before Sept 30)

- [ ] Confirm Arc **mainnet** enum (`"ARC"`, present in SDK) + chainId (`5042`) + launch date against
      live docs; resolve via `chainForEnv`, never hard-code.
- [ ] Real **DON-signature verification** on the payout path (ADR-004 B3 gap — not this agent, but the
      settlement contract) before mainnet money.
- [x] Wire `QuoteBondEscrow` via Circle DCW **contract-execution** (`postBond`/`refundBond`), replacing
      the bare-transfer path — done in review remediation (todo `032`); the wallet has no raw-transfer
      method and a pre-send bytecode guard refuses non-contract destinations.
- [ ] Key management: **KMS**, not `.env`, for `QUOTE_SIGNER_PK`; production Circle spending controls.
- [ ] Mainnet USDC address + funded mainnet wallet; load/lag budgets tuned.

## Hardening from the multi-agent review (PR #3, todos 032–044)

**Done:** escrow contract-execution wiring so the bond is recoverable, no raw-transfer method + a
pre-send bytecode guard (`032`); rolling-24h spend cap (`033`); atomic nonce+reserve, `paramsHash`
guard, lock-first idempotency (`034`); non-blocking submit + periodic reconcile (`035`); DB integrity
constraints applied via `db:constraints` incl. append-only REVOKE (`036`); linearized trace append +
best-effort-post-payment (`037`); auth + rate-limit on signing/pay routes (`038`); secret-env redaction
+ test (`039`); MCP transport + finality gate wired (`040`); shared-contract type cleanup (`041`); MCP
`structuredContent` object-only (`042`); escrow conventions + slashing/release removed (`043`); P3
cleanup batch (`044`). Learnings captured in `docs/solutions/`.

**Still open (production, before mainnet):** real DON-signature verification on the payout path (ADR-004
B3 — settlement contract, not this agent); KMS for `QUOTE_SIGNER_PK`; a shared-store rate limiter for
multi-instance; DB-level concurrency integration tests against a live Postgres.
