import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import {
  JobCreated,
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
import {
  Protocol,
  Provider,
  Client,
  Job,
  Coverage,
  Claim,
  Submission,
  InitialEvaluation,
  ConfidentialEvaluation,
  GuaranteePayout,
  CollateralMovement,
  ProviderRiskSnapshot,
  ProviderDailyMetric,
} from "../../generated/schema";

const ONE = BigInt.fromI32(1);
const ZERO = BigInt.zero();
const BPS = BigInt.fromI32(10000);
const BPS_UNDEFINED = BigInt.fromI32(-1);
const SECONDS_PER_DAY = BigInt.fromI32(86400);

// JobStatus
const FUNDED = "FUNDED";
const ACCEPTED = "ACCEPTED";
const SUBMITTED = "SUBMITTED";
const INITIALLY_APPROVED = "INITIALLY_APPROVED";
const CLAIM_PENDING = "CLAIM_PENDING";
const CLAIM_PAID = "CLAIM_PAID";
const COMPLETED = "COMPLETED";
const CANCELLED = "CANCELLED";
const EXPIRED = "EXPIRED";

// CoverageStatus
const C_LOCKED = "LOCKED";
const C_PAID = "PAID";
const C_RELEASED = "RELEASED";

// CollateralMovementKind
const K_LOCK = "LOCK";
const K_RELEASE_CLEAN = "RELEASE_CLEAN";
const K_RELEASE_REMAINDER = "RELEASE_REMAINDER";

// ------------------------------------------------------------------ //
//                              Helpers                                //
// ------------------------------------------------------------------ //

// NOTE (014): Bytes.fromBigInt yields a minimal LITTLE-ENDIAN, variable-length id. Injective for
// positive jobIds; every lifecycle entity routes through this helper so ids are collision-free.
function jobIdToBytes(jobId: BigInt): Bytes {
  return Bytes.fromByteArray(Bytes.fromBigInt(jobId));
}

// Deterministic id for an immutable event record: txHash ++ logIndex (unique per log — multiple
// events in one tx never collide). concatI32 appends the i32 as 4 little-endian bytes (plan §3.5).
function eventId(event: ethereum.Event): Bytes {
  return event.transaction.hash.concatI32(event.logIndex.toI32());
}

// Integer basis points, multiply-before-divide. Returns -1 (never 0) when the denominator is zero so
// a 0/0 new provider is never read as a perfect record (plan §3.5.3).
function toBps(numerator: BigInt, denominator: BigInt): BigInt {
  if (denominator.isZero()) return BPS_UNDEFINED;
  return numerator.times(BPS).div(denominator);
}

function getOrCreateProtocol(event: ethereum.Event): Protocol {
  let p = Protocol.load(event.address);
  if (p == null) {
    p = new Protocol(event.address);
    p.totalProviders = ZERO;
    p.totalClients = ZERO;
    p.totalJobs = ZERO;
    p.totalGuaranteePaidOut = ZERO;
  }
  p.lastUpdatedBlock = event.block.number;
  return p as Protocol;
}

function getOrCreateProvider(address: Address, event: ethereum.Event): Provider {
  let p = Provider.load(address);
  if (p == null) {
    p = new Provider(address);
    p.jobsAccepted = ZERO;
    p.jobsInitiallyApproved = ZERO;
    p.jobsCompleted = ZERO;
    p.contestedCompletions = ZERO;
    p.claimsOpened = ZERO;
    p.claimsUpheld = ZERO;
    p.claimsRejected = ZERO;
    p.activeGuaranteeAmount = ZERO;
    p.totalCoveredAmount = ZERO;
    p.totalGuaranteedValue = ZERO;
    p.totalPayoutAmount = ZERO;
    p.totalFeesEarned = ZERO;
    p.totalServiceFees = ZERO;
    p.firstSeenBlock = event.block.number;
    p.lastUpheldClaimRateBps = BPS_UNDEFINED;
    p.lastClaimFrequencyBps = BPS_UNDEFINED;
    p.lastAverageCoverageRatioBps = BPS_UNDEFINED;
    p.lastPayoutToCoveredValueBps = BPS_UNDEFINED;

    let protocol = getOrCreateProtocol(event);
    protocol.totalProviders = protocol.totalProviders.plus(ONE);
    protocol.save();
  }
  p.lastActivityTimestamp = event.block.timestamp;
  p.lastUpdatedBlock = event.block.number;
  return p as Provider;
}

function getOrCreateClient(address: Address, event: ethereum.Event): Client {
  let c = Client.load(address);
  if (c == null) {
    c = new Client(address);
    c.jobsCommissioned = ZERO;
    c.claimsOpened = ZERO;
    c.totalTaskFeesPaid = ZERO;
    c.firstSeenBlock = event.block.number;

    let protocol = getOrCreateProtocol(event);
    protocol.totalClients = protocol.totalClients.plus(ONE);
    protocol.save();
  }
  c.lastActivityTimestamp = event.block.timestamp;
  return c as Client;
}

// The ONLY place activeGuaranteeAmount and coverage-close completions change. Idempotent: no-ops
// unless the Coverage is still LOCKED. Subtracts the STORED coverage amount, never an event amount
// (fixes the covered-with-remainder double-subtract, plan §3.5 / data-integrity H2). When
// countCompleted, books the closed window as CLEAN or CONTESTED (finding 007).
function releaseExposureIfLocked(
  id: Bytes,
  targetStatus: string,
  countCompleted: boolean,
  event: ethereum.Event,
): void {
  let coverage = Coverage.load(id);
  if (coverage == null || coverage.status != C_LOCKED) return;
  coverage.status = targetStatus;
  coverage.save();

  let provider = Provider.load(coverage.provider);
  if (provider == null) return;
  if (provider.activeGuaranteeAmount.ge(coverage.amount)) {
    provider.activeGuaranteeAmount = provider.activeGuaranteeAmount.minus(coverage.amount);
  } else {
    provider.activeGuaranteeAmount = ZERO;
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
  provider.lastActivityTimestamp = event.block.timestamp;
  provider.lastUpdatedBlock = event.block.number;
  provider.save();
  materializeRiskSnapshot(provider, event);
}

// Recomputes the four bps and appends an immutable ProviderRiskSnapshot ONLY when a value changed
// (in-memory diff vs Provider.last*Bps — no extra store read; collapses same-tx bursts to one
// snapshot; id collision impossible). plan §3.5.2/§3.5.3.
function materializeRiskSnapshot(provider: Provider, event: ethereum.Event): void {
  let claimsResolved = provider.claimsUpheld.plus(provider.claimsRejected);
  let upheldClaimRateBps = toBps(provider.claimsUpheld, claimsResolved);
  let claimFrequencyBps = toBps(provider.claimsOpened, provider.jobsInitiallyApproved);
  let averageCoverageRatioBps = toBps(provider.totalGuaranteedValue, provider.totalCoveredAmount);
  let payoutToCoveredValueBps = toBps(provider.totalPayoutAmount, provider.totalCoveredAmount);

  let changed =
    upheldClaimRateBps != provider.lastUpheldClaimRateBps ||
    claimFrequencyBps != provider.lastClaimFrequencyBps ||
    averageCoverageRatioBps != provider.lastAverageCoverageRatioBps ||
    payoutToCoveredValueBps != provider.lastPayoutToCoveredValueBps;
  if (!changed) return;

  let snapshot = new ProviderRiskSnapshot(
    provider.id.concat(event.transaction.hash).concatI32(event.logIndex.toI32()),
  );
  snapshot.provider = provider.id;
  snapshot.completedJobs = provider.jobsCompleted;
  snapshot.upheldClaimRateBps = upheldClaimRateBps;
  snapshot.claimFrequencyBps = claimFrequencyBps;
  snapshot.averageCoverageRatioBps = averageCoverageRatioBps;
  snapshot.payoutToCoveredValueBps = payoutToCoveredValueBps;
  snapshot.totalCoveredAmount = provider.totalCoveredAmount;
  snapshot.totalPayoutAmount = provider.totalPayoutAmount;
  snapshot.sampleSize = claimsResolved;
  snapshot.hasEnoughHistory = provider.jobsInitiallyApproved.gt(ZERO);
  snapshot.blockNumber = event.block.number;
  snapshot.timestamp = event.block.timestamp;
  snapshot.txHash = event.transaction.hash;
  snapshot.save();

  provider.lastUpheldClaimRateBps = upheldClaimRateBps;
  provider.lastClaimFrequencyBps = claimFrequencyBps;
  provider.lastAverageCoverageRatioBps = averageCoverageRatioBps;
  provider.lastPayoutToCoveredValueBps = payoutToCoveredValueBps;
  provider.save();
}

// Manual per-provider day-bucket (plan §3.5.5). Updated ONLY on real claim resolutions so the agent
// can compute a trailing-window recentFailureRate = sum(upheldFailures)/sum(resolvedClaims).
function bumpDailyMetric(
  provider: Provider,
  upheld: boolean,
  payoutAmount: BigInt,
  event: ethereum.Event,
): void {
  let dayId = event.block.timestamp.div(SECONDS_PER_DAY);
  let id = provider.id.concatI32(dayId.toI32());
  let metric = ProviderDailyMetric.load(id);
  if (metric == null) {
    metric = new ProviderDailyMetric(id);
    metric.provider = provider.id;
    metric.dayId = dayId;
    metric.dayStartTimestamp = dayId.times(SECONDS_PER_DAY);
    metric.upheldFailures = ZERO;
    metric.resolvedClaims = ZERO;
    metric.payoutAmount = ZERO;
  }
  metric.resolvedClaims = metric.resolvedClaims.plus(ONE);
  if (upheld) {
    metric.upheldFailures = metric.upheldFailures.plus(ONE);
    metric.payoutAmount = metric.payoutAmount.plus(payoutAmount);
  }
  metric.lastUpdatedBlock = event.block.number;
  metric.save();
}

// ------------------------------------------------------------------ //
//                             Handlers                               //
// ------------------------------------------------------------------ //

export function handleJobCreated(event: JobCreated): void {
  let provider = getOrCreateProvider(event.params.provider, event);
  let client = getOrCreateClient(event.params.client, event);
  let id = jobIdToBytes(event.params.jobId);

  let job = Job.load(id);
  if (job == null) {
    job = new Job(id);
    job.jobId = event.params.jobId;
    job.client = client.id;
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

    client.jobsCommissioned = client.jobsCommissioned.plus(ONE);
    client.totalTaskFeesPaid = client.totalTaskFeesPaid.plus(event.params.taskFee);

    let protocol = getOrCreateProtocol(event);
    protocol.totalJobs = protocol.totalJobs.plus(ONE);
    protocol.save();
  }
  client.save();
  provider.save();
}
// NOTE: JobFunded is emitted on-chain but intentionally NOT indexed — no info beyond JobCreated (014).

export function handleProviderAccepted(event: ProviderAccepted): void {
  let provider = getOrCreateProvider(event.params.provider, event);
  let id = jobIdToBytes(event.params.jobId);

  let coverage = Coverage.load(id);
  if (coverage == null) {
    coverage = new Coverage(id);
    coverage.job = id;
    coverage.provider = provider.id;
    coverage.amount = event.params.collateral;
    coverage.status = C_LOCKED;
    coverage.coverageDeadline = null;
    coverage.lockedAtBlock = event.block.number;
    coverage.lockedAtTimestamp = event.block.timestamp;
    coverage.save();

    provider.jobsAccepted = provider.jobsAccepted.plus(ONE);
    provider.activeGuaranteeAmount = provider.activeGuaranteeAmount.plus(event.params.collateral);
    provider.totalGuaranteedValue = provider.totalGuaranteedValue.plus(event.params.collateral);

    let movement = new CollateralMovement(eventId(event));
    movement.job = id;
    movement.provider = provider.id;
    movement.kind = K_LOCK;
    movement.amount = event.params.collateral;
    movement.blockNumber = event.block.number;
    movement.timestamp = event.block.timestamp;
    movement.txHash = event.transaction.hash;
    movement.save();
  }

  let job = Job.load(id);
  if (job != null && job.status == FUNDED) {
    job.status = ACCEPTED;
    job.save();
  }
  provider.save();
  materializeRiskSnapshot(provider, event);
}

export function handleDeliverableSubmitted(event: DeliverableSubmitted): void {
  let id = jobIdToBytes(event.params.jobId);
  let job = Job.load(id);
  if (job == null) return;

  let submission = new Submission(eventId(event));
  submission.job = id;
  submission.provider = job.provider;
  submission.submissionCommitment = event.params.submissionCommitment;
  submission.blockNumber = event.block.number;
  submission.timestamp = event.block.timestamp;
  submission.txHash = event.transaction.hash;
  submission.save();

  if (job.status == ACCEPTED) {
    job.submissionCommitment = event.params.submissionCommitment;
    job.status = SUBMITTED;
    job.save();
  }
}

export function handleInitialEvaluationResolved(event: InitialEvaluationResolved): void {
  let id = jobIdToBytes(event.params.jobId);
  let job = Job.load(id);
  if (job == null) return;

  let record = new InitialEvaluation(eventId(event));
  record.job = id;
  record.provider = job.provider;
  record.evaluator = event.params.evaluator;
  record.approved = event.params.approved;
  record.blockNumber = event.block.number;
  record.timestamp = event.block.timestamp;
  record.txHash = event.transaction.hash;
  record.save();

  if (job.status != SUBMITTED) return;

  if (event.params.approved) {
    job.status = INITIALLY_APPROVED;
    if (!job.feeCounted) {
      let provider = Provider.load(job.provider);
      if (provider != null) {
        provider.jobsInitiallyApproved = provider.jobsInitiallyApproved.plus(ONE);
        provider.totalFeesEarned = provider.totalFeesEarned.plus(job.taskFee);
        provider.totalCoveredAmount = provider.totalCoveredAmount.plus(job.taskFee);
        provider.lastActivityTimestamp = event.block.timestamp;
        provider.lastUpdatedBlock = event.block.number;
        provider.save();
        materializeRiskSnapshot(provider, event);
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
  let coverage = Coverage.load(id);
  if (coverage != null) {
    coverage.coverageDeadline = event.params.coverageEnd;
    coverage.save();
  }
}

export function handleClaimOpened(event: ClaimOpened): void {
  let id = jobIdToBytes(event.params.jobId);
  let job = Job.load(id);
  if (job == null) return; // a claim always follows an existing job

  if (Claim.load(id) == null) {
    let client = getOrCreateClient(event.params.client, event);
    client.claimsOpened = client.claimsOpened.plus(ONE);
    client.save();

    let claim = new Claim(id);
    claim.job = id;
    claim.provider = job.provider;
    claim.client = client.id;
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
      provider.lastActivityTimestamp = event.block.timestamp;
      provider.lastUpdatedBlock = event.block.number;
      provider.save();
      materializeRiskSnapshot(provider, event);
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

  // resolvedByTimeout is authoritative on the mutable Claim and is set by handleClaimTimedOut, which
  // the contract emits BEFORE this event in the timeout tx (lines 424-425). Stamp it into the
  // immutable record at construction (plan §3.5.7).
  let byTimeout = claim != null ? claim.resolvedByTimeout : false;

  let record = new ConfidentialEvaluation(eventId(event));
  record.job = id;
  record.covered = event.params.covered;
  record.serviceCredit = event.params.serviceCredit;
  record.resolvedByTimeout = byTimeout;
  record.blockNumber = event.block.number;
  record.timestamp = event.block.timestamp;
  record.txHash = event.transaction.hash;

  if (claim == null) {
    // No claim entity (should not happen); still record the raw verdict for audit.
    record.provider = Bytes.empty();
    record.save();
    return;
  }
  record.provider = claim.provider;
  record.save();

  // Idempotency guard: the job is CLAIM_PENDING only before its (single) resolution — a crash-safe,
  // reference-free "first resolution" signal (avoids a nullable-getter null-check, docs/solutions).
  let job = Job.load(id);
  let firstResolution = job != null && job.status == CLAIM_PENDING;

  claim.covered = event.params.covered;
  claim.serviceCredit = event.params.serviceCredit;
  claim.resolvedAtBlock = event.block.number;
  claim.resolvedAtTimestamp = event.block.timestamp;
  claim.save();

  if (firstResolution && !byTimeout) {
    let provider = Provider.load(claim.provider);
    if (provider != null) {
      if (event.params.covered) {
        provider.claimsUpheld = provider.claimsUpheld.plus(ONE);
        bumpDailyMetric(provider, true, event.params.serviceCredit, event);
      } else {
        provider.claimsRejected = provider.claimsRejected.plus(ONE);
        bumpDailyMetric(provider, false, ZERO, event);
      }
      provider.lastActivityTimestamp = event.block.timestamp;
      provider.lastUpdatedBlock = event.block.number;
      provider.save();
      materializeRiskSnapshot(provider, event);
    }
  }

  // Not covered → back to coverage. Covered → CLAIM_PAID handled in handleGuaranteePaid (same tx).
  if (!event.params.covered && job != null && job.status == CLAIM_PENDING) {
    job.status = INITIALLY_APPROVED;
    job.save();
  }
}

export function handleGuaranteePaid(event: GuaranteePaid): void {
  let id = jobIdToBytes(event.params.jobId);
  let coverage = Coverage.load(id);
  if (coverage == null) return;

  let provider = Provider.load(coverage.provider);
  if (provider == null) return;

  let payout = new GuaranteePayout(eventId(event));
  payout.job = id;
  payout.provider = coverage.provider;
  payout.amount = event.params.amount;
  payout.toClient = event.params.client;
  payout.blockNumber = event.block.number;
  payout.timestamp = event.block.timestamp;
  payout.txHash = event.transaction.hash;
  payout.save();

  // Release exposure once (covered path): set PAID, subtract the STORED coverage amount, no completion
  // count (a paid window is counted via claimsUpheld, not jobsCompleted — finding 007). The later
  // CollateralReleased(remainder) in the same tx then no-ops (coverage no longer LOCKED).
  if (coverage.status == C_LOCKED) {
    coverage.status = C_PAID;
    coverage.save();
    if (provider.activeGuaranteeAmount.ge(coverage.amount)) {
      provider.activeGuaranteeAmount = provider.activeGuaranteeAmount.minus(coverage.amount);
    } else {
      provider.activeGuaranteeAmount = ZERO;
    }
  }

  provider.totalPayoutAmount = provider.totalPayoutAmount.plus(event.params.amount);
  provider.lastActivityTimestamp = event.block.timestamp;
  provider.lastUpdatedBlock = event.block.number;
  provider.save();

  let protocol = getOrCreateProtocol(event);
  protocol.totalGuaranteePaidOut = protocol.totalGuaranteePaidOut.plus(event.params.amount);
  protocol.save();

  let job = Job.load(id);
  if (job != null) {
    job.status = CLAIM_PAID;
    job.save();
  }
  materializeRiskSnapshot(provider, event);
}

export function handleCollateralReleased(event: CollateralReleased): void {
  let id = jobIdToBytes(event.params.jobId);
  // RELEASE_REMAINDER when the coverage was already PAID this tx (covered remainder); RELEASE_CLEAN
  // for a clean withdraw (coverage still LOCKED). releaseExposureIfLocked no-ops on the remainder.
  let coverage = Coverage.load(id);
  let kind = coverage != null && coverage.status == C_LOCKED ? K_RELEASE_CLEAN : K_RELEASE_REMAINDER;

  let job = Job.load(id);
  let movement = new CollateralMovement(eventId(event));
  movement.job = id;
  movement.provider = event.params.provider;
  movement.kind = kind;
  movement.amount = event.params.amount;
  movement.blockNumber = event.block.number;
  movement.timestamp = event.block.timestamp;
  movement.txHash = event.transaction.hash;
  movement.save();

  releaseExposureIfLocked(id, C_RELEASED, true, event);
}

export function handleJobExpired(event: JobExpired): void {
  let id = jobIdToBytes(event.params.jobId);
  let job = Job.load(id);
  if (job != null) {
    job.status = EXPIRED;
    job.save();
  }
  releaseExposureIfLocked(id, C_RELEASED, false, event);
}

export function handleJobCancelled(event: JobCancelled): void {
  let id = jobIdToBytes(event.params.jobId);
  let job = Job.load(id);
  if (job != null) {
    job.status = CANCELLED;
    job.save();
  }
  releaseExposureIfLocked(id, C_RELEASED, false, event);
}

export function handleServiceFeePaid(event: ServiceFeePaid): void {
  let id = jobIdToBytes(event.params.jobId);
  let job = Job.load(id);
  if (job == null) return;
  if (!job.serviceFeeCounted) {
    let provider = Provider.load(job.provider);
    if (provider != null) {
      provider.totalServiceFees = provider.totalServiceFees.plus(event.params.amount);
      provider.lastActivityTimestamp = event.block.timestamp;
      provider.lastUpdatedBlock = event.block.number;
      provider.save();
    }
    job.serviceFeeCounted = true;
    job.save();
  }
}

// resolveClaimTimeout emits ClaimTimedOut (first) + ConfidentialEvaluationResolved(false,0). Mark the
// claim timeout-resolved BEFORE the verdict handler runs so it's excluded from claimsRejected (007).
export function handleClaimTimedOut(event: ClaimTimedOut): void {
  let claim = Claim.load(jobIdToBytes(event.params.jobId));
  if (claim != null) {
    claim.resolvedByTimeout = true;
    claim.save();
  }
}
