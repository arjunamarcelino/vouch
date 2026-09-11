import { VouchError } from "@vouch/shared/errors";

/** Context every prepare/idempotent write needs: the caller + the Idempotency-Key binding. */
export interface PrepareCtx {
  address: string; // lowercased session address
  idempotencyKey: string;
}

interface CtxReq {
  user?: { address?: string };
  headers: Record<string, string | string[] | undefined>;
}

/** Extract PrepareCtx from a guarded request (shared by orchestration/claims/allowance — review 068). */
export function prepareCtx(req: CtxReq): PrepareCtx {
  const key = req.headers["idempotency-key"];
  return { address: req.user?.address ?? "", idempotencyKey: (Array.isArray(key) ? key[0] : key) ?? "" };
}

/** Validate a numeric jobId path param (redundant with JobPartyGuard on guarded routes, needed on the rest). */
export function requireNumericJobId(id: string | undefined): string {
  if (!id || !/^\d+$/u.test(id)) throw new VouchError("VALIDATION_FAILED", "Malformed jobId");
  return id;
}
