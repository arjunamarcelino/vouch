"use client";

import { useCallback, useState } from "react";
import { useAccount, usePublicClient, useSendTransaction, useSwitchChain } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { BaseError, type Hex } from "viem";
import { arcTestnet } from "@vouch/shared/chains";
import type { TransactionRequest, TxAction } from "@vouch/shared/schemas";
import { ApiClientError } from "../api/client";
import { trackTx } from "../api/prepare";
import { savePendingTx, clearPendingTx } from "./persistence";

/**
 * Single transaction engine (plan §WS-8). Explicit discriminated-union flow keyed on `stage` — a
 * `hash` exists only on stages that have one, and `reverted`/`rejected` can never reach `done`, so
 * "never show success before a confirmed receipt" is a COMPILE-TIME guarantee. The orchestrator honors
 * the hard rules: assert the wallet chain equals the prepared tx's chain (switch, never silent send),
 * run approval as a separate stage, gate success on `receipt.status === "success"`, call
 * `/transactions/track` only after a confirmed receipt, treat a track MISMATCH as a tamper signal, and
 * persist routing state for refresh-survival. Calldata is sent VERBATIM via `sendTransaction` — never
 * re-encoded. In simulation mode it synthesizes a clearly-flagged result with NO hash (so the
 * explorer-link chokepoint can never produce a real link).
 */
export type TxFlow =
  | { stage: "idle" }
  | { stage: "preparing"; action: TxAction }
  | { stage: "switchingChain"; action: TxAction }
  | { stage: "approving"; action: TxAction }
  | { stage: "awaitingSignature"; action: TxAction }
  | { stage: "submitted"; action: TxAction; hash: Hex }
  | { stage: "tracking"; action: TxAction; hash: Hex }
  | { stage: "confirming"; action: TxAction; hash: Hex }
  | { stage: "done"; action: TxAction; hash?: Hex; simulated: boolean }
  | { stage: "reverted"; action: TxAction; hash: Hex; reason: string }
  | { stage: "trackMismatch"; action: TxAction; hash: Hex }
  | { stage: "rejected"; action: TxAction }
  | { stage: "error"; action: TxAction; code: string; message: string };

export interface RunInput {
  action: TxAction;
  jobId?: string;
  /** POST the prepare endpoint with the given idempotency key → unsigned calldata. */
  prepare: (idempotencyKey: string) => Promise<TransactionRequest>;
  /** Optional USDC approval pre-step (funding actions). Re-checked immediately before the main tx. */
  approval?: {
    isNeeded: () => Promise<boolean>;
    prepare: (idempotencyKey: string) => Promise<TransactionRequest>;
  };
  /** Dual-mode: when true, synthesize a flagged simulation result instead of real signing. */
  simulate?: boolean;
}

function isUserRejection(err: unknown): boolean {
  if (err instanceof BaseError) {
    return err.walk((e) => (e as { name?: string }).name === "UserRejectedRequestError") !== null;
  }
  const code = (err as { code?: number }).code;
  return code === 4001;
}

const newKey = () => crypto.randomUUID();

