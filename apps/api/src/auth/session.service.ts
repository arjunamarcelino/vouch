import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { getProfile } from "@vouch/db";
import { ChainService } from "../common/chain/chain.service";
import { loadEnv } from "../config/env";
import { SESSION_COOKIE } from "./guards/auth.guard";

export interface SessionCookie {
  name: string;
  value: string;
  options: {
    httpOnly: true;
    secure: boolean;
    sameSite: "strict";
    path: "/";
    maxAge: number;
  };
}

/**
 * Issues the SIWE session as a short-lived HS256 JWT (`sub = lowercased address`) in an httpOnly,
 * SameSite=Strict, Secure cookie. Strict is viable because SIWE has no redirect flow; it's the primary
 * CSRF defense for cookie-authenticated mutations. AuthGuard also accepts the same token as a Bearer
 * header (agent-native parity).
 */
@Injectable()
export class SessionService {
  private readonly env = loadEnv();
  private readonly secret = this.env.SESSION_SECRET ?? "dev-insecure-secret-please-set-SESSION_SECRET";

  constructor(
    private readonly jwt: JwtService,
    private readonly chain: ChainService,
  ) {}

  /** Resolve the session identity view: address + global roles + display name (review 065). */
  async me(address: string): Promise<{ address: string; roles: string[]; displayName: string }> {
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

  sign(address: string): string {
    return this.jwt.sign(
      { sub: address.toLowerCase() },
      { secret: this.secret, expiresIn: this.env.SESSION_TTL_SECONDS, algorithm: "HS256" },
    );
  }

  cookie(address: string): SessionCookie {
    return {
      name: SESSION_COOKIE,
      value: this.sign(address),
      options: {
        httpOnly: true,
        secure: this.env.CHAIN_ENV !== "development",
        sameSite: "strict",
        path: "/",
        maxAge: this.env.SESSION_TTL_SECONDS * 1000,
      },
    };
  }

  clearCookie(): { name: string; options: { path: "/" } } {
    return { name: SESSION_COOKIE, options: { path: "/" } };
  }
}
