import { Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Role } from "@vouch/shared/schemas";
import { ApiError } from "../../common/errors";
import { ChainService } from "../../common/chain/chain.service";
import { loadEnv } from "../../config/env";
import { ROLES_KEY, type SessionUser } from "../roles";

/**
 * Global-grant authorization. ADMIN is an env allowlist (and has NO value-moving route — enforced by
 * the positive function allowlist elsewhere). EVALUATOR is the on-chain `hasRole(EVALUATOR_ROLE)`,
 * short-TTL cached (a burst-absorbing cache; a stale positive only lets a doomed calldata be prepared,
 * never moves funds). Fail-closed: an RPC error on the role read denies. Runs AFTER AuthGuard.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  private readonly env = loadEnv();
  private readonly cache = new Map<string, { at: number; has: boolean }>();
  private readonly ttlMs = 20_000;

  constructor(
    private readonly reflector: Reflector,
    private readonly chain: ChainService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]) ?? [];
    if (required.length === 0) return true;
    const user = ctx.switchToHttp().getRequest<{ user?: SessionUser }>().user;
    if (!user) throw new ApiError("UNAUTHORIZED", "No session");
    const address = user.address.toLowerCase();

    for (const role of required) {
      if (role === "CLIENT" || role === "PROVIDER") continue; // contextual → JobPartyGuard
      if (role === "ADMIN" && this.env.ADMIN_ADDRESSES.includes(address)) return true;
      if (role === "EVALUATOR" && (await this.hasEvaluator(address))) return true;
    }
    throw new ApiError("FORBIDDEN", "Missing required role");
  }

  private async hasEvaluator(address: string): Promise<boolean> {
    const hit = this.cache.get(address);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.has;
    let has: boolean;
    try {
      const role = await this.chain.evaluatorRole();
      has = await this.chain.hasRole(role, address);
    } catch (err) {
      throw new ApiError("FORBIDDEN", "Role check unavailable", err); // fail-closed
    }
    // Bound the cache (review 072): a distinct-caller flood can't grow it without limit.
    if (this.cache.size >= 5_000) this.cache.clear();
    this.cache.set(address, { at: Date.now(), has });
    return has;
  }
}
