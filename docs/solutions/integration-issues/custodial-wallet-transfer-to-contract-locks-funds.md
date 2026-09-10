---
title: "Custodial-wallet plain transfer to an escrow contract locks the funds (bond bypasses postBond)"
category: integration-issues
tags: [circle, developer-controlled-wallets, arc, usdc, escrow, solidity, contract-execution, agent, funds]
module: apps/agent, packages/contracts
symptom: "USDC sent from the Circle Agent wallet to the QuoteBondEscrow address is unrecoverable — every escrow exit (refundBond/releaseBond/consumeBond) reverts BondNotFound because bonds[quoteId] was never set."
root_cause: "The executor moved the bond via a plain ERC-20 token transfer (Circle DCW createTransaction) to the escrow's ADDRESS instead of calling its postBond(...) function. A raw transfer credits the contract's balance but runs none of its logic, so the accounting slot stays empty and there is no code path to withdraw."
date: 2026-09-11
---

# Custodial-wallet plain transfer to a contract locks the funds

## Symptom

The agent's "real USDC action" (posting a refundable quote bond) sends USDC to the deployed
`QuoteBondEscrow`. The transfer confirms on-chain, but the money is stuck: `refundBond(quoteId)` (and
the removed release/consume paths) revert `BondNotFound`, and no other function can move it out.

## Why it's subtle

The demo "works" — a tx lands on arcscan, balances change — so it looks correct. The footgun only bites
when someone points `QUOTE_BOND_ESCROW_ADDRESS` at the *real* escrow contract (the natural thing to do,
given the name + the destination allowlist). A plain transfer to an EOA custody address would have been
fine; a plain transfer to a *contract that expects a function call* silently strands the funds.

## Root cause

```ts
// WRONG: bare ERC-20 transfer to the escrow's address — runs none of the contract's logic.
wallet.sendUsdc({ destination: escrowAddress, amountDecimal, idempotencyKey });
```

`QuoteBondEscrow.postBond` pulls funds via `safeTransferFrom` and records `bonds[quoteId] = {...}`. A
plain transfer never calls it, so `bonds[quoteId].amount == 0` forever and every exit path guards on
`amount != 0`. Circle DCW's `createTransaction` (token transfer) and `createContractExecutionTransaction`
(contract call) are different operations; using the former against a contract is the trap.

A second, related trap: a non-zero **fallback** address used for EIP-712 domain separation
(`0x…dEaD`) was reused as the payment destination — so an unset escrow would *burn* USDC.

## Solution

1. **Call the contract, don't transfer to it.** Use Circle DCW `createContractExecutionTransaction`
   with viem-encoded `callData`:

```ts
import { encodeFunctionData } from "viem";
import { quoteBondEscrowAbi } from "@vouch/shared/abis";

const callData = encodeFunctionData({
  abi: quoteBondEscrowAbi,
  functionName: "postBond",
  args: [quoteId, amountBaseUnits, expiresAt],
});
await wallet.executeContract({ contractAddress: escrowAddress, callData, idempotencyKey });
```

2. **Remove the raw-transfer method from the wallet adapter entirely.** If the wallet can only execute
   allowlisted contract calls (no `sendUsdc`), the bare-transfer path is *unrepresentable*.

3. **Pre-send guard.** Before any send, assert the destination has contract bytecode
   (`getBytecode !== "0x"`) — this refuses the `0x…dEaD` fallback and any EOA, and catches a
   mis-set address. Never reuse an EIP-712 domain-separator address as a transfer target.

4. **One-time approve.** `postBond` uses `transferFrom`, so the wallet must `approve(escrow, USDC)`
   once at setup; without it postBond reverts and the intent goes `FAILED` (fails loud — no fund loss).

## Prevention

- Custodial wallet SDKs expose *transfer* and *contract-execution* as distinct calls — moving value to
  a contract almost always means the latter. Treat "transfer to a contract address" as a red flag.
- Give the wallet adapter the narrowest surface that the task needs (contract-execution only), so the
  dangerous primitive doesn't exist.
- Integration-test the full round-trip (post → refund returns funds) on a fork/testnet, not just "a tx
  confirmed."

## References

- Review todo `032` (PR #3). Fix commit `6d6248a`. Related: ADR-008 (agent operational payments).
- Circle DCW: `createTransaction` (transfer) vs `createContractExecutionTransaction` (call).
