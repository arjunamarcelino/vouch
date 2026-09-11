import { Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { ApiError } from "../../common/errors";
import { loadEnv } from "../../config/env";

/**
 * Bearer `SYSTEM_API_KEY` gate for system/agent callbacks (health, tx re-verification triggers). It
 * carries NO `req.user.address`, so a holder can never pass `@JobParty` and thus cannot prepare or bind
 * a value-moving action — the system key only triggers re-verification, never asserts state. The
 * agent-actor path for money/state actions is SIWE→Bearer session (AuthGuard), not this key.
 */
@Injectable()
export class AgentKeyGuard implements CanActivate {
  private readonly key = loadEnv().SYSTEM_API_KEY;

  canActivate(ctx: ExecutionContext): boolean {
    if (!this.key) throw new ApiError("UNAUTHORIZED", "System key not configured");
    const auth = ctx.switchToHttp().getRequest<{ headers: Record<string, string | string[] | undefined> }>().headers[
      "authorization"
    ];
    const token = typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice(7) : undefined;
    if (token !== this.key) throw new ApiError("UNAUTHORIZED", "Invalid system key");
    return true;
  }
}
