import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import {
  JobCreated,
  GuaranteeLocked,
  TaskFeeReleased,
  CoverageOpened,
  RegressionProven,
  GuaranteePaid,
  GuaranteeReleased,
} from "../../generated/VouchCore/VouchCore";
import { Provider, Job, Guarantee, Payout } from "../../generated/schema";

// ---------------------------------------------------------------------------
// Counter → canonical event table (plan §17.4 F6). Onchain idempotency does NOT
// protect the subgraph, so Provider counters are only mutated when the dependent
// entity is FIRST created (guarded by *.load(id) == null), or on a one-way status
// transition that cannot fire twice.
//
//   jobsCreated          ← JobCreated        (guard: Job.load == null)
//   guaranteesLocked     ← GuaranteeLocked   (guard: Guarantee.load == null)
//   guaranteesActive +1  ← GuaranteeLocked   (guard: Guarantee.load == null)
//   totalGuaranteedValue ← GuaranteeLocked   (guard: Guarantee.load == null)
//   totalFeesEarned      ← TaskFeeReleased   (guard: !guarantee.taskFeeReleased)
//   regressions          ← GuaranteePaid     (guard: Payout.load == null)
//   totalPaidOut         ← GuaranteePaid     (guard: Payout.load == null)
//   guaranteesActive -1  ← GuaranteePaid / GuaranteeReleased (one-way status guard)
//   jobsCompleted   +1   ← GuaranteePaid / GuaranteeReleased (every window close, E5/E3)
// ---------------------------------------------------------------------------

const ONE = BigInt.fromI32(1);

/** Encode a uint256 jobId as a deterministic Bytes id. */
function jobIdToBytes(jobId: BigInt): Bytes {
  return Bytes.fromByteArray(Bytes.fromBigInt(jobId));
}

/**
 * Load a Provider or create a fresh one with every non-nullable BigInt initialized to 0.
 * (An uninitialized non-nullable BigInt aborts at .save() time.)
 * Always bumps lastUpdatedBlock; caller is responsible for .save().
 */
function getOrCreateProvider(address: Address, block: ethereum.Block): Provider {
  let provider = Provider.load(address);
  if (provider == null) {
    provider = new Provider(address);
    provider.jobsCompleted = BigInt.zero();
    provider.jobsCreated = BigInt.zero();
    provider.guaranteesLocked = BigInt.zero();
    provider.guaranteesActive = BigInt.zero();
    provider.regressions = BigInt.zero();
    provider.totalPaidOut = BigInt.zero();
    provider.totalGuaranteedValue = BigInt.zero();
    provider.totalFeesEarned = BigInt.zero();
    provider.firstSeenBlock = block.number;
  }
  provider.lastUpdatedBlock = block.number;
  return provider as Provider;
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
    job.taskFee = event.params.taskFee;
    job.guaranteeCap = event.params.guaranteeCap;
    job.createdAtBlock = event.block.number;
    job.createdAtTimestamp = event.block.timestamp;
    job.txHash = event.transaction.hash;
    job.save();

    provider.jobsCreated = provider.jobsCreated.plus(ONE);
  }

  provider.save();
}

export function handleGuaranteeLocked(event: GuaranteeLocked): void {
  let provider = getOrCreateProvider(event.params.provider, event.block);
  let id = jobIdToBytes(event.params.jobId);

  let guarantee = Guarantee.load(id);
  if (guarantee == null) {
    guarantee = new Guarantee(id);
    guarantee.job = id;
    guarantee.provider = provider.id;
    guarantee.cap = event.params.guaranteeCap;
    guarantee.collateral = event.params.collateral;
    guarantee.status = "LOCKED";
    guarantee.coverageDeadline = null;
    guarantee.taskFeeReleased = false;
    guarantee.lockedAtBlock = event.block.number;
    guarantee.lockedAtTimestamp = event.block.timestamp;
    guarantee.save();

    provider.guaranteesLocked = provider.guaranteesLocked.plus(ONE);
    provider.guaranteesActive = provider.guaranteesActive.plus(ONE);
    provider.totalGuaranteedValue = provider.totalGuaranteedValue.plus(event.params.guaranteeCap);
  }

  provider.save();
}

