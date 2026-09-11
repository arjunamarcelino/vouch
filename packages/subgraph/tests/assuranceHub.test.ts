import { assert, describe, test, clearStore, beforeEach, afterAll } from "matchstick-as/assembly/index";
import { BigInt, Bytes } from "@graphprotocol/graph-ts";
import {
  handleJobCreated,
  handleProviderAccepted,
  handleDeliverableSubmitted,
  handleInitialEvaluationResolved,
  handleCoverageStarted,
  handleClaimOpened,
  handleConfidentialEvaluationResolved,
  handleClaimTimedOut,
  handleGuaranteePaid,
  handleCollateralReleased,
  handleJobExpired,
  handleJobCancelled,
  handleServiceFeePaid,
} from "../src/mappings/assuranceHub";
import {
  PROVIDER,
  CLIENT,
  jobIdBytes,
  txHash,
  jobCreated,
  providerAccepted,
  deliverableSubmitted,
  initialEvaluationResolved,
  coverageStarted,
  claimOpened,
  confidentialEvaluationResolved,
  claimTimedOut,
  guaranteePaid,
  collateralReleased,
  jobExpired,
  jobCancelled,
  serviceFeePaid,
} from "./helpers";

const P = PROVIDER.toHexString();

// Drive a job to INITIALLY_APPROVED (funded → accepted → submitted → approved + coverage).
function approve(jobId: i32, taskFee: i32, collateral: i32, ts: i32): void {
  handleJobCreated(jobCreated(jobId, taskFee, collateral, 0, txHash(jobId * 100 + 1), 0, 1, ts));
  handleProviderAccepted(providerAccepted(jobId, collateral, txHash(jobId * 100 + 2), 0, 2, ts));
  handleDeliverableSubmitted(deliverableSubmitted(jobId, txHash(jobId * 100 + 3), 0, 3, ts));
  // approval + coverage-start share a tx (distinct logIndex)
  handleInitialEvaluationResolved(
    initialEvaluationResolved(jobId, true, txHash(jobId * 100 + 4), 0, 4, ts),
  );
  handleCoverageStarted(coverageStarted(jobId, ts + 86400, txHash(jobId * 100 + 4), 1, 4, ts));
}

