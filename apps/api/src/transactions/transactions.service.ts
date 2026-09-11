import { Injectable } from "@nestjs/common";
import { type Hex } from "viem";
import { VouchError } from "@vouch/shared/errors";
import { HEX32_RE, type TxAction } from "@vouch/shared/schemas";
import {
  getPreparedIntent,
  startTracking,
  getTrackedTx,
  updateTrackedTx,
  reconcileJobId,
  getJobMetaByJobId,
  mirrorJobStatus,
  appendFeedEvent,
} from "@vouch/db";
import { ApiError } from "../common/errors";
import { ChainService } from "../common/chain/chain.service";
import { hashCallArgs } from "../common/chain/args-hash";
import { loadEnv } from "../config/env";

/** Expected hub event per action (topic0-matched via the frozen ABI). APPROVE emits on USDC, not the hub. */
const EVENT_FOR: Partial<Record<TxAction, string>> = {
  OPEN_JOB: "JobCreated",
  ACCEPT: "ProviderAccepted",
  SUBMIT: "DeliverableSubmitted",
  EVAL: "InitialEvaluationResolved",
  CLAIM: "ClaimOpened",
  CANCEL: "JobCancelled",
  EXPIRE: "JobExpired",
  WITHDRAW: "CollateralReleased",
  RESOLVE_TIMEOUT: "ClaimTimedOut",
};

/** Display-only mirror label per action (never read for decisions). */
const MIRROR_STATUS: Partial<Record<TxAction, string>> = {
  OPEN_JOB: "Funded",
  ACCEPT: "AcceptedByProvider",
  SUBMIT: "Submitted",
  EVAL: "InitiallyApproved",
  CLAIM: "ClaimPending",
  CANCEL: "Cancelled",
  EXPIRE: "Expired",
  WITHDRAW: "Completed",
};

export interface TrackResult {
  txHash: string;
  status: "PENDING" | "CONFIRMED" | "MISMATCH";
  confirmations: number;
  eventVerified: boolean;
  jobId?: string;
}

/**
 * Verifies a submitted tx against the PreparedIntent it claims to fulfil, then mirrors status
 * one-directionally. Fail-closed: any mismatch of contract/chain/selector/args/from/event marks the tx
 * MISMATCH and never mirrors. A not-yet-mined or under-confirmed tx is PENDING (not an error). The API
 * holds no keys — it observes, it never resubmits.
 */
@Injectable()
export class TransactionsService {
  private readonly confirmationsRequired = loadEnv().CONFIRMATIONS_REQUIRED;

  constructor(private readonly chain: ChainService) {}