export function useTxEngine() {
  const [flow, setFlow] = useState<TxFlow>({ stage: "idle" });
  const { address, chainId: walletChainId } = useAccount();
  const { sendTransactionAsync } = useSendTransaction();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient();
  const queryClient = useQueryClient();

  const reset = useCallback(() => setFlow({ stage: "idle" }), []);

  const run = useCallback(
    async (input: RunInput) => {
      const { action, jobId } = input;
      const persist = (stage: "submitted" | "tracking" | "confirming", hash?: string, preparedId?: string) => {
        if (address && preparedId) {
          savePendingTx(address, arcTestnet.id, {
            action,
            jobId,
            preparedId,
            txHash: hash,
            stage,
            updatedAt: Date.now(),
          });
        }
      };

      try {
        setFlow({ stage: "preparing", action });

        // 1. Chain assertion — switch explicitly, never silently send on the wrong chain (security P0.2).
        if (walletChainId !== undefined && walletChainId !== arcTestnet.id) {
          setFlow({ stage: "switchingChain", action });
          await switchChainAsync({ chainId: arcTestnet.id });
        }

        // 2. Separate approval stage (funding actions) — re-check allowance immediately before.
        if (input.approval && (await input.approval.isNeeded())) {
          const approveTx = await input.approval.prepare(newKey());
          if (!input.simulate) {
            setFlow({ stage: "approving", action });
            const approveHash = await sendTransactionAsync({
              to: approveTx.to as Hex,
              data: approveTx.data as Hex,
              value: BigInt(approveTx.value),
              chainId: arcTestnet.id,
            });
            const approveReceipt = await publicClient?.waitForTransactionReceipt({ hash: approveHash });
            if (approveReceipt && approveReceipt.status !== "success") {
              setFlow({ stage: "reverted", action, hash: approveHash, reason: "The USDC approval reverted." });
              return;
            }
          }
        }

        // 3. Prepare the main action (fresh idempotency key).
        const tx = await input.prepare(newKey());
        if (tx.chainId !== arcTestnet.id) {
          setFlow({ stage: "error", action, code: "CHAIN_MISMATCH", message: "Prepared for a different chain." });
          return;
        }
        // Non-payable USDC actions must carry zero native value (security P0 / sanity).
        if (action !== "APPROVE" && tx.value !== "0") {
          setFlow({ stage: "error", action, code: "UNEXPECTED_VALUE", message: "Unexpected native value on a USDC action." });
          return;
        }

        // Simulation: flagged success, NO hash (the explorer chokepoint can't fabricate a link).
        if (input.simulate) {
          setFlow({ stage: "done", action, simulated: true });
          return;
        }

        // 4. Sign + submit — calldata sent verbatim.
        setFlow({ stage: "awaitingSignature", action });
        const hash = await sendTransactionAsync({
          to: tx.to as Hex,
          data: tx.data as Hex,
          value: BigInt(tx.value),
          chainId: arcTestnet.id,
        });
        setFlow({ stage: "submitted", action, hash });
        persist("submitted", hash, tx.preparedId);

        // 5. Wait for the receipt — rebind on replacement (speed-up/cancel).
        const receipt = await publicClient?.waitForTransactionReceipt({
          hash,
          onReplaced: (r) => setFlow({ stage: "submitted", action, hash: r.transaction.hash }),
        });
        if (receipt && receipt.status === "reverted") {
          setFlow({ stage: "reverted", action, hash, reason: "The transaction reverted on-chain." });
          clearPendingTx(address ?? "", arcTestnet.id);
          return;
        }

        // 6. Bind the mined tx to its prepared intent (only AFTER a confirmed receipt).
        setFlow({ stage: "tracking", action, hash });
        persist("tracking", hash, tx.preparedId);
        const track = await trackTx(hash, tx.preparedId);
        if (track.status === "MISMATCH") {
          setFlow({ stage: "trackMismatch", action, hash });
          clearPendingTx(address ?? "", arcTestnet.id);
          return;
        }

        // 7. Done — chain-read polling is the caller's concern (useJob pollUntil).
        setFlow({ stage: "confirming", action, hash });
        persist("confirming", hash, tx.preparedId);
        setFlow({ stage: "done", action, hash, simulated: false });
        clearPendingTx(address ?? "", arcTestnet.id);
        await queryClient.invalidateQueries();
      } catch (err) {
        if (isUserRejection(err)) {
          setFlow({ stage: "rejected", action });
          return;
        }
        if (err instanceof ApiClientError) {
          setFlow({ stage: "error", action, code: err.code, message: err.message });
          return;
        }
        const message = err instanceof BaseError ? err.shortMessage : err instanceof Error ? err.message : String(err);
        setFlow({ stage: "error", action, code: "TX_FAILED", message });
      }
    },
    [address, walletChainId, sendTransactionAsync, switchChainAsync, publicClient, queryClient],
  );

  const isBusy =
    flow.stage !== "idle" &&
    flow.stage !== "done" &&
    flow.stage !== "error" &&
    flow.stage !== "rejected" &&
    flow.stage !== "reverted" &&
    flow.stage !== "trackMismatch";

  return { flow, run, reset, isBusy };
}
