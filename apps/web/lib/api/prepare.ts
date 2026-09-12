import {
  transactionRequestSchema,
  trackResultSchema,
  allowanceViewSchema,
  quoteCommitmentSchema,
  type TransactionRequest,
  type TrackResult,
  type AllowanceView,
  type QuoteCommitment,
} from "@vouch/shared/schemas";
import { apiPost, apiGet } from "./client";

/** Request an autonomous risk quote (proxied to the agent). Idempotent; may 503 if the agent is down. */
export const requestQuote = (key: string, body: unknown): Promise<QuoteCommitment> =>
  apiPost("/quotes", quoteCommitmentSchema, "risk quote", body, key);

/** Fresh allowance read for the engine's pre-funding re-check (not the cached hook). */
export const fetchAllowance = (): Promise<AllowanceView> =>
  apiGet("/allowance", allowanceViewSchema, "allowance");

/**
 * Prepare/track calls. Each `prepare*` POSTs to the API and returns the unsigned `TransactionRequest`
 * (calldata the wallet signs verbatim). A fresh `Idempotency-Key` per attempt binds one key → one
 * prepared intent (the tx-engine generates it with `crypto.randomUUID()`). `trackTx` binds a mined tx
 * to its prepared intent and returns the server's arg-diff verdict.
 */
const R = transactionRequestSchema;

export const prepareApprove = (key: string, body: unknown) =>
  apiPost("/allowance/approve/prepare", R, "approve prepare", body, key);

export const prepareOpenJob = (key: string, body: unknown): Promise<TransactionRequest> =>
  apiPost("/jobs/prepare", R, "openJob prepare", body, key);

export const prepareAccept = (jobId: string, key: string): Promise<TransactionRequest> =>
  apiPost(`/jobs/${jobId}/accept/prepare`, R, "accept prepare", undefined, key);

export const prepareSubmit = (jobId: string, key: string, submissionCommitment: string): Promise<TransactionRequest> =>
  apiPost(`/jobs/${jobId}/deliverable/prepare`, R, "submit prepare", { submissionCommitment }, key);

export const prepareEvaluate = (jobId: string, key: string, approved: boolean): Promise<TransactionRequest> =>
  apiPost(`/jobs/${jobId}/evaluate/prepare`, R, "evaluate prepare", { approved }, key);

export const prepareCancel = (jobId: string, key: string): Promise<TransactionRequest> =>
  apiPost(`/jobs/${jobId}/cancel/prepare`, R, "cancel prepare", undefined, key);

export const prepareExpire = (jobId: string, key: string): Promise<TransactionRequest> =>
  apiPost(`/jobs/${jobId}/expire/prepare`, R, "expire prepare", undefined, key);

export const prepareWithdraw = (jobId: string, key: string): Promise<TransactionRequest> =>
  apiPost(`/jobs/${jobId}/withdraw/prepare`, R, "withdraw prepare", undefined, key);

export const prepareClaim = (jobId: string, key: string, commitment: string): Promise<TransactionRequest> =>
  apiPost(`/claims/${jobId}/prepare`, R, "claim prepare", { commitment }, key);

export const prepareResolveTimeout = (jobId: string, key: string): Promise<TransactionRequest> =>
  apiPost(`/claims/${jobId}/resolve-timeout/prepare`, R, "resolve-timeout prepare", undefined, key);

export const trackTx = (txHash: string, preparedId: string): Promise<TrackResult> =>
  apiPost("/transactions/track", trackResultSchema, "track tx", { txHash, preparedId });
