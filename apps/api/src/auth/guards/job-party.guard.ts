import { Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { VouchError } from "@vouch/shared/errors";
import { ApiError } from "../../common/errors";
import { ChainService, type OnchainJob } from "../../common/chain/chain.service";
import { JOB_PARTY_KEY, type JobPartySide, type SessionUser } from "../roles";

/**
 * Per-resource authorization: the session address must be the job's client or provider (chain-first —
 * reads `getJob`, never the operational mirror). Stashes the loaded job on `req.job` so the handler
 * reuses it (one chain read per action — performance rule). `"any"` requires only that the caller is a
 * participant (either party) — used by permissionless/any-participant actions. The contract re-enforces
 * all of this; this guard is an early UX/authz gate that avoids handing a user doomed calldata.
 */
interface PartyReq {
  params: Record<string, string | undefined>;
  user?: SessionUser;
  job?: OnchainJob;
}

@Injectable()
export class JobPartyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly chain: ChainService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const side = this.reflector.getAllAndOverride<JobPartySide>(JOB_PARTY_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!side) return true;
    const req = ctx.switchToHttp().getRequest<PartyReq>();
    if (!req.user) throw new ApiError("UNAUTHORIZED", "No session");

    const idParam = req.params.jobId ?? req.params.id;
    if (!idParam || !/^\d+$/u.test(idParam)) {
      throw new VouchError("VALIDATION_FAILED", "Missing or malformed jobId");
    }

    let job: OnchainJob;
    try {
      job = await this.chain.getJob(BigInt(idParam));
    } catch (err) {
      throw new ApiError("NOT_FOUND", "Job not found", err);
    }
    req.job = job;

    const addr = req.user.address.toLowerCase();
    const isClient = job.client.toLowerCase() === addr;
    const isProvider = job.provider.toLowerCase() === addr;
    const ok = side === "client" ? isClient : side === "provider" ? isProvider : isClient || isProvider;
    if (!ok) throw new ApiError("FORBIDDEN", `Caller is not the job ${side}`);
    return true;
  }
}
