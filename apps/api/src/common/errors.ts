/**
 * API-LOCAL error taxonomy (architecture review §7). These are pure NestJS/HTTP-transport concerns
 * thrown only in `apps/api` — keeping them here, rather than in the shared `VouchErrorCode` union,
 * avoids forcing `apps/agent`'s exhaustive `HTTP_STATUS` map to carry ~10 codes it can never throw.
 *
 * The global filter (`vouch-error.filter.ts`) maps BOTH `VouchError` (shared codes: SUBGRAPH_*,
 * VALIDATION_FAILED, QUOTE_INVALID, …) AND `ApiError` (these) to the one `{ error, message }` envelope.
 */

export type ApiErrorCode =
  | "UNAUTHORIZED" // 401 — SIWE/session failure
  | "FORBIDDEN" // 403 — role / job-party mismatch
  | "NOT_FOUND" // 404 — unknown job/quote/tx
  | "PAUSED" // 409 — entry action prepared while paused
  | "STATE_CONFLICT" // 409 — job not in the required state
  | "IDEMPOTENCY_CONFLICT" // 409 — key reused w/ different body, or second distinct txHash
  | "TX_MISMATCH" // 422 — mined tx ≠ prepared intent
  | "TX_REVERTED" // 422 — receipt reverted (carries decoded Errors.* reason)
  | "TX_TIMEOUT" // 504 — receipt not found within the bounded wait
  | "AGENT_UNAVAILABLE" // 503 — the agent's REST core is unreachable/erroring
  | "CRE_RESULT_MALFORMED"; // 502 — malformed ConfidentialEvaluationResolved

export class ApiError extends Error {
  readonly code: ApiErrorCode;

  constructor(code: ApiErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ApiError";
    this.code = code;
  }
}
