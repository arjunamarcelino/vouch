# Vouch — Arc / Circle Agent Stack judging narrative (one page)

**Track:** Best Agentic Economy Application with the Circle Agent Stack ($3,500; +$2,500 bonus for an
Arc **mainnet** deploy by Sept 30). **Chain:** Arc testnet, chainId **5042002**.
**Official submission video:** [`demo-script-graph.md`](demo-script-graph.md). Deep-dive:
[`demo-script.md`](demo-script.md). Full runbook: [`arc-agent-stack.md`](arc-agent-stack.md).

## The one-paragraph pitch
Vouch runs an **autonomous risk-quotation and settlement agent** (`apps/agent`) on Arc. It reasons from
real signals (live The Graph reputation), prices a provider-funded guarantee with a deterministic model,
and performs a **real, autonomous USDC action on Arc** — posting a refundable quote-bond — from a
**policy-bound Circle Agent Wallet**, without any manual transaction construction. It is agentic economy,
end to end, in real USDC.

## What to point at (cite these facts)
- **Circle Agent Wallet is the Agent-Stack integration.** `@circle-fin/developer-controlled-wallets`
  v10.8.0 in `apps/agent/src/wallet/agentWallet.ts`. Wallet is an **SCA on `ARC-TESTNET`**
  (`Blockchain.ArcTestnet = "ARC-TESTNET"` confirmed in the installed SDK). Headline Agent-Stack
  surface `@circle-fin/cli` is cited; the SDK is the load-bearing integration.
- **Policy caps + contract-execution-only.** Circle-side spending controls (per-tx / daily caps +
  destination allowlist) are the **primary, authoritative** limit; `src/wallet/policy.ts` is
  defense-in-depth. The wallet has **no raw-transfer method** — a pre-send bytecode guard refuses any
  non-contract destination, so the agent can only move funds via **contract execution** (`postBond` /
  `refundBond`). Balance is held at/below the daily cap so the balance itself is a hard ceiling.
- **Real autonomous USDC on Arc (arcscan txs).**
  - Bond post — Circle wallet → `QuoteBondEscrow.postBond` (1 USDC): `0x5d9d1af8…`
  - Bond refund — `refundBond`: `0xd668c466…`
  - Contracts (real Foundry broadcasts, status `0x1`): `AssuranceHub` `0xB30e054557533f28753B4ACdf646B393E2072bf9` (tx `0x72c92d8d…`),
    `QuoteBondEscrow` `0x3ca2d854d5f042dd0ddd39eaf80644be0e80048c` (tx `0x3a7cad0c…`).
  - Agent Circle wallet (SCA): `0x482e0a53d97b0a9be1045f58cdbf9d244bd303be`. Explorer:
    `https://testnet.arcscan.app`.
- **USDC on Arc.** `0x3600000000000000000000000000000000000000` — the official Arc predeploy, a 6-dec
  ERC-20 view of the 18-dec native gas asset. Same funds; **never render as two balances**.
- **FE + BE live.** `apps/web` (Next.js 16 + Tailwind v4 + shadcn/ui) dashboard with live USDC balances
  and arcscan tx links; `apps/api` (NestJS 11) serves job/guarantee state. Hardened: explicit-origin
  CORS, `ThrottlerGuard`, fail-closed zod env (SESSION_SECRET / SIWE_DOMAIN / WEB_ORIGIN required
  outside dev), Swagger disabled on mainnet.
- **Architecture diagram** (explicit Arc requirement): `docs/architecture.md` — export the PNG for the
  submission.

## Honest caveats (state as design boundaries — net-positive for judging)
- **Transport, not authority.** The agent is **transport / self-custody of operational capital**. Its
  real USDC action is its own **refundable quote-bond**; it **never** settles the ~guarantee principal.
  Guarantee payout stays on the CRE → forwarder → `AssuranceHub.onReport` path only (ADR-004/005).
- **Disclosed job→bond-release no-op.** The on-chain `JobCreated` event does not carry the agent's
  `quoteId`, so a precise quote↔job link needs an off-chain jobHash match or a future event field. The
  build records this observation as a **logged no-op** (`apps/agent/src/index.ts:67-71`); the
  prize-qualifying real USDC action (posting the bond) happens at quote-issue time regardless.
- **Never fakes a tx.** When Circle creds are unconfigured, the wallet throws `NotImplementedError` — it
  never fabricates a tx hash. Only the real arcscan links above are shown.
- **Mainnet is config + checklist only.** Arc mainnet (chainId `5042`) goes live Sept 16 2026; USDC
  mainnet predeploy is not yet published (do not hardcode). No real-value mainnet deploy without written
  authorization. The $2,500 mainnet bonus is gated behind that authorization.

## Video timestamp map (against [`demo-script-graph.md`](demo-script-graph.md))
| Timestamp | Arc beat |
|---|---|
| **0:25** | `openJob` (20 USDC escrowed) + provider `acceptJob` locks capped collateral on `AssuranceHub` |
| **1:50** | Policy-capped Circle wallet balance + the real `postBond` tx open on `testnet.arcscan.app` |
| **2:20** | `resolveInitialEvaluation(approve)` releases the 20-USDC task fee; `CoverageStarted` |
| **3:00** | `onReport` capped payout (`min(amount, guaranteeAmount)`) — USDC to client on Arc |

## Architecture (one glance)
```
Client / Provider ──USDC──▶ AssuranceHub (Arc)  ──events──▶ The Graph subgraph ──▶ risk agent quote
                              ▲   authoritative: money + lifecycle           (reputation → premiumBps)
Circle Agent Wallet ─contract-exec─▶ QuoteBondEscrow (operational bond only; transport, not authority)
CRE TEE ─DON-signed 7-tuple─▶ onReport  (sole guarantee-payout path; relay/forwarder gated)
apps/web (FE) + apps/api (BE): dashboard, live USDC balances, arcscan tx links
```