export function handleTaskFeeReleased(event: TaskFeeReleased): void {
  let provider = getOrCreateProvider(event.params.provider, event.block);
  let id = jobIdToBytes(event.params.jobId);

  // Guarantee is a precondition for fee release (edge case E2), so it exists here.
  // Count the fee exactly once via the taskFeeReleased flag.
  let guarantee = Guarantee.load(id);
  if (guarantee != null && !guarantee.taskFeeReleased) {
    guarantee.taskFeeReleased = true;
    guarantee.save();

    provider.totalFeesEarned = provider.totalFeesEarned.plus(event.params.amount);
  }

  provider.save();
}

export function handleCoverageOpened(event: CoverageOpened): void {
  let provider = getOrCreateProvider(event.params.provider, event.block);
  let id = jobIdToBytes(event.params.jobId);

  let guarantee = Guarantee.load(id);
  if (guarantee != null) {
    // coverageDeadline is emitted as uint64; graph-ts surfaces it as BigInt.
    guarantee.coverageDeadline = event.params.coverageDeadline;
    guarantee.save();
  }

  provider.save();
}

export function handleRegressionProven(event: RegressionProven): void {
  // Verdict marker only — the payout counters are applied in handleGuaranteePaid,
  // which owns the Payout dependent entity (avoids double counting across the two
  // events that fire in the same settlement transaction).
  let provider = getOrCreateProvider(event.params.provider, event.block);
  let id = jobIdToBytes(event.params.jobId);

  let guarantee = Guarantee.load(id);
  if (guarantee != null) {
    guarantee.status = "PAID";
    guarantee.save();
  }

  provider.save();
}

export function handleGuaranteePaid(event: GuaranteePaid): void {
  // GuaranteePaid carries no provider param — resolve it via the Guarantee.
  let id = jobIdToBytes(event.params.jobId);

  let payout = Payout.load(id);
  if (payout != null) {
    return; // already settled — idempotent no-op (E5)
  }

  let guarantee = Guarantee.load(id);
  if (guarantee == null) {
    return; // cannot attribute a payout without its guarantee
  }

  let provider = Provider.load(guarantee.provider);
  if (provider == null) {
    return;
  }

  payout = new Payout(id);
  payout.job = id;
  payout.provider = guarantee.provider;
  payout.amount = event.params.amount;
  payout.toClient = event.params.client;
  payout.atBlock = event.block.number;
  payout.atTimestamp = event.block.timestamp;
  payout.txHash = event.transaction.hash;
  payout.save();

  guarantee.status = "PAID";
  guarantee.save();

  provider.regressions = provider.regressions.plus(ONE);
  provider.totalPaidOut = provider.totalPaidOut.plus(event.params.amount);
  provider.guaranteesActive = provider.guaranteesActive.minus(ONE);
  provider.jobsCompleted = provider.jobsCompleted.plus(ONE);
  provider.lastUpdatedBlock = event.block.number;
  provider.save();
}

export function handleGuaranteeReleased(event: GuaranteeReleased): void {
  let provider = getOrCreateProvider(event.params.provider, event.block);
  let id = jobIdToBytes(event.params.jobId);

  // Clean-window path (E3). One-way LOCKED → RELEASED transition guards against
  // double counting on reprocess, and is mutually exclusive with the paid path.
  let guarantee = Guarantee.load(id);
  if (guarantee != null && guarantee.status == "LOCKED") {
    guarantee.status = "RELEASED";
    guarantee.save();

    provider.guaranteesActive = provider.guaranteesActive.minus(ONE);
    provider.jobsCompleted = provider.jobsCompleted.plus(ONE);
  }

  provider.save();
}
