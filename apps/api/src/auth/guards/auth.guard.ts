import { Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ApiError } from "../../common/errors";
import { sessionSecret } from "../../config/env";
import type { SessionUser } from "../roles";

/**
 * Verifies the SIWE session JWT and attaches `req.user = { address }`. Accepts the token via the
 * httpOnly cookie OR an `Authorization: Bearer` header — the Bearer path is what lets an agent (which
 * signs SIWE and holds the same session) drive the API like a human (agent-native parity). Fail-closed:
 * any verify failure → UNAUTHORIZED. Depends only on Phase-0 pieces (JwtService), not SIWE issuance.
 */
interface CookieReq {
  cookies?: Record<string, string>;
  headers: Record<string, string | string[] | undefined>;
  user?: SessionUser;
}

const COOKIE = "__Host-vouch_session";

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly secret = sessionSecret();

  constructor(private readonly jwt: JwtService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<CookieReq>();
    const auth = req.headers["authorization"];
    const bearer = typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice(7) : undefined;
    const token = req.cookies?.[COOKIE] ?? bearer;
    if (!token) throw new ApiError("UNAUTHORIZED", "No session");
    try {
      const claims = this.jwt.verify<{ sub: string }>(token, {
        secret: this.secret,
        algorithms: ["HS256"], // pin alg — reject alg:none / confusion
      });
      req.user = { address: claims.sub.toLowerCase() };
      return true;
    } catch (err) {
      throw new ApiError("UNAUTHORIZED", "Invalid session", err);
    }
  }
}

export const SESSION_COOKIE = COOKIE;