describe("AssuranceHub mappings", () => {
  beforeEach(() => {
    clearStore();
  });
  afterAll(() => {
    clearStore();
  });

  test("handleJobCreated creates Job, Provider, Client, Protocol", () => {
    handleJobCreated(jobCreated(1, 20, 100, 5, txHash(1), 0, 1, 1000));
    assert.entityCount("Job", 1);
    assert.entityCount("Provider", 1);
    assert.entityCount("Client", 1);
    assert.entityCount("Protocol", 1);
    assert.fieldEquals("Job", jobIdBytes(1).toHexString(), "status", "FUNDED");
    assert.fieldEquals("Job", jobIdBytes(1).toHexString(), "taskFee", "20");
    assert.fieldEquals("Client", CLIENT.toHexString(), "jobsCommissioned", "1");
  });

  test("handleProviderAccepted locks coverage, books exposure, logs a LOCK movement", () => {
    handleJobCreated(jobCreated(1, 20, 100, 0, txHash(1), 0, 1, 1000));
    handleProviderAccepted(providerAccepted(1, 100, txHash(2), 0, 2, 1000));
    assert.fieldEquals("Coverage", jobIdBytes(1).toHexString(), "status", "LOCKED");
    assert.fieldEquals("Coverage", jobIdBytes(1).toHexString(), "amount", "100");
    assert.fieldEquals("Provider", P, "jobsAccepted", "1");
    assert.fieldEquals("Provider", P, "activeGuaranteeAmount", "100");
    // totalGuaranteedValue is booked at APPROVAL, not accept (028) — still 0 here.
    assert.fieldEquals("Provider", P, "totalGuaranteedValue", "0");
    assert.entityCount("CollateralMovement", 1);
    assert.fieldEquals("Job", jobIdBytes(1).toHexString(), "status", "ACCEPTED");
  });

  test("idempotent accept: replaying the event does not double-count", () => {
    handleJobCreated(jobCreated(1, 20, 100, 0, txHash(1), 0, 1, 1000));
    handleProviderAccepted(providerAccepted(1, 100, txHash(2), 0, 2, 1000));
    handleProviderAccepted(providerAccepted(1, 100, txHash(2), 0, 2, 1000)); // replay
    assert.fieldEquals("Provider", P, "jobsAccepted", "1");
    assert.fieldEquals("Provider", P, "activeGuaranteeAmount", "100");
    assert.entityCount("Coverage", 1);
  });

  test("initial approval counts covered value + fee and records the verdict", () => {
    approve(1, 20, 100, 1000);
    assert.fieldEquals("Provider", P, "jobsInitiallyApproved", "1");
    assert.fieldEquals("Provider", P, "totalCoveredAmount", "20");
    assert.fieldEquals("Provider", P, "totalFeesEarned", "20");
    // totalGuaranteedValue booked at approval over the same approved-job population (028).
    assert.fieldEquals("Provider", P, "totalGuaranteedValue", "100");
    assert.fieldEquals("Job", jobIdBytes(1).toHexString(), "status", "INITIALLY_APPROVED");
    assert.entityCount("InitialEvaluation", 1);
    assert.fieldEquals("Coverage", jobIdBytes(1).toHexString(), "coverageDeadline", "87400");
  });

  test("clean completion: withdraw counts jobsCompleted, releases exposure", () => {
    approve(1, 20, 100, 1000);
    handleCollateralReleased(collateralReleased(1, 100, txHash(9), 0, 10, 200000));
    assert.fieldEquals("Provider", P, "jobsCompleted", "1");
    assert.fieldEquals("Provider", P, "contestedCompletions", "0");
    assert.fieldEquals("Provider", P, "activeGuaranteeAmount", "0");
    assert.fieldEquals("Job", jobIdBytes(1).toHexString(), "status", "COMPLETED");
    assert.fieldEquals("Coverage", jobIdBytes(1).toHexString(), "status", "RELEASED");
    // a completion closes a window → counts as recent volume, no failure (028)
    const day = PROVIDER.concatI32(200000 / 86400).toHexString();
    assert.fieldEquals("ProviderDailyMetric", day, "closedWindows", "1");
    assert.fieldEquals("ProviderDailyMetric", day, "upheldFailures", "0");
  });

  test("completion materializes a snapshot; hasEnoughHistory needs >= 3 closed windows (011/029)", () => {
    approve(1, 20, 100, 1000);
    let relTx = txHash(9);
    handleCollateralReleased(collateralReleased(1, 100, relTx, 0, 10, 200000));
    assert.fieldEquals("Provider", P, "jobsCompleted", "1");
    assert.fieldEquals("Provider", P, "lastClosedWindows", "1");
    // the completion wrote a snapshot (029) that reflects the new completedJobs...
    let snapId = PROVIDER.concat(relTx).concatI32(0).toHexString();
    assert.fieldEquals("ProviderRiskSnapshot", snapId, "completedJobs", "1");
    // ...and 1 < 3 closed windows → not enough history (011)
    assert.fieldEquals("ProviderRiskSnapshot", snapId, "hasEnoughHistory", "false");
  });

  test("covered claim same-tx burst: no double-subtract, exposure hits zero, upheld counted", () => {
    approve(1, 20, 100, 1000);
    handleClaimOpened(claimOpened(1, txHash(5), 0, 5, 2000));
    // resolveClaim covered → same tx: ConfidentialEvaluationResolved + GuaranteePaid + CollateralReleased(remainder)
    let tx = txHash(6);
    handleConfidentialEvaluationResolved(
      confidentialEvaluationResolved(1, true, 60, tx, 0, 6, 3000, Bytes.fromHexString("0x" + "11".repeat(32)), 2990),
    );
    handleGuaranteePaid(guaranteePaid(1, 60, tx, 1, 6, 3000));
    handleCollateralReleased(collateralReleased(1, 40, tx, 2, 6, 3000));
    assert.entityCount("ConfidentialEvaluation", 1);

    assert.fieldEquals("Provider", P, "claimsUpheld", "1");
    assert.fieldEquals("Provider", P, "claimsRejected", "0");
    assert.fieldEquals("Provider", P, "totalPayoutAmount", "60");
    // 100 locked − 100 stored coverage (once) = 0, NOT negative (would be -40 on a double-subtract)
    assert.fieldEquals("Provider", P, "activeGuaranteeAmount", "0");
    assert.fieldEquals("Provider", P, "jobsCompleted", "0"); // paid window is not a clean completion
    assert.fieldEquals("Job", jobIdBytes(1).toHexString(), "status", "CLAIM_PAID");
    assert.fieldEquals("Coverage", jobIdBytes(1).toHexString(), "status", "PAID");
    assert.entityCount("GuaranteePayout", 1);
    // day-bucket id = provider ++ concatI32(dayId); ts 3000 → dayId 0. A covered payout closes the
    // window: one failure over one unit of recent volume (028).
    assert.fieldEquals("ProviderDailyMetric", PROVIDER.concatI32(0).toHexString(), "upheldFailures", "1");
    assert.fieldEquals("ProviderDailyMetric", PROVIDER.concatI32(0).toHexString(), "closedWindows", "1");
  });

  test("payout accumulation is latched per job — replay does not double-count (020)", () => {
    approve(1, 20, 100, 1000);
    handleClaimOpened(claimOpened(1, txHash(5), 0, 5, 2000));
    let tx = txHash(6);
    handleConfidentialEvaluationResolved(
      confidentialEvaluationResolved(1, true, 60, tx, 0, 6, 3000, Bytes.fromHexString("0x" + "11".repeat(32)), 2990),
    );
    handleGuaranteePaid(guaranteePaid(1, 60, tx, 1, 6, 3000));
    handleGuaranteePaid(guaranteePaid(1, 60, tx, 1, 6, 3000)); // replay same event
    assert.fieldEquals("Provider", P, "totalPayoutAmount", "60");
    assert.fieldEquals("Job", jobIdBytes(1).toHexString(), "payoutCounted", "true");
  });

  test("not-covered verdict counts a rejection, returns to coverage, then contested completion", () => {
    approve(1, 20, 100, 1000);
    handleClaimOpened(claimOpened(1, txHash(5), 0, 5, 2000));
    handleConfidentialEvaluationResolved(
      confidentialEvaluationResolved(1, false, 0, txHash(6), 0, 6, 3000, Bytes.fromHexString("0x" + "22".repeat(32)), 2990),
    );
    assert.fieldEquals("Provider", P, "claimsRejected", "1");
    assert.fieldEquals("Provider", P, "claimsUpheld", "0");
    assert.fieldEquals("Job", jobIdBytes(1).toHexString(), "status", "INITIALLY_APPROVED");
    // later clean withdraw → contested (a claim was opened but not upheld)
    handleCollateralReleased(collateralReleased(1, 100, txHash(9), 0, 10, 200000));
    assert.fieldEquals("Provider", P, "contestedCompletions", "1");
    assert.fieldEquals("Provider", P, "jobsCompleted", "0");
  });

  test("timeout close is excluded from claimsRejected (finding 007)", () => {
    approve(1, 20, 100, 1000);
    handleClaimOpened(claimOpened(1, txHash(5), 0, 5, 2000));
    // resolveClaimTimeout: ClaimTimedOut (first) + ConfidentialEvaluationResolved(false,0) same tx
    let tx = txHash(7);
    handleClaimTimedOut(claimTimedOut(1, tx, 0, 7, 500000));
    // Timeout path: the contract emits bytes32(0) — 32 zero bytes, NOT an empty
    // array — plus block time as the stamp. Mirror the real emitted value. (todo 050)
    handleConfidentialEvaluationResolved(
      confidentialEvaluationResolved(
        1,
        false,
        0,
        tx,
        1,
        7,
        500000,
        Bytes.fromHexString("0x" + "00".repeat(32)),
        500000,
      ),
    );
    assert.fieldEquals("Provider", P, "claimsRejected", "0"); // timeout excluded
    assert.fieldEquals("Claim", jobIdBytes(1).toHexString(), "resolvedByTimeout", "true");
    assert.entityCount("ProviderDailyMetric", 0); // no day-bucket for a timeout
  });

  test("new provider snapshot uses -1 sentinel for undefined ratios (not 0)", () => {
    handleJobCreated(jobCreated(1, 20, 100, 0, txHash(1), 0, 1, 1000));
    handleProviderAccepted(providerAccepted(1, 100, txHash(2), 0, 2, 1000));
    // jobsInitiallyApproved = 0 → claimFrequency & coverage-ratio & payout-ratio undefined
    assert.entityCount("ProviderRiskSnapshot", 1);
    assert.fieldEquals("Provider", P, "lastAverageCoverageRatioBps", "-1");
    assert.fieldEquals("Provider", P, "lastUpheldClaimRateBps", "-1");
  });

  test("expire and cancel release exposure without counting completion", () => {
    handleJobCreated(jobCreated(1, 20, 100, 0, txHash(1), 0, 1, 1000));
    handleProviderAccepted(providerAccepted(1, 100, txHash(2), 0, 2, 1000));
    handleJobExpired(jobExpired(1, txHash(8), 0, 9, 999999));
    assert.fieldEquals("Provider", P, "activeGuaranteeAmount", "0");
    assert.fieldEquals("Provider", P, "jobsCompleted", "0");
    assert.fieldEquals("Job", jobIdBytes(1).toHexString(), "status", "EXPIRED");

    handleJobCancelled(jobCancelled(2, txHash(20), 0, 11, 1000000)); // no job → safe no-op
    assert.entityCount("Job", 1);
  });

  test("service fee accrues once", () => {
    approve(1, 20, 100, 1000);
    handleServiceFeePaid(serviceFeePaid(1, 5, txHash(30), 0, 12, 4000));
    handleServiceFeePaid(serviceFeePaid(1, 5, txHash(30), 0, 12, 4000)); // replay
    assert.fieldEquals("Provider", P, "totalServiceFees", "5");
  });

  test("multiple events in one tx get distinct record ids (no collision)", () => {
    // two submissions for two jobs in the same tx, distinct logIndex
    handleJobCreated(jobCreated(1, 20, 100, 0, txHash(1), 0, 1, 1000));
    handleJobCreated(jobCreated(2, 30, 100, 0, txHash(1), 1, 1, 1000));
    handleProviderAccepted(providerAccepted(1, 100, txHash(2), 0, 2, 1000));
    handleProviderAccepted(providerAccepted(2, 100, txHash(2), 1, 2, 1000));
    handleDeliverableSubmitted(deliverableSubmitted(1, txHash(3), 0, 3, 1000));
    handleDeliverableSubmitted(deliverableSubmitted(2, txHash(3), 1, 3, 1000));
    assert.entityCount("Submission", 2);
    assert.entityCount("CollateralMovement", 2);
  });
});