  async track(ctx: { address: string }, input: { txHash: string; preparedId: string }): Promise<TrackResult> {
    const txHash = input.txHash.toLowerCase();
    // A malformed hash is a client validation error (400), not a mismatch-against-intent (review 066/kieran).
    if (!HEX32_RE.test(txHash)) throw new VouchError("VALIDATION_FAILED", "Malformed txHash");

    const prepared = await getPreparedIntent(input.preparedId);
    if (!prepared) throw new ApiError("NOT_FOUND", "No prepared intent for this tx (prepare first)");
    if (prepared.scope !== ctx.address.toLowerCase()) throw new ApiError("FORBIDDEN", "Not your prepared intent");
    const action = prepared.action as TxAction;

    // Bind txHash to the prepared intent. For OPEN_JOB the partial-unique(prepareKey) rejects a SECOND
    // distinct hash under the same key → the double-fund guard.
    try {
      await startTracking({
        txHash,
        preparedId: prepared.preparedId,
        // Scope the double-fund prepareKey by caller so two callers reusing the same key can't collide
        // on the partial-unique(prepareKey) WHERE OPEN_JOB index (review 053).
        prepareKey: `${prepared.scope}:${prepared.idempotencyKey}`,
        action,
        chainId: prepared.chainId,
        toAddress: prepared.to,
        functionSelector: prepared.selector,
        jobRequestId: prepared.jobRequestId ?? undefined,
        jobId: prepared.jobId ?? undefined,
      });
    } catch (err) {
      if (err && typeof err === "object" && (err as { code?: string }).code === "P2002") {
        throw new ApiError("IDEMPOTENCY_CONFLICT", "A different transaction is already tracked for this prepare");
      }
      throw err;
    }

    const receipt = await this.chain.getReceiptOrNull(txHash as Hex);
    if (!receipt) {
      await updateTrackedTx(txHash, { status: "PENDING", lastCheckedAt: new Date() });
      return { txHash, status: "PENDING", confirmations: 0, eventVerified: false };
    }

    const tx = await this.chain.getTransaction(txHash as Hex);

    // ---- the checklist (fail-closed → MISMATCH) ----
    const mismatch = async (why: string): Promise<never> => {
      await updateTrackedTx(txHash, { status: "MISMATCH", lastCheckedAt: new Date() });
      throw new ApiError("TX_MISMATCH", `Tracked tx does not match the prepared intent (${why})`);
    };
    if (!this.chain.addressEq(tx.to, prepared.to)) return mismatch("to");
    if (tx.chainId !== prepared.chainId) return mismatch("chainId");
    if (this.chain.selectorOf(tx.input) !== prepared.selector) return mismatch("selector");
    let decodedArgs: readonly unknown[];
    try {
      decodedArgs = this.chain.decodeCall(tx.input, prepared.functionName as never).args as readonly unknown[];
    } catch {
      return mismatch("undecodable calldata");
    }
    if (hashCallArgs(decodedArgs) !== prepared.argsHash) return mismatch("args");
    if (!this.chain.addressEq(tx.from, ctx.address)) return mismatch("from"); // security H3

    if (receipt.status !== "success") {
      await updateTrackedTx(txHash, { status: "MISMATCH", lastCheckedAt: new Date() });
      throw new ApiError("TX_REVERTED", "Transaction reverted on-chain");
    }

    // Expected event present (topic0 + ABI matched by viem); extract jobId for OPEN_JOB.
    const eventName = EVENT_FOR[action];
    let onchainJobId: string | undefined = prepared.jobId ?? undefined;
    if (eventName) {
      const events = this.chain.eventsFromLogs(eventName, receipt.logs) as { args?: { jobId?: bigint } }[];
      if (events.length < 1) return mismatch(`missing ${eventName}`);
      if (action === "OPEN_JOB") {
        // A valid JobCreated MUST carry an indexed jobId; a missing one is a malformed/foreign event —
        // fail loud rather than silently confirming without reconciling the provisional row (review 070).
        const emitted = events[0]?.args?.jobId;
        if (emitted === undefined) return mismatch("JobCreated missing jobId");
        onchainJobId = emitted.toString();
      }
    }

    // Confirmations (re-derived each poll; never finalize before the threshold).
    const head = await this.chain.getBlockNumber();
    const confirmations = head >= receipt.blockNumber ? Number(head - receipt.blockNumber + 1n) : 0;
    const eventVerified = true;

    if (confirmations < this.confirmationsRequired) {
      await updateTrackedTx(txHash, {
        status: "PENDING",
        confirmations,
        blockNumber: receipt.blockNumber,
        eventVerified,
        lastCheckedAt: new Date(),
      });
      return { txHash, status: "PENDING", confirmations, eventVerified, jobId: onchainJobId };
    }

    // CONFIRMED → reconcile jobId, mirror status (display-only), emit a feed event.
    await updateTrackedTx(txHash, {
      status: "CONFIRMED",
      confirmations,
      blockNumber: receipt.blockNumber,
      eventVerified,
      ...(onchainJobId ? { jobId: onchainJobId } : {}),
      lastCheckedAt: new Date(),
    });
    await this.reconcileAndMirror(prepared.jobRequestId, onchainJobId, action, receipt.blockNumber);
    await appendFeedEvent({
      kind: "TX_CONFIRMED",
      jobRequestId: prepared.jobRequestId ?? undefined,
      payload: { action, txHash, jobId: onchainJobId ?? null },
    });
    return { txHash, status: "CONFIRMED", confirmations, eventVerified, jobId: onchainJobId };
  }

  private async reconcileAndMirror(
    jobRequestId: string | null,
    jobId: string | undefined,
    action: TxAction,
    block: bigint,
  ): Promise<void> {
    let requestId = jobRequestId ?? undefined;
    if (jobId && requestId && action === "OPEN_JOB") {
      // Two loud duplicate-fund signals (review 061): (a) reconcileJobId returns false when THIS intent
      // already maps to a DIFFERENT jobId (two prepares, two funded jobs) — no silent overwrite;
      // (b) a P2002 when the SAME jobId maps onto another intent. Either → DUPLICATE_JOB, never swallow.
      try {
        const reconciled = await reconcileJobId(requestId, jobId);
        if (!reconciled) {
          await appendFeedEvent({ kind: "DUPLICATE_JOB", jobRequestId: requestId, payload: { jobId } });
          throw new ApiError("IDEMPOTENCY_CONFLICT", "This intent already maps to a different jobId (possible double-fund)");
        }
      } catch (err) {
        if (err instanceof ApiError) throw err;
        if (err && typeof err === "object" && (err as { code?: string }).code === "P2002") {
          await appendFeedEvent({ kind: "DUPLICATE_JOB", jobRequestId: requestId, payload: { jobId } });
          throw new ApiError("IDEMPOTENCY_CONFLICT", "Duplicate JobCreated for this intent (possible double-fund)");
        }
        throw err;
      }
    }
    if (!requestId && jobId) requestId = (await getJobMetaByJobId(jobId))?.clientRequestId;
    const label = MIRROR_STATUS[action];
    if (requestId && label) await mirrorJobStatus(requestId, label, block);
  }

  async getStatus(txHash: string): Promise<TrackResult> {
    const row = await getTrackedTx(txHash);
    if (!row) throw new ApiError("NOT_FOUND", "Unknown transaction");
    // Surface the true terminal state — a MISMATCH must NOT read as PENDING (review 062).
    const status = row.status === "CONFIRMED" ? "CONFIRMED" : row.status === "MISMATCH" ? "MISMATCH" : "PENDING";
    return {
      txHash: row.txHash,
      status,
      confirmations: row.confirmations,
      eventVerified: row.eventVerified,
      jobId: row.jobId ?? undefined,
    };
  }
}
