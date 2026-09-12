# Vouch — Arc Mainnet Readiness Checklist

> **This document is config + checklist ONLY.** No real-value deploy has been made and
> none is authorized by this file. The submission is deployed and demonstrated on **Arc
> testnet** (chain id `5042002`); mainnet is a documented roadmap, not a shipped state.

> **⚠️ The +$2,500 Arc mainnet-deploy bonus (deploy by Sept 30) is a deliberate DECISION,
> not a default task.** It requires **explicit written authorization** from the project
> owner. Arc mainnet goes live **Sept 16 2026** — a launch-week, real-value deployment
> carries real risk (unproven mainnet, unpublished USDC address, key-custody exposure)
> that must be weighed against the bonus. **NO real-value mainnet deploy without that
> written sign-off.**

This consolidates the mainnet tasks previously tracked in
[`arc-agent-stack.md`](arc-agent-stack.md). The honest testnet trust model and the gaps
these tasks close are in [`security.md`](security.md) §3–§4.

---

## Network & config (no hard-coding — resolve at runtime)

- [ ] Confirm Arc **mainnet chain id `5042`** and the **Sept 16 2026 launch** against live Arc docs; resolve via `chainForEnv`, never hard-code.
- [ ] **Mainnet USDC predeploy address is NOT yet published** — do not hardcode a placeholder. Wire it from config once Arc publishes it; the pre-send guard must refuse an unset/zero address.
- [ ] Subgraph re-deployed against the **`arc` (mainnet) network** with the correct `startBlock`.
- [ ] **Subgraph Studio endpoint** points at the mainnet subgraph (agent consumer + demo query updated).

## Settlement trust (the key gap vs testnet)

- [ ] **Real on-chain DON-signature verification on the payout path.** Testnet uses a *trusted EOA relay* — `onReport` authorizes on `msg.sender == forwarder` + workflow identity, **not** an on-chain signature check. Mainnet must verify the DON signature (canonical KeystoneForwarder / attested-DON path) before any real-value payout. (ADR-004 B3 — settlement contract, not the agent.)

## Keys & custody

- [ ] **KMS (not `.env`) for signer keys** — `QUOTE_SIGNER_PK`, forwarder key, deployer/admin keys distinct, minimally scoped, rotated; admin behind a multisig.
- [ ] **Funded mainnet Circle wallet** with **Circle-side spend caps** (per-tx/daily caps + destination allowlist) as the *primary, authoritative* limit; wallet holds minimal USDC.

## Gate

- [ ] All boxes above satisfied **AND** explicit written authorization on file **before** any real-value mainnet transaction.
