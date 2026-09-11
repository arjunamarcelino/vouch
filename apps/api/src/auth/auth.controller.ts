import { Body, Controller, Get, Post, Req, Res, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { parseOrThrow } from "@vouch/shared/schemas";
import { getProfile } from "@vouch/db";
import { SiweService } from "./siwe.service";
import { SessionService } from "./session.service";
import { AuthGuard } from "./guards/auth.guard";
import { ChainService } from "../common/chain/chain.service";
import { loadEnv } from "../config/env";
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
export class AuthController {
  private readonly env = loadEnv();

  constructor(
    private readonly siwe: SiweService,
    private readonly session: SessionService,
    private readonly chain: ChainService,
  ) {}

  @Post("nonce")
  nonce(): Promise<{ nonce: string }> {
    return this.siwe.issueNonce();
  }

  @Post("verify")
  async verify(@Body() body: unknown, @Res({ passthrough: true }) res: CookieRes): Promise<{ address: string }> {
    const { message, signature } = parseOrThrow(verifyBodySchema, body, "SIWE verify body");
    const { address } = await this.siwe.verify(message, signature as `0x${string}`);
    const c = this.session.cookie(address);
    res.cookie(c.name, c.value, c.options);
    return { address };
  }

  @Post("logout")
  logout(@Res({ passthrough: true }) res: CookieRes): { ok: true } {
    const c = this.session.clearCookie();
    res.clearCookie(c.name, c.options);
    return { ok: true };
  }

  @Get("me")
  @UseGuards(AuthGuard)
  async me(@Req() req: { user: SessionUser }): Promise<{ address: string; roles: string[]; displayName: string }> {
    const address = req.user.address;
    const roles: string[] = [];
    if (this.env.ADMIN_ADDRESSES.includes(address)) roles.push("ADMIN");
    try {
      const role = await this.chain.evaluatorRole();
      if (await this.chain.hasRole(role, address)) roles.push("EVALUATOR");
    } catch {
      // role lookup unavailable (no RPC / down) — omit EVALUATOR rather than fail the whole profile read
    }
    const profile = await getProfile(address);
    return { address, roles, displayName: profile?.displayName ?? "" };
  }
}
