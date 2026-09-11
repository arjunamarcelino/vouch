import { Body, Controller, Get, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { z } from "zod";
import { parseOrThrow } from "@vouch/shared/schemas";
import { SiweService } from "./siwe.service";
import { SessionService } from "./session.service";
import { AuthGuard } from "./guards/auth.guard";
import type { SessionUser } from "./roles";

/** Minimal cookie surface (avoids a hard @types/express dependency). */
interface CookieRes {
  cookie(name: string, value: string, options: unknown): void;
  clearCookie(name: string, options: unknown): void;
}

const verifyBodySchema = z.object({
  message: z.string().min(1),
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/u, "must be 0x-prefixed hex"),
});

/**
 * SIWE session endpoints. `nonce` + `verify` are public (they establish identity); `me` requires a
 * session. On verify, the session JWT is set as an httpOnly+Strict cookie.
 */
@Controller("auth")
@Throttle({ default: { ttl: 60_000, limit: 20 } }) // tighter bucket on the public auth surface (review 056)
export class AuthController {
  constructor(
    private readonly siwe: SiweService,
    private readonly session: SessionService,
  ) {}

  @Post("nonce")
  nonce(): Promise<{ nonce: string }> {
    return this.siwe.issueNonce();
  }

  /**
   * Verify a SIWE message → set the session cookie (browsers). When `?bearer=1` is passed, ALSO return
   * the JWT in the body so a headless agent gets a first-class token to send as `Authorization: Bearer`
   * (agent-native parity — review 067) without scraping the httpOnly cookie.
   */
  @Post("verify")
  async verify(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: CookieRes,
    @Query("bearer") bearer?: string,
  ): Promise<{ address: string; token?: string }> {
    const { message, signature } = parseOrThrow(verifyBodySchema, body, "SIWE verify body");
    const { address } = await this.siwe.verify(message, signature as `0x${string}`);
    const c = this.session.cookie(address);
    res.cookie(c.name, c.value, c.options);
    return bearer === "1" ? { address, token: c.value } : { address };
  }

  @Post("logout")
  logout(@Res({ passthrough: true }) res: CookieRes): { ok: true } {
    const c = this.session.clearCookie();
    res.clearCookie(c.name, c.options);
    return { ok: true };
  }

  @Get("me")
  @UseGuards(AuthGuard)
  me(@Req() req: { user: SessionUser }): Promise<{ address: string; roles: string[]; displayName: string }> {
    return this.session.me(req.user.address);
  }
}
