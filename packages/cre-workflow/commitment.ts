/**
 * Evidence-commitment preimage + hash.
 *
 * The commitment binds the public, reproducible verdict fields (plus the
 * evaluated submission commit and the pinned workflow identity) into a single
 * keccak256. It is an INTEGRITY / reproducibility binding, NOT a hiding
 * commitment — every field is public-safe and low-entropy, so it is salt-free
 * by design. It contains NO `reportId` (assigned by the forwarder AFTER the
 * commitment is computed) and NO secret.
 *
 * Preimage (abi.encode order):
 *   (uint256 chainId, address hub, uint256 jobId, bool covered, uint256 amount,
 *    bytes32 evaluatedCommit, uint64 evaluatedAt, bytes32 workflowId)
 * where `evaluatedCommit == job.submissionCommitment`.
 *
 * SDK-independent (viem only) so it is unit-testable without the CRE SDK.
 */
import { encodeAbiParameters, keccak256 } from "viem";
import type { AbiParameter } from "viem";

export interface EvidenceCommitmentFields {
  readonly chainId: bigint;
  readonly hub: `0x${string}`;
  readonly jobId: bigint;
  readonly covered: boolean;
  readonly amount: bigint;
  /** The job's submissionCommitment (the "evaluated commit"). */
  readonly evaluatedCommit: `0x${string}`;
  readonly evaluatedAt: bigint;
  /** The pinned Keystone workflow identifier. */
  readonly workflowId: `0x${string}`;
}

const PREIMAGE_ABI_PARAMS = [
  { name: "chainId", type: "uint256" },
  { name: "hub", type: "address" },
  { name: "jobId", type: "uint256" },
  { name: "covered", type: "bool" },
  { name: "amount", type: "uint256" },
  { name: "evaluatedCommit", type: "bytes32" },
  { name: "evaluatedAt", type: "uint64" },
  { name: "workflowId", type: "bytes32" },
] as const satisfies readonly AbiParameter[];

/**
 * Build the pre-hash bytes of the evidence commitment. Returned separately from
 * the hash so tests can assert no secret sentinel appears in the preimage.
 */
export function buildEvidenceCommitmentPreimage(
  f: EvidenceCommitmentFields,
): `0x${string}` {
  return encodeAbiParameters(PREIMAGE_ABI_PARAMS, [
    f.chainId,
    f.hub,
    f.jobId,
    f.covered,
    f.amount,
    f.evaluatedCommit,
    f.evaluatedAt,
    f.workflowId,
  ]);
}

/** keccak256 of the evidence-commitment preimage. */
export function evidenceCommitment(f: EvidenceCommitmentFields): `0x${string}` {
  return keccak256(buildEvidenceCommitmentPreimage(f));
}
