import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from "@nestjs/common";
import { createLogger } from "@vouch/shared/logger";
import type { Observable } from "rxjs";
import { tap } from "rxjs/operators";
import { correlationId } from "../correlation/correlation";

/**
 * Structured request logging on a child of the shared pino logger (reuses `@vouch/shared/logger`'s
 * REDACT_PATHS — no parallel redaction config; pattern-consistency review). Every line carries the
 * correlationId, method, path, status, and latencyMs.
 */
const log = createLogger("api");

interface MinHttpReq {
  method: string;
  originalUrl?: string;
  url?: string;
}
interface MinHttpRes {
  statusCode: number;
}

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = ctx.switchToHttp();
    const req = http.getRequest<MinHttpReq>();
    const res = http.getResponse<MinHttpRes>();
    const start = Date.now();
    const path = req.originalUrl ?? req.url ?? "";
    return next.handle().pipe(
      tap({
        next: () =>
          log.info(
            { correlationId: correlationId(), method: req.method, path, status: res.statusCode, latencyMs: Date.now() - start },
            "request",
          ),
        error: (err: unknown) =>
          log.warn(
            {
              correlationId: correlationId(),
              method: req.method,
              path,
              latencyMs: Date.now() - start,
              err: err instanceof Error ? err.message : String(err),
            },
            "request failed",
          ),
      }),
    );
  }
}
