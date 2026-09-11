import { Catch, HttpStatus, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import { VouchError, type VouchErrorCode } from "@vouch/shared/errors";
import { ApiError, type ApiErrorCode } from "./errors";

/** Minimal HTTP response surface (avoids a hard @types/express dependency). */
interface JsonResponse {
  status(code: number): { json(body: unknown): void };
}

/**
 * Maps typed errors to HTTP status. Catches BOTH the shared `VouchError` (transport/graph/quote codes
 * thrown by shared code) and the API-local `ApiError` (auth/tx/idempotency codes). Both `satisfies`
 * maps are exhaustive at compile time, so adding a code forces a mapping decision here. Fail-closed:
 * SUBGRAPH_* → 503 (never a fabricated 200 with empty/stale history).
 */
const VOUCH_STATUS = {
  SUBGRAPH_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  SUBGRAPH_STALE: HttpStatus.SERVICE_UNAVAILABLE,
  SUBGRAPH_LAGGING: HttpStatus.SERVICE_UNAVAILABLE,
  VALIDATION_FAILED: HttpStatus.BAD_REQUEST,
  CONFIG_INVALID: HttpStatus.INTERNAL_SERVER_ERROR,
  CHAIN_NOT_CONFIGURED: HttpStatus.INTERNAL_SERVER_ERROR,
  NOT_IMPLEMENTED: HttpStatus.NOT_IMPLEMENTED,
  QUOTE_INVALID: HttpStatus.BAD_REQUEST,
  SPEND_POLICY_VIOLATION: HttpStatus.FORBIDDEN,
  WRONG_CONTRACT: HttpStatus.INTERNAL_SERVER_ERROR,
} satisfies Record<VouchErrorCode, HttpStatus>;

const API_STATUS = {
  UNAUTHORIZED: HttpStatus.UNAUTHORIZED,
  FORBIDDEN: HttpStatus.FORBIDDEN,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  PAUSED: HttpStatus.CONFLICT,
  STATE_CONFLICT: HttpStatus.CONFLICT,
  IDEMPOTENCY_CONFLICT: HttpStatus.CONFLICT,
  TX_MISMATCH: HttpStatus.UNPROCESSABLE_ENTITY,
  TX_REVERTED: HttpStatus.UNPROCESSABLE_ENTITY,
  TX_TIMEOUT: HttpStatus.GATEWAY_TIMEOUT,
  CRE_RESULT_MALFORMED: HttpStatus.BAD_GATEWAY,
} satisfies Record<ApiErrorCode, HttpStatus>;

// Codes whose message could leak internal config/detail — masked to a generic string on the wire.
const MASKED = new Set<string>(["CONFIG_INVALID", "CHAIN_NOT_CONFIGURED", "WRONG_CONTRACT", "CRE_RESULT_MALFORMED"]);

@Catch(VouchError, ApiError)
export class VouchErrorFilter implements ExceptionFilter {
  catch(exception: VouchError | ApiError, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<JsonResponse>();
    const status =
      exception instanceof VouchError
        ? VOUCH_STATUS[exception.code]
        : API_STATUS[exception.code];
    res.status(status).json({
      error: exception.code,
      message: MASKED.has(exception.code) ? "Service temporarily unavailable" : exception.message,
    });
  }
}
