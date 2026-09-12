"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, usePublicClient, useSendTransaction, useSwitchChain } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { BaseError, WaitForTransactionReceiptTimeoutError, type Hex } from "viem";
import { arcTestnet } from "@vouch/shared/chains";
import type { TransactionRequest, TxAction } from "@vouch/shared/schemas";
import { ApiClientError } from "../api/client";
import { trackTx } from "../api/prepare";
import { queryKeys } from "../api/hooks";
import { savePendingTx, clearPendingTx, loadPendingTx } from "./persistence";
import { createLiveTransport, SIMULATED_TRANSPORT, type TxTransport } from "./transport";

/**
 * Single transaction engine (plan §WS-8). Explicit discriminated-union flow keyed on `stage` — a
 * `hash` exists only on stages that have one, and `reverted`/`rejected`/`timedOut` can never reach
 * `done`, so "never show success before a confirmed receipt" is a COMPILE-TIME guarantee.
 *
 * Chain I/O goes through a `TxTransport` seam (live | simulated, review P2-9) chosen from WALLET reality
 * — not the API health probe (P2-9/M2). Hard rules: assert the wallet chain equals the prepared tx's
 * chain (switch, never silent send); run approval as a separate, equally-guarded stage; gate success on
 * `receipt.status === "success"` (a bounded wait, P2-7); call `/transactions/track` only after a
 * confirmed receipt and treat MISMATCH as a tamper signal; send calldata VERBATIM. The simulated path
 * performs no prepare/chain I/O and yields a flagged, hash-less result (the explorer chokepoint can't
 * fabricate a link). Post-tx cache invalidation is scoped and fire-and-forget so it can never clobber
 * the terminal `done` stage (P2-2).
 */
export type TxFlow =
  | { stage: "idle" }
  | { stage: "preparing"; action: TxAction }
  | { stage: "switchingChain"; action: TxAction }
  | { stage: "approving"; action: TxAction }
  | { stage: "awaitingSignature"; action: TxAction }
  | { stage: "submitted"; action: TxAction; hash: Hex }
  | { stage: "tracking"; action: TxAction; hash: Hex }
  | { stage: "done"; action: TxAction; hash?: Hex; simulated: boolean }
  | { stage: "reverted"; action: TxAction; hash: Hex; reason: string }
  | { stage: "trackMismatch"; action: TxAction; hash: Hex }
  | { stage: "timedOut"; action: TxAction; hash: Hex }
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
}

const RECEIPT_TIMEOUT_MS = 90_000;
const newKey = () => crypto.randomUUID();

