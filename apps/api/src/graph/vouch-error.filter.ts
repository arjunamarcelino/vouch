import { Catch, HttpStatus, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import { VouchError, type VouchErrorCode } from "@vouch/shared/errors";

/** Minimal HTTP response surface (avoids a hard @types/express dependency). */
interface JsonResponse {
  status(code: number): { json(body: unknown): void };
}

/**
 * Maps typed VouchErrors to HTTP status. Fail-closed: SUBGRAPH_* → 503 (never a fabricated 200 with
 * empty/stale history — plan §5.4). The `satisfies` map is exhaustive at compile time, so adding a
 * new VouchErrorCode forces a mapping decision here.
 */
const STATUS = {
  SUBGRAPH_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  SUBGRAPH_STALE: HttpStatus.SERVICE_UNAVAILABLE,
  SUBGRAPH_LAGGING: HttpStatus.SERVICE_UNAVAILABLE,
  VALIDATION_FAILED: HttpStatus.BAD_REQUEST,
  CONFIG_INVALID: HttpStatus.INTERNAL_SERVER_ERROR,
  CHAIN_NOT_CONFIGURED: HttpStatus.INTERNAL_SERVER_ERROR,
  NOT_IMPLEMENTED: HttpStatus.NOT_IMPLEMENTED,
} satisfies Record<VouchErrorCode, HttpStatus>;

@Catch(VouchError)
export class VouchErrorFilter implements ExceptionFilter {
  catch(exception: VouchError, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<JsonResponse>();
    const status = STATUS[exception.code];
    // Don't leak internal config detail on 5xx-that-are-our-fault (031). SUBGRAPH_* are 503 with
    // useful operational messages ("N blocks behind") — those are safe to surface.
    const internal = exception.code === "CONFIG_INVALID" || exception.code === "CHAIN_NOT_CONFIGURED";
    res.status(status).json({
      error: exception.code,
      message: internal ? "Service temporarily unavailable" : exception.message,
    });
  }
}
