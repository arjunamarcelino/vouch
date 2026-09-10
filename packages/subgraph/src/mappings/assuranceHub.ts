import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import {
  JobCreated,
  JobFunded,
  ProviderAccepted,
  DeliverableSubmitted,
  InitialEvaluationResolved,
  CoverageStarted,
  ClaimOpened,
  ConfidentialEvaluationResolved,
  GuaranteePaid,
  CollateralReleased,
  JobExpired,
  JobCancelled,
  ServiceFeePaid,
  ClaimTimedOut,
} from "../../generated/AssuranceHub/AssuranceHub";
import { Provider, Job, Guarantee, Claim, Payout } from "../../generated/schema";

const ONE = BigInt.fromI32(1);

const FUNDED = "FUNDED";
const ACCEPTED = "ACCEPTED";
const SUBMITTED = "SUBMITTED";
const INITIALLY_APPROVED = "INITIALLY_APPROVED";
const CLAIM_PENDING = "CLAIM_PENDING";
const CLAIM_PAID = "CLAIM_PAID";
const COMPLETED = "COMPLETED";
const CANCELLED = "CANCELLED";
const EXPIRED = "EXPIRED";

const G_LOCKED = "LOCKED";
const G_PAID = "PAID";
const G_RELEASED = "RELEASED";

function jobIdToBytes(jobId: BigInt): Bytes {
  return Bytes.fromByteArray(Bytes.fromBigInt(jobId));
}

function getOrCreateProvider(address: Address, block: ethereum.Block): Provider {
  let p = Provider.load(address);
  if (p == null) {
    p = new Provider(address);
    p.jobsCreated = BigInt.zero();
    p.jobsFunded = BigInt.zero();
    p.jobsCompleted = BigInt.zero();
    p.contestedCompletions = BigInt.zero();
    p.guaranteesLocked = BigInt.zero();
    p.guaranteesActive = BigInt.zero();
    p.claimsOpened = BigInt.zero();
    p.claimsPaid = BigInt.zero();
    p.totalPaidOut = BigInt.zero();
    p.totalGuaranteedValue = BigInt.zero();
    p.totalFeesEarned = BigInt.zero();
    p.totalServiceFees = BigInt.zero();
    p.firstSeenBlock = block.number;
  }
  p.lastUpdatedBlock = block.number;
  return p as Provider;
}

// LOCKED -> RELEASED master transition. Decrements guaranteesActive exactly once. When
// `countCompleted` and the Job is still INITIALLY_APPROVED, marks it COMPLETED and books the
// window as CLEAN (no claim) or CONTESTED (a claim was opened but resolved not-covered/timeout)
// so stonewalling the CRE can't read as a clean finish (finding 007).
function releaseGuaranteeIfLocked(id: Bytes, block: ethereum.Block, countCompleted: boolean): void {
  let g = Guarantee.load(id);
  if (g == null || g.status != G_LOCKED) return;
  g.status = G_RELEASED;
  g.save();

  let provider = Provider.load(g.provider);
  if (provider == null) return;
  if (provider.guaranteesActive.gt(BigInt.zero())) {
    provider.guaranteesActive = provider.guaranteesActive.minus(ONE);
  }
  if (countCompleted) {
    let job = Job.load(id);
    if (job != null && job.status == INITIALLY_APPROVED) {
      job.status = COMPLETED;
      job.save();
      if (Claim.load(id) == null) {
        provider.jobsCompleted = provider.jobsCompleted.plus(ONE); // clean window
      } else {
        provider.contestedCompletions = provider.contestedCompletions.plus(ONE); // contested window
      }
    }
  }
  provider.lastUpdatedBlock = block.number;
  provider.save();
}

export function handleJobCreated(event: JobCreated): void {
  let provider = getOrCreateProvider(event.params.provider, event.block);
  let id = jobIdToBytes(event.params.jobId);

  let job = Job.load(id);
  if (job == null) {
    job = new Job(id);
    job.jobId = event.params.jobId;
    job.client = event.params.client;
    job.provider = provider.id;
    job.status = FUNDED; // openJob merges create+fund; job is Funded on creation (plan §19 D2)
    job.taskFee = event.params.taskFee;
    job.guaranteeAmount = event.params.guaranteeAmount;
    job.serviceFee = event.params.serviceFee;
    job.submissionDeadline = event.params.submissionDeadline;
    job.coverageEnd = null;
    job.publicCriteriaHash = event.params.publicCriteriaHash;
    job.privateCriteriaCommitment = event.params.privateCriteriaCommitment;
    job.submissionCommitment = null;
    job.feeCounted = false;
    job.serviceFeeCounted = false;
    job.createdAtBlock = event.block.number;
    job.createdAtTimestamp = event.block.timestamp;
    job.txHash = event.transaction.hash;
    job.save();

    provider.jobsCreated = provider.jobsCreated.plus(ONE);
  }
  provider.save();
}

