import { keccak256, toHex } from "viem";
import type { JobRequest } from "@vouch/shared/schemas";

/**
 * Deterministic canonicalization of job terms → an OPAQUE `jobHash` that binds the exact request
 * (altered-param protection, plan §5). Sorted keys, fixed string encoding, no whitespace, so the same
 * terms always hash identically across processes. The escrow contract only STORES/COMPARES this hash
 * (it never recomputes it), so JSON-canonicalization here need not mirror Solidity `abi.encode`
 * (§0.3). Canonicalization bugs are the classic "valid signature, wrong terms" hole — hence its own
 * tested module.
 */
export function canonicalizeJob(job: JobRequest): string {
  // JobRequest is a flat record of strings/enums; emit keys in a fixed order.
  return JSON.stringify({
    coverageDurationSeconds: job.coverageDurationSeconds,
    payee: job.payee.toLowerCase(),
    payer: job.payer.toLowerCase(),
    provider: job.provider.toLowerCase(),
    providerCollateral: job.providerCollateral,
    requestedGuarantee: job.requestedGuarantee,
    taskCategory: job.taskCategory,
    taskFee: job.taskFee,
    token: job.token.toLowerCase(),
    verificationMethod: job.verificationMethod,
  });
}

export function jobHash(job: JobRequest): `0x${string}` {
  return keccak256(toHex(canonicalizeJob(job)));
}