function isUserRejection(err: unknown): boolean {
  if (err instanceof BaseError) {
    return err.walk((e) => (e as { name?: string }).name === "UserRejectedRequestError") !== null;
  }
  return (err as { code?: number }).code === 4001;
}

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
      // Live when a wallet is connected (the user intends a real tx) and a public client exists;
      // otherwise a clearly-labeled local simulation. Decision keys off the wallet, not the API probe.
      const transport: TxTransport =
        address && publicClient
          ? createLiveTransport({
              chainId: arcTestnet.id,
              receiptTimeoutMs: RECEIPT_TIMEOUT_MS,
              sendTransaction: sendTransactionAsync,
              waitForTransactionReceipt: (args) => publicClient.waitForTransactionReceipt(args),
            })
          : SIMULATED_TRANSPORT;

      const persist = (stage: "submitted" | "tracking", hash: string, preparedId: string) => {
        if (address) {
          savePendingTx(address, arcTestnet.id, { action, jobId, preparedId, txHash: hash, stage, updatedAt: Date.now() });
        }
      };
      const clearPersisted = () => clearPendingTx(address ?? "", arcTestnet.id);
      // Scoped + fire-and-forget: a rejected refetch must NOT be able to flip `done` → `error` (P2-2).
      const invalidateScoped = () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.myJobs });
        void queryClient.invalidateQueries({ queryKey: queryKeys.allowance });
        if (jobId) {
          void queryClient.invalidateQueries({ queryKey: queryKeys.job(jobId) });
          void queryClient.invalidateQueries({ queryKey: queryKeys.claimStatus(jobId) });
        }
      };

      // Simulated: no prepare, no chain I/O — a flagged, hash-less result (can't produce an explorer link).
      if (transport.simulated) {
        setFlow({ stage: "preparing", action });
        setFlow({ stage: "done", action, simulated: true });
        return;
      }

      let submittedHash: Hex | undefined;
      try {
        setFlow({ stage: "preparing", action });

        // 1. Chain assertion — switch explicitly (covers an undefined/unknown wallet chain too).
        if (walletChainId !== arcTestnet.id) {
          setFlow({ stage: "switchingChain", action });
          await switchChainAsync({ chainId: arcTestnet.id });
        }

        // 2. Separate approval stage — same chainId/zero-value guards as the main tx (security P3).
        if (input.approval && (await input.approval.isNeeded())) {
          const approveTx = await input.approval.prepare(newKey());
          if (approveTx.chainId !== arcTestnet.id || approveTx.value !== "0") {
            setFlow({ stage: "error", action, code: "BAD_APPROVAL", message: "Unexpected approval transaction parameters." });
            return;
          }
          setFlow({ stage: "approving", action });
          const approveHash = await transport.send(approveTx);
          const approveStatus = await transport.waitForReceipt(approveHash, () => {});
          if (approveStatus === "reverted") {
            setFlow({ stage: "reverted", action, hash: approveHash, reason: "The USDC approval reverted." });
            return;
          }
        }

        // 3. Prepare the main action (fresh idempotency key) + sanity-guard the server's calldata.
        const tx = await input.prepare(newKey());
        if (tx.chainId !== arcTestnet.id) {
          setFlow({ stage: "error", action, code: "CHAIN_MISMATCH", message: "Prepared for a different chain." });
          return;
        }
        if (action !== "APPROVE" && tx.value !== "0") {
          setFlow({ stage: "error", action, code: "UNEXPECTED_VALUE", message: "Unexpected native value on a USDC action." });
          return;
        }

        // 4. Sign + submit — calldata sent verbatim.
        setFlow({ stage: "awaitingSignature", action });
        const hash = await transport.send(tx);
        submittedHash = hash;
        setFlow({ stage: "submitted", action, hash });
        persist("submitted", hash, tx.preparedId);

        // 5. Bounded wait for the receipt — rebind on replacement (speed-up/cancel). Throws on timeout.
        const status = await transport.waitForReceipt(hash, (newHash) => {
          submittedHash = newHash;
          setFlow({ stage: "submitted", action, hash: newHash });
        });
        if (status === "reverted") {
          setFlow({ stage: "reverted", action, hash, reason: "The transaction reverted on-chain." });
          clearPersisted();
          return;
        }

        // 6. Receipt is success (on-chain confirmed). Bind to the prepared intent; MISMATCH is the only
        // tamper signal — a PENDING/CONFIRMED binding both proceed, since success is already established
        // by the receipt above (review P2-5).
        setFlow({ stage: "tracking", action, hash });
        persist("tracking", hash, tx.preparedId);
        const track = await trackTx(hash, tx.preparedId);
        if (track.status === "MISMATCH") {
          setFlow({ stage: "trackMismatch", action, hash });
          clearPersisted();
          return;
        }

        // 7. Done. Invalidate AFTER the terminal state and OUTSIDE the await path (P2-2).
        setFlow({ stage: "done", action, hash, simulated: false });
        clearPersisted();
        invalidateScoped();
      } catch (err) {
        if (err instanceof WaitForTransactionReceiptTimeoutError && submittedHash) {
          // The tx may still mine later — keep the persisted blob so a resume can re-poll it (P2-7).
          setFlow({ stage: "timedOut", action, hash: submittedHash });
          return;
        }
        if (isUserRejection(err)) {
          setFlow({ stage: "rejected", action });
          return;
        }
        // Terminal failure (including a failed track bind) — don't leave an orphaned pending blob.
        clearPersisted();
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

  // P2-1: resume a pending tx after a refresh. On mount (and on account change) reconcile the persisted
  // routing blob against the chain/API — the persisted `stage` is only a HINT. Runs once per address.
  const resumedFor = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!address || !publicClient) return;
    if (resumedFor.current === address) return;
    resumedFor.current = address;
    const pending = loadPendingTx(address, arcTestnet.id);
    if (!pending?.txHash) return;
    const hash = pending.txHash as Hex;
    const action = pending.action;
    let cancelled = false;
    const clear = () => clearPendingTx(address, arcTestnet.id);
    void (async () => {
      setFlow({ stage: "submitted", action, hash });
      try {
        const existing = await publicClient.getTransactionReceipt({ hash }).catch(() => null);
        let status = existing?.status;
        if (!existing) {
          const r = await publicClient.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
          status = r.status;
        }
        if (cancelled) return;
        if (status === "reverted") {
          setFlow({ stage: "reverted", action, hash, reason: "The transaction reverted on-chain." });
          clear();
          return;
        }
        setFlow({ stage: "tracking", action, hash });
        const track = await trackTx(hash, pending.preparedId);
        if (cancelled) return;
        if (track.status === "MISMATCH") {
          setFlow({ stage: "trackMismatch", action, hash });
          clear();
          return;
        }
        setFlow({ stage: "done", action, hash, simulated: false });
        clear();
      } catch (err) {
        if (cancelled) return;
        if (err instanceof WaitForTransactionReceiptTimeoutError) {
          setFlow({ stage: "timedOut", action, hash });
          return;
        }
        clear();
        setFlow({ stage: "idle" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [address, publicClient]);

  const isBusy =
    flow.stage === "preparing" ||
    flow.stage === "switchingChain" ||
    flow.stage === "approving" ||
    flow.stage === "awaitingSignature" ||
    flow.stage === "submitted" ||
    flow.stage === "tracking";

  return { flow, run, reset, isBusy };
}
