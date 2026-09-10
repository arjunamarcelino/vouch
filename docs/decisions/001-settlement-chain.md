# ADR-001 — Arc owns all financial state

**Status:** Accepted

## Context

Vouch moves real money: it escrows a task fee, locks capped guarantee collateral, and pays out a
service credit on a confidential verdict. That financial state has to live *somewhere*
authoritative. Options considered: (a) a single settlement chain, (b) split state across multiple
chains, (c) an offchain ledger with periodic anchoring.

Splitting money across chains forces cross-chain reconciliation — a persistent source of bugs,
race conditions, and "which ledger is right?" ambiguity — and an offchain ledger reintroduces the
very trust gap Vouch exists to close. We also need EVM tooling (Foundry, viem) to be first-class,
and we need USDC as the settlement asset. Circle **Arc** is an EVM L1 where **USDC is the native
gas token**, and it is a supported network for The Graph.

## Decision

**Arc owns all financial state.** A single `AssuranceHub` contract on Arc holds escrowed task fees
(and optional service fees), locked guarantee collateral, and executes capped + idempotent payouts. All application-level
accounting uses the **6-decimal ERC-20** USDC interface (never the 18-decimal native/gas view of
the same balance). The Graph indexes Arc events as the reputation source of truth (ADR-003). The
MVP targets **Arc testnet** (`5042002`); Arc mainnet (`5042`) is a bonus tier only.

## Consequences

- **Positive:** no cross-chain financial reconciliation; one authoritative ledger for money.
  Foundry and viem work unmodified. USDC-as-gas simplifies the asset story. The Graph can treat
  Arc events as the single reputation feed.
- **Positive:** clean authority model — Postgres is demoted to operational-only, never a money
  source of truth.
- **Negative / watch-outs:** dual-decimal USDC (18 native gas vs 6 ERC-20) is a real footgun;
  all app math standardizes on 6-decimal base units. Arc EVM quirks apply (`PREVRANDAO` = 0, no
  blob txs, EIP-7708 native `Transfer` logs) — the subgraph must index **Vouch events only**,
  never raw native transfer logs (double-count risk).
- **Constraint introduced:** the confidential verdict must be delivered *to Arc* to move funds
  (see ADR-004 for how, without trusting the transport).
