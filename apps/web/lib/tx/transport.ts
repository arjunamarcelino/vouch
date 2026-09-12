import { type Hex } from "viem";
import type { TransactionRequest } from "@vouch/shared/schemas";

/**
 * Transaction transport seam (plan review P2-9). The FSM orchestrator depends on this interface rather
 * than branching on a `simulate` boolean, so the sign/receipt path is cleanly separated from the
 * decision of whether a real transaction can be sent. Two implementations:
 *   - `createLiveTransport` — signs + broadcasts the prepared calldata VERBATIM via wagmi/viem and waits
 *     for a bounded receipt.
 *   - `SIMULATED_TRANSPORT` — performs no chain I/O; the orchestrator short-circuits to a flagged,
 *     hash-less result so the explorer-link chokepoint can never fabricate a link.
 *
 * "Simulated" is chosen from WALLET REALITY (no connected wallet) — not the API health probe (review
 * P2-9/M2): a transient health/session blip must never silently downgrade a real, wallet-backed action.
 */
export type ReceiptStatus = "success" | "reverted";

export interface TxTransport {
  readonly simulated: boolean;
  /** Sign + broadcast the prepared calldata verbatim; resolves to the tx hash. */
  send(tx: TransactionRequest): Promise<Hex>;
  /** Await a mined receipt (bounded by `timeout`); rebind on replacement. Throws on timeout. */
  waitForReceipt(hash: Hex, onReplaced: (newHash: Hex) => void): Promise<ReceiptStatus>;
}

export interface LiveTransportDeps {
  chainId: number;
  receiptTimeoutMs: number;
  sendTransaction: (args: { to: Hex; data: Hex; value: bigint; chainId: number }) => Promise<Hex>;
  waitForTransactionReceipt: (args: {
    hash: Hex;
    timeout?: number;
    onReplaced?: (r: { transaction: { hash: Hex } }) => void;
  }) => Promise<{ status: ReceiptStatus }>;
}

export function createLiveTransport(deps: LiveTransportDeps): TxTransport {
  return {
    simulated: false,
    send(tx) {
      return deps.sendTransaction({
        to: tx.to as Hex,
        data: tx.data as Hex,
        value: BigInt(tx.value),
        chainId: deps.chainId,
      });
    },
    async waitForReceipt(hash, onReplaced) {
      const receipt = await deps.waitForTransactionReceipt({
        hash,
        timeout: deps.receiptTimeoutMs,
        onReplaced: (r) => onReplaced(r.transaction.hash),
      });
      return receipt.status;
    },
  };
}

export const SIMULATED_TRANSPORT: TxTransport = {
  simulated: true,
  send() {
    return Promise.reject(new Error("simulated transport does not sign"));
  },
  waitForReceipt() {
    return Promise.reject(new Error("simulated transport has no receipt"));
  },
};