export function handleJobFunded(event: JobFunded): void {
  let id = jobIdToBytes(event.params.jobId);
  let job = Job.load(id);
  if (job == null) return;
  let provider = Provider.load(job.provider);
  if (provider == null) return;
  provider.jobsFunded = provider.jobsFunded.plus(ONE);
  provider.lastUpdatedBlock = event.block.number;
  provider.save();
}

export function handleProviderAccepted(event: ProviderAccepted): void {
  let provider = getOrCreateProvider(event.params.provider, event.block);
  let id = jobIdToBytes(event.params.jobId);
  let job = Job.load(id);

  let g = Guarantee.load(id);
  if (g == null) {
    g = new Guarantee(id);
    g.job = id;
    g.provider = provider.id;
    g.amount = event.params.collateral;
    g.status = G_LOCKED;
    g.coverageDeadline = null;
    g.lockedAtBlock = event.block.number;
    g.lockedAtTimestamp = event.block.timestamp;
    g.save();

    provider.guaranteesLocked = provider.guaranteesLocked.plus(ONE);
    provider.guaranteesActive = provider.guaranteesActive.plus(ONE);
    provider.totalGuaranteedValue = provider.totalGuaranteedValue.plus(event.params.collateral);
  }
  if (job != null && job.status == FUNDED) {
    job.status = ACCEPTED;
    job.save();
  }
  provider.save();
}

export function handleDeliverableSubmitted(event: DeliverableSubmitted): void {
  let id = jobIdToBytes(event.params.jobId);
  let job = Job.load(id);
  if (job != null && job.status == ACCEPTED) {
    job.submissionCommitment = event.params.submissionCommitment;
    job.status = SUBMITTED;
    job.save();
  }
}

export function handleInitialEvaluationResolved(event: InitialEvaluationResolved): void {
  let id = jobIdToBytes(event.params.jobId);
  let job = Job.load(id);
  if (job == null || job.status != SUBMITTED) return;

  if (event.params.approved) {
    job.status = INITIALLY_APPROVED;
    if (!job.feeCounted) {
      let provider = Provider.load(job.provider);
      if (provider != null) {
        provider.totalFeesEarned = provider.totalFeesEarned.plus(job.taskFee);
        provider.lastUpdatedBlock = event.block.number;
        provider.save();
      }
      job.feeCounted = true;
    }
    job.save();
  } else {
    // Reject: JobCancelled (same tx) sets CANCELLED and releases the guarantee.
    job.status = CANCELLED;
    job.save();
  }
}

export function handleCoverageStarted(event: CoverageStarted): void {
  let id = jobIdToBytes(event.params.jobId);
  let job = Job.load(id);
  if (job != null) {
    job.coverageEnd = event.params.coverageEnd;
    job.save();
  }
  let g = Guarantee.load(id);
  if (g != null) {
    g.coverageDeadline = event.params.coverageEnd;
    g.save();
  }
}

export function handleClaimOpened(event: ClaimOpened): void {
  let id = jobIdToBytes(event.params.jobId);
  let job = Job.load(id);
  if (job == null) return; // a claim always follows an existing job

  if (Claim.load(id) == null) {
    let claim = new Claim(id);
    claim.job = id;
    claim.provider = job.provider;
    claim.client = event.params.client;
    claim.evidenceCommitment = event.params.evidenceCommitment;
    claim.covered = false; // meaningful only once resolvedAtTimestamp is set
    claim.resolvedByTimeout = false;
    claim.serviceCredit = null;
    claim.openedAtBlock = event.block.number;
    claim.openedAtTimestamp = event.block.timestamp;
    claim.resolvedAtBlock = null;
    claim.resolvedAtTimestamp = null;
    claim.save();

    let provider = Provider.load(job.provider);
    if (provider != null) {
      provider.claimsOpened = provider.claimsOpened.plus(ONE);
      provider.lastUpdatedBlock = event.block.number;
      provider.save();
    }
  }
  if (job.status == INITIALLY_APPROVED) {
    job.status = CLAIM_PENDING;
    job.save();
  }
}

