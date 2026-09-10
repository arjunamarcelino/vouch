// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AssuranceHubBase} from "./AssuranceHubBase.sol";
import {AssuranceHub} from "../src/AssuranceHub.sol";

/// @title AssuranceHubUnitTest
/// @notice Happy transition coverage: no-claim completion, initial rejection, successful
///         post-completion claim, rejected-claim -> provider withdraws, timeout, exits.
contract AssuranceHubUnitTest is AssuranceHubBase {
    function test_HappyPath_NoClaim() public {
        vm.expectEmit(true, true, true, true, address(hub));
        emit JobCreated(
            1,
            client,
            provider,
            address(usdc),
            TASK_FEE,
            GUARANTEE,
            SERVICE_FEE,
            uint64(block.timestamp) + SUBMIT_WINDOW,
            COVERAGE_DURATION,
            PUBLIC_HASH,
            PRIVATE_COMMIT
        );
        vm.expectEmit(true, true, false, true, address(hub));
        emit JobFunded(1, client, FUNDED);
        uint256 jobId = _openDefaultJob();

        _assertState(jobId, AssuranceHub.State.Funded);
        assertEq(hub.totalLiabilities(), FUNDED, "liab after fund");
        assertEq(usdc.balanceOf(address(hub)), FUNDED, "hub holds fund");

        vm.expectEmit(true, true, false, true, address(hub));
        emit ProviderAccepted(jobId, provider, GUARANTEE);
        vm.prank(provider);
        hub.acceptJob(jobId);
        assertEq(hub.totalLiabilities(), FUNDED + GUARANTEE, "liab after accept");

        vm.prank(provider);
        hub.submitDeliverable(jobId, SUBMIT_COMMIT);
        _assertState(jobId, AssuranceHub.State.Submitted);

        uint64 coverageEnd = uint64(block.timestamp) + COVERAGE_DURATION;
        // Contract emits in this order: InitialEvaluationResolved, CoverageStarted, ServiceFeePaid.
        vm.expectEmit(true, true, false, true, address(hub));
        emit InitialEvaluationResolved(jobId, evaluator, true);
        vm.expectEmit(true, false, false, true, address(hub));
        emit CoverageStarted(jobId, coverageEnd);
        vm.expectEmit(true, true, false, true, address(hub));
        emit ServiceFeePaid(jobId, feeRecipient, SERVICE_FEE);
        vm.prank(evaluator);
        hub.resolveInitialEvaluation(jobId, true);

        _assertState(jobId, AssuranceHub.State.InitiallyApproved);
        assertEq(hub.getJob(jobId).coverageEnd, coverageEnd, "coverageEnd");
        assertEq(hub.totalLiabilities(), GUARANTEE, "only collateral owed");
        assertEq(usdc.balanceOf(provider), MINT - GUARANTEE + TASK_FEE, "provider got taskFee");
        assertEq(usdc.balanceOf(feeRecipient), SERVICE_FEE, "fee paid");

        vm.warp(coverageEnd + 1);
        vm.expectEmit(true, true, false, true, address(hub));
        emit CollateralReleased(jobId, provider, GUARANTEE);
        vm.prank(provider);
        hub.withdrawCollateral(jobId);

        _assertState(jobId, AssuranceHub.State.Completed);
        assertEq(hub.totalLiabilities(), 0, "liab drained");
        (uint256 c, uint256 p, uint256 f, uint256 h) = _bal();
        assertEq(c, MINT - FUNDED, "client -fund");
        assertEq(p, MINT + TASK_FEE, "provider +taskFee");
        assertEq(f, SERVICE_FEE, "fee");
        assertEq(h, 0, "hub drained");
        assertEq(c + p + f, MINT + MINT, "conservation");
    }

    function test_InitialRejection() public {
        uint256 jobId = _driveTo(AssuranceHub.State.Submitted);
        vm.expectEmit(true, true, false, true, address(hub));
        emit InitialEvaluationResolved(jobId, evaluator, false);
        vm.expectEmit(true, true, false, true, address(hub));
        emit JobCancelled(jobId, evaluator, FUNDED, GUARANTEE);
        vm.prank(evaluator);
        hub.resolveInitialEvaluation(jobId, false);

        _assertState(jobId, AssuranceHub.State.Cancelled);
        assertEq(hub.totalLiabilities(), 0, "liab drained");
        (uint256 c, uint256 p,, uint256 h) = _bal();
        assertEq(c, MINT, "client refunded");
        assertEq(p, MINT, "provider collateral back");
        assertEq(h, 0, "hub drained");
    }

    function test_SuccessfulPostCompletionClaim() public {
        uint256 jobId = _driveTo(AssuranceHub.State.InitiallyApproved);

        vm.expectEmit(true, true, false, true, address(hub));
        emit ClaimOpened(jobId, client, EVIDENCE_COMMIT);
        vm.prank(client);
        hub.openClaim(jobId, EVIDENCE_COMMIT);
        _assertState(jobId, AssuranceHub.State.ClaimPending);

        vm.expectEmit(true, false, false, true, address(hub));
        emit ConfidentialEvaluationResolved(jobId, true, GUARANTEE);
        vm.expectEmit(true, true, false, true, address(hub));
        emit GuaranteePaid(jobId, client, GUARANTEE);
        _onReport(jobId, true, GUARANTEE);

        _assertState(jobId, AssuranceHub.State.ClaimPaid);
        assertTrue(hub.settled(jobId), "settled");
        assertEq(hub.totalLiabilities(), 0, "liab drained");
        (uint256 c, uint256 p, uint256 f, uint256 h) = _bal();
        assertEq(c, MINT - FUNDED + GUARANTEE, "client got credit");
        assertEq(p, MINT - GUARANTEE + TASK_FEE, "provider kept taskFee, lost collateral");
        assertEq(f, SERVICE_FEE, "fee");
        assertEq(h, 0, "hub drained");
    }

    function test_PartialCredit_HonoredAndRemainderToProvider() public {
        uint256 jobId = _driveTo(AssuranceHub.State.ClaimPending);
        uint256 credit = 40e6; // < GUARANTEE
        _onReport(jobId, true, credit);

        _assertState(jobId, AssuranceHub.State.ClaimPaid);
        (uint256 c, uint256 p,, uint256 h) = _bal();
        assertEq(c, MINT - FUNDED + credit, "client got partial credit");
        assertEq(p, MINT - GUARANTEE + TASK_FEE + (GUARANTEE - credit), "provider got remainder");
        assertEq(h, 0, "hub drained");
        assertEq(hub.totalLiabilities(), 0, "liab drained");
    }

    function test_RejectedClaim_ThenProviderWithdraws() public {
        uint256 jobId = _driveTo(AssuranceHub.State.ClaimPending);
        uint64 coverageEnd = hub.getJob(jobId).coverageEnd;

        vm.expectEmit(true, false, false, true, address(hub));
        emit ConfidentialEvaluationResolved(jobId, false, 0);
        _onReport(jobId, false, 0);

        _assertState(jobId, AssuranceHub.State.InitiallyApproved);
        assertFalse(hub.settled(jobId), "not settled");
        assertEq(hub.totalLiabilities(), GUARANTEE, "collateral still owed");

        vm.warp(coverageEnd + 1);
        vm.prank(provider);
        hub.withdrawCollateral(jobId);
        _assertState(jobId, AssuranceHub.State.Completed);
        assertEq(hub.totalLiabilities(), 0, "liab drained");
        assertEq(usdc.balanceOf(provider), MINT + TASK_FEE, "provider recovered collateral + taskFee");
    }

    function test_ClaimPending_ResolutionTimeout_ExitWorks() public {
        uint256 jobId = _driveTo(AssuranceHub.State.ClaimPending);
        uint64 coverageEnd = hub.getJob(jobId).coverageEnd;

        // Before the resolution deadline: reverts.
        vm.expectRevert();
        hub.resolveClaimTimeout(jobId);

        // After it: permissionless timeout returns to InitiallyApproved.
        vm.warp(uint256(hub.getJob(jobId).claimResolutionDeadline) + 1);
        hub.resolveClaimTimeout(jobId);
        _assertState(jobId, AssuranceHub.State.InitiallyApproved);

        // Provider withdraws after coverage.
        if (block.timestamp <= coverageEnd) vm.warp(uint256(coverageEnd) + 1);
        vm.prank(provider);
        hub.withdrawCollateral(jobId);
        _assertState(jobId, AssuranceHub.State.Completed);
        assertEq(hub.totalLiabilities(), 0, "liab drained");
    }

    function test_ExpireJob_RefundsBothParties() public {
        uint256 jobId = _driveTo(AssuranceHub.State.AcceptedByProvider);
        vm.warp(uint256(hub.getJob(jobId).submissionDeadline) + 1);
        vm.expectEmit(true, true, false, true, address(hub));
        emit JobExpired(jobId, attacker, FUNDED, GUARANTEE);
        vm.prank(attacker);
        hub.expireJob(jobId);
        _assertState(jobId, AssuranceHub.State.Expired);
        (uint256 c, uint256 p,, uint256 h) = _bal();
        assertEq(c, MINT, "client refunded");
        assertEq(p, MINT, "provider collateral back");
        assertEq(h, 0, "hub drained");
    }

    function test_CancelJob_Funded_RefundsClient() public {
        uint256 jobId = _driveTo(AssuranceHub.State.Funded);
        vm.expectEmit(true, true, false, true, address(hub));
        emit JobCancelled(jobId, client, FUNDED, 0);
        vm.prank(client);
        hub.cancelJob(jobId);
        _assertState(jobId, AssuranceHub.State.Cancelled);
        assertEq(hub.totalLiabilities(), 0, "liab drained");
        assertEq(usdc.balanceOf(client), MINT, "refunded");
        assertEq(usdc.balanceOf(address(hub)), 0, "hub drained");
    }
}
