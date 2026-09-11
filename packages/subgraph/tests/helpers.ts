import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { newMockEvent } from "matchstick-as/assembly/index";
import {
  JobCreated,
  ProviderAccepted,
  DeliverableSubmitted,
  InitialEvaluationResolved,
  CoverageStarted,
  ClaimOpened,
  ConfidentialEvaluationResolved,
  ClaimTimedOut,
  GuaranteePaid,
  CollateralReleased,
  JobExpired,
  JobCancelled,
  ServiceFeePaid,
} from "../generated/AssuranceHub/AssuranceHub";

// Deterministic fixtures. Two mock events collide unless txHash/logIndex differ (newMockEvent
// defaults are constant), so every factory takes them explicitly (nounsDAO pattern, plan §8).
export const PROVIDER = Address.fromString("0x1111111111111111111111111111111111111111");
export const CLIENT = Address.fromString("0x2222222222222222222222222222222222222222");
export const EVALUATOR = Address.fromString("0x3333333333333333333333333333333333333333");
export const COMMIT_A = Bytes.fromHexString(
  "0x00000000000000000000000000000000000000000000000000000000000000aa",
);
export const COMMIT_B = Bytes.fromHexString(
  "0x00000000000000000000000000000000000000000000000000000000000000bb",
);

export function txHash(n: i32): Bytes {
  // 32-byte hash derived from n (distinct per call → distinct event-record ids).
  let hex = "0x" + n.toString(16).padStart(64, "0");
  return Bytes.fromHexString(hex);
}

// jobId → the little-endian Bytes id the mapping uses (mirror of jobIdToBytes).
export function jobIdBytes(jobId: i32): Bytes {
  return Bytes.fromByteArray(Bytes.fromBigInt(BigInt.fromI32(jobId)));
}

function base<T extends ethereum.Event>(e: T, tx: Bytes, logIndex: i32, block: i32, ts: i32): T {
  e.transaction.hash = tx;
  e.logIndex = BigInt.fromI32(logIndex);
  e.block.number = BigInt.fromI32(block);
  e.block.timestamp = BigInt.fromI32(ts);
  e.parameters = [];
  return e;
}

function pU(name: string, v: BigInt): ethereum.EventParam {
  return new ethereum.EventParam(name, ethereum.Value.fromUnsignedBigInt(v));
}
function pAddr(name: string, v: Address): ethereum.EventParam {
  return new ethereum.EventParam(name, ethereum.Value.fromAddress(v));
}
function pBytes(name: string, v: Bytes): ethereum.EventParam {
  return new ethereum.EventParam(name, ethereum.Value.fromFixedBytes(v));
}
function pBool(name: string, v: boolean): ethereum.EventParam {
  return new ethereum.EventParam(name, ethereum.Value.fromBoolean(v));
}

export function jobCreated(
  jobId: i32,
  taskFee: i32,
  guaranteeAmount: i32,
  serviceFee: i32,
  tx: Bytes,
  logIndex: i32,
  block: i32,
  ts: i32,
): JobCreated {
  let e = base(changetype<JobCreated>(newMockEvent()), tx, logIndex, block, ts);
  e.parameters.push(pU("jobId", BigInt.fromI32(jobId)));
  e.parameters.push(pAddr("client", CLIENT));
  e.parameters.push(pAddr("provider", PROVIDER));
  e.parameters.push(pAddr("paymentToken", CLIENT));
  e.parameters.push(pU("taskFee", BigInt.fromI32(taskFee)));
  e.parameters.push(pU("guaranteeAmount", BigInt.fromI32(guaranteeAmount)));
  e.parameters.push(pU("serviceFee", BigInt.fromI32(serviceFee)));
  e.parameters.push(pU("submissionDeadline", BigInt.fromI32(ts + 1000)));
  e.parameters.push(pU("coverageDuration", BigInt.fromI32(86400)));
  e.parameters.push(pBytes("publicCriteriaHash", COMMIT_A));
  e.parameters.push(pBytes("privateCriteriaCommitment", COMMIT_B));
  return e;
}

export function providerAccepted(
  jobId: i32,
  collateral: i32,
  tx: Bytes,
  logIndex: i32,
  block: i32,
  ts: i32,
): ProviderAccepted {
  let e = base(changetype<ProviderAccepted>(newMockEvent()), tx, logIndex, block, ts);
  e.parameters.push(pU("jobId", BigInt.fromI32(jobId)));
  e.parameters.push(pAddr("provider", PROVIDER));
  e.parameters.push(pU("collateral", BigInt.fromI32(collateral)));
  return e;
}

export function deliverableSubmitted(
  jobId: i32,
  tx: Bytes,
  logIndex: i32,
  block: i32,
  ts: i32,
): DeliverableSubmitted {
  let e = base(changetype<DeliverableSubmitted>(newMockEvent()), tx, logIndex, block, ts);
  e.parameters.push(pU("jobId", BigInt.fromI32(jobId)));
  e.parameters.push(pAddr("provider", PROVIDER));
  e.parameters.push(pBytes("submissionCommitment", COMMIT_A));
  return e;
}