export function handleConfidentialEvaluationResolved(event: ConfidentialEvaluationResolved): void {
  let id = jobIdToBytes(event.params.jobId);
  let claim = Claim.load(id);
  if (claim != null) {
    // ConfidentialEvaluationResolved fires at most once per job (claim latch), so no
    // resolved-guard is needed — avoid a nullable-getter null-check that crashes asc.
    claim.covered = event.params.covered;
    claim.serviceCredit = event.params.serviceCredit;
    claim.resolvedAtBlock = event.block.number;
    claim.resolvedAtTimestamp = event.block.timestamp;
    claim.save();
  }
  // Not covered -> back to coverage. Covered -> CLAIM_PAID handled in handleGuaranteePaid (same tx).
  if (!event.params.covered) {
    let job = Job.load(id);
    if (job != null && job.status == CLAIM_PENDING) {
      job.status = INITIALLY_APPROVED;
      job.save();
    }
  }
}

export function handleGuaranteePaid(event: GuaranteePaid): void {
  let id = jobIdToBytes(event.params.jobId);
  if (Payout.load(id) != null) return; // one payout per job

  let g = Guarantee.load(id);
  if (g == null) return;
  let provider = Provider.load(g.provider);
  if (provider == null) return;

  let payout = new Payout(id);
  payout.job = id;
  payout.provider = g.provider;
  payout.amount = event.params.amount;
  payout.toClient = event.params.client;
  payout.atBlock = event.block.number;
  payout.atTimestamp = event.block.timestamp;
  payout.txHash = event.transaction.hash;
  payout.save();

  if (g.status == G_LOCKED) {
    g.status = G_PAID;
    g.save();
    if (provider.guaranteesActive.gt(BigInt.zero())) {
      provider.guaranteesActive = provider.guaranteesActive.minus(ONE);
    }
    // A paid (covered) window is counted via claimsPaid below, NOT jobsCompleted (finding 007):
    // jobsCompleted is clean-only; the full denominator is jobsCompleted + contestedCompletions + claimsPaid.
  }

  let job = Job.load(id);
  if (job != null) {
    job.status = CLAIM_PAID;
    job.save();
  }

  provider.claimsPaid = provider.claimsPaid.plus(ONE);
  provider.totalPaidOut = provider.totalPaidOut.plus(event.params.amount);
  provider.lastUpdatedBlock = event.block.number;
  provider.save();
}

export function handleCollateralReleased(event: CollateralReleased): void {
  // Fires on withdrawCollateral (clean -> Completed) and as the onReport covered remainder.
  // The remainder case is a no-op here (guarantee already PAID in handleGuaranteePaid same tx).
  releaseGuaranteeIfLocked(jobIdToBytes(event.params.jobId), event.block, true);
}

export function handleJobExpired(event: JobExpired): void {
  let id = jobIdToBytes(event.params.jobId);
  let job = Job.load(id);
  if (job != null) {
    job.status = EXPIRED;
    job.save();
  }
  releaseGuaranteeIfLocked(id, event.block, false);
}

export function handleJobCancelled(event: JobCancelled): void {
  let id = jobIdToBytes(event.params.jobId);
  let job = Job.load(id);
  if (job != null) {
    job.status = CANCELLED;
    job.save();
  }
  releaseGuaranteeIfLocked(id, event.block, false);
}

export function handleServiceFeePaid(event: ServiceFeePaid): void {
  let id = jobIdToBytes(event.params.jobId);
  let job = Job.load(id);
  if (job == null) return;
  if (!job.serviceFeeCounted) {
    let provider = Provider.load(job.provider);
    if (provider != null) {
      provider.totalServiceFees = provider.totalServiceFees.plus(event.params.amount);
      provider.lastUpdatedBlock = event.block.number;
      provider.save();
    }
    job.serviceFeeCounted = true;
    job.save();
  }
}

// resolveClaimTimeout emits ClaimTimedOut (first) + ConfidentialEvaluationResolved(false,0).
// Mark the claim as timeout-resolved so consumers can tell CRE-inactivity from a real verdict (007).
export function handleClaimTimedOut(event: ClaimTimedOut): void {
  let claim = Claim.load(jobIdToBytes(event.params.jobId));
  if (claim != null) {
    claim.resolvedByTimeout = true;
    claim.save();
  }
}