export function initialEvaluationResolved(
  jobId: i32,
  approved: boolean,
  tx: Bytes,
  logIndex: i32,
  block: i32,
  ts: i32,
): InitialEvaluationResolved {
  let e = base(changetype<InitialEvaluationResolved>(newMockEvent()), tx, logIndex, block, ts);
  e.parameters.push(pU("jobId", BigInt.fromI32(jobId)));
  e.parameters.push(pAddr("evaluator", EVALUATOR));
  e.parameters.push(pBool("approved", approved));
  return e;
}

export function coverageStarted(
  jobId: i32,
  coverageEnd: i32,
  tx: Bytes,
  logIndex: i32,
  block: i32,
  ts: i32,
): CoverageStarted {
  let e = base(changetype<CoverageStarted>(newMockEvent()), tx, logIndex, block, ts);
  e.parameters.push(pU("jobId", BigInt.fromI32(jobId)));
  e.parameters.push(pU("coverageEnd", BigInt.fromI32(coverageEnd)));
  return e;
}

export function claimOpened(
  jobId: i32,
  tx: Bytes,
  logIndex: i32,
  block: i32,
  ts: i32,
): ClaimOpened {
  let e = base(changetype<ClaimOpened>(newMockEvent()), tx, logIndex, block, ts);
  e.parameters.push(pU("jobId", BigInt.fromI32(jobId)));
  e.parameters.push(pAddr("client", CLIENT));
  e.parameters.push(pBytes("evidenceCommitment", COMMIT_A));
  return e;
}

export function confidentialEvaluationResolved(
  jobId: i32,
  covered: boolean,
  serviceCredit: i32,
  tx: Bytes,
  logIndex: i32,
  block: i32,
  ts: i32,
  evidenceCommitment: Bytes,
  evaluatedAt: i32,
): ConfidentialEvaluationResolved {
  let e = base(changetype<ConfidentialEvaluationResolved>(newMockEvent()), tx, logIndex, block, ts);
  e.parameters.push(pU("jobId", BigInt.fromI32(jobId)));
  e.parameters.push(pBool("covered", covered));
  e.parameters.push(pU("serviceCredit", BigInt.fromI32(serviceCredit)));
  e.parameters.push(pBytes("evidenceCommitment", evidenceCommitment));
  e.parameters.push(pU("evaluatedAt", BigInt.fromI32(evaluatedAt)));
  return e;
}

export function claimTimedOut(
  jobId: i32,
  tx: Bytes,
  logIndex: i32,
  block: i32,
  ts: i32,
): ClaimTimedOut {
  let e = base(changetype<ClaimTimedOut>(newMockEvent()), tx, logIndex, block, ts);
  e.parameters.push(pU("jobId", BigInt.fromI32(jobId)));
  return e;
}

export function guaranteePaid(
  jobId: i32,
  amount: i32,
  tx: Bytes,
  logIndex: i32,
  block: i32,
  ts: i32,
): GuaranteePaid {
  let e = base(changetype<GuaranteePaid>(newMockEvent()), tx, logIndex, block, ts);
  e.parameters.push(pU("jobId", BigInt.fromI32(jobId)));
  e.parameters.push(pAddr("client", CLIENT));
  e.parameters.push(pU("amount", BigInt.fromI32(amount)));
  return e;
}

export function collateralReleased(
  jobId: i32,
  amount: i32,
  tx: Bytes,
  logIndex: i32,
  block: i32,
  ts: i32,
): CollateralReleased {
  let e = base(changetype<CollateralReleased>(newMockEvent()), tx, logIndex, block, ts);
  e.parameters.push(pU("jobId", BigInt.fromI32(jobId)));
  e.parameters.push(pAddr("provider", PROVIDER));
  e.parameters.push(pU("amount", BigInt.fromI32(amount)));
  return e;
}

export function jobExpired(
  jobId: i32,
  tx: Bytes,
  logIndex: i32,
  block: i32,
  ts: i32,
): JobExpired {
  let e = base(changetype<JobExpired>(newMockEvent()), tx, logIndex, block, ts);
  e.parameters.push(pU("jobId", BigInt.fromI32(jobId)));
  e.parameters.push(pAddr("caller", PROVIDER));
  e.parameters.push(pU("refundToClient", BigInt.fromI32(0)));
  e.parameters.push(pU("collateralToProvider", BigInt.fromI32(0)));
  return e;
}

export function jobCancelled(
  jobId: i32,
  tx: Bytes,
  logIndex: i32,
  block: i32,
  ts: i32,
): JobCancelled {
  let e = base(changetype<JobCancelled>(newMockEvent()), tx, logIndex, block, ts);
  e.parameters.push(pU("jobId", BigInt.fromI32(jobId)));
  e.parameters.push(pAddr("caller", CLIENT));
  e.parameters.push(pU("refundToClient", BigInt.fromI32(0)));
  e.parameters.push(pU("collateralToProvider", BigInt.fromI32(0)));
  return e;
}

export function serviceFeePaid(
  jobId: i32,
  amount: i32,
  tx: Bytes,
  logIndex: i32,
  block: i32,
  ts: i32,
): ServiceFeePaid {
  let e = base(changetype<ServiceFeePaid>(newMockEvent()), tx, logIndex, block, ts);
  e.parameters.push(pU("jobId", BigInt.fromI32(jobId)));
  e.parameters.push(pAddr("feeRecipient", EVALUATOR));
  e.parameters.push(pU("amount", BigInt.fromI32(amount)));
  return e;
}
