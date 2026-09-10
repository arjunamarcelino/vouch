// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AssuranceHubBase} from "./AssuranceHubBase.sol";
import {AssuranceHub} from "../src/AssuranceHub.sol";
import {Errors} from "../src/libraries/Errors.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @title AssuranceHubNegativeTest
/// @notice Authorization, wrong-state, expiry, replay, pause, and no-admin-can-seize coverage.
contract AssuranceHubNegativeTest is AssuranceHubBase {
    // ---- authorization ---- //

    function test_UnauthorizedEvaluator_Reverts() public {
        uint256 jobId = _driveTo(AssuranceHub.State.Submitted);
        bytes32 evRole = hub.EVALUATOR_ROLE(); // hoist: avoid consuming the prank on an arg call
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, attacker, evRole)
        );
        hub.resolveInitialEvaluation(jobId, true);
    }

    function test_UnauthorizedPause_Reverts() public {
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, attacker, bytes32(0))
        );
        hub.pause();
    }

    function test_UnauthorizedForwarder_Reverts() public {
        uint256 jobId = _driveTo(AssuranceHub.State.ClaimPending);
        vm.prank(attacker);
        vm.expectRevert(Errors.NotForwarder.selector);
        hub.onReport(_metadataGood(), _report(jobId, true, GUARANTEE));
    }

    function test_UnauthorizedWorkflow_Reverts() public {
        uint256 jobId = _driveTo(AssuranceHub.State.ClaimPending);
        vm.prank(forwarder);
        vm.expectRevert(Errors.UnauthorizedWorkflow.selector);
        hub.onReport(_metadata(keccak256("evil"), WORKFLOW_NAME, workflowOwner), _report(jobId, true, GUARANTEE));

        vm.prank(forwarder);
        vm.expectRevert(Errors.UnauthorizedWorkflow.selector);
        hub.onReport(_metadata(WORKFLOW_ID, WORKFLOW_NAME, attacker), _report(jobId, true, GUARANTEE));
    }

    function test_BadMetadata_Reverts() public {
        uint256 jobId = _driveTo(AssuranceHub.State.ClaimPending);
        vm.prank(forwarder);
        vm.expectRevert(Errors.BadMetadata.selector);
        hub.onReport(abi.encodePacked(WORKFLOW_ID), _report(jobId, true, GUARANTEE)); // 32 < 62 bytes
    }

    // ---- input validation ---- //

    function test_InvalidToken_Reverts() public {
        vm.prank(client);
        vm.expectRevert(Errors.InvalidToken.selector);
        hub.openJob(
            provider,
            address(0xBEEF),
            TASK_FEE,
            GUARANTEE,
            SERVICE_FEE,
            uint64(block.timestamp) + SUBMIT_WINDOW,
            COVERAGE_DURATION,
            PUBLIC_HASH,
            PRIVATE_COMMIT
        );
    }

    function test_InvalidAmount_Reverts() public {
        vm.prank(client);
        vm.expectRevert(Errors.ZeroAmount.selector);
        hub.openJob(
            provider,
            address(usdc),
            0,
            GUARANTEE,
            SERVICE_FEE,
            uint64(block.timestamp) + SUBMIT_WINDOW,
            COVERAGE_DURATION,
            PUBLIC_HASH,
            PRIVATE_COMMIT
        );
    }

    function test_SelfDealing_Reverts() public {
        vm.prank(client);
        vm.expectRevert(Errors.SelfDealing.selector);
        hub.openJob(
            client,
            address(usdc),
            TASK_FEE,
            GUARANTEE,
            SERVICE_FEE,
            uint64(block.timestamp) + SUBMIT_WINDOW,
            COVERAGE_DURATION,
            PUBLIC_HASH,
            PRIVATE_COMMIT
        );
    }

    function test_DeadlineInPast_Reverts() public {
        vm.warp(1_000_000);
        vm.prank(client);
        vm.expectRevert(Errors.DeadlineInPast.selector);
        hub.openJob(
            provider,
            address(usdc),
            TASK_FEE,
            GUARANTEE,
            SERVICE_FEE,
            uint64(block.timestamp) - 1,
            COVERAGE_DURATION,
            PUBLIC_HASH,
            PRIVATE_COMMIT
        );
    }

    function test_CoverageTooLong_Reverts() public {
        uint64 tooLong = hub.MAX_COVERAGE() + 1; // hoist: don't consume the prank/expectRevert
        uint64 deadline = uint64(block.timestamp) + SUBMIT_WINDOW;
        vm.prank(client);
        vm.expectRevert(Errors.CoverageTooLong.selector);
        hub.openJob(
            provider, address(usdc), TASK_FEE, GUARANTEE, SERVICE_FEE, deadline, tooLong, PUBLIC_HASH, PRIVATE_COMMIT
        );
    }

    function test_CoverageTooShort_Reverts() public {
        uint64 tooShort = hub.MIN_COVERAGE() - 1;
        uint64 deadline = uint64(block.timestamp) + SUBMIT_WINDOW;
        vm.prank(client);
        vm.expectRevert(Errors.CoverageTooShort.selector);
        hub.openJob(
            provider, address(usdc), TASK_FEE, GUARANTEE, SERVICE_FEE, deadline, tooShort, PUBLIC_HASH, PRIVATE_COMMIT
        );
    }

    // ---- time / window guards ---- //

    function test_ExpiredSubmission_Reverts() public {
        uint256 jobId = _driveTo(AssuranceHub.State.AcceptedByProvider);
        vm.warp(uint256(hub.getJob(jobId).submissionDeadline) + 1);
        vm.prank(provider);
        vm.expectRevert(Errors.SubmissionExpired.selector);
        hub.submitDeliverable(jobId, SUBMIT_COMMIT);
    }

    function test_ClaimOutsideCoverage_Reverts() public {
        uint256 jobId = _driveTo(AssuranceHub.State.InitiallyApproved);
        vm.warp(uint256(hub.getJob(jobId).coverageEnd) + 1);
        vm.prank(client);
        vm.expectRevert(Errors.ClaimWindowClosed.selector);
        hub.openClaim(jobId, EVIDENCE_COMMIT);
    }

    function test_EarlyCollateralWithdrawal_Reverts() public {
        uint256 jobId = _driveTo(AssuranceHub.State.InitiallyApproved);
        vm.prank(provider);
        vm.expectRevert(Errors.CoverageWindowOpen.selector);
        hub.withdrawCollateral(jobId);
    }

    function test_ExpireBeforeDeadline_Reverts() public {
        uint256 jobId = _driveTo(AssuranceHub.State.AcceptedByProvider);
        vm.expectRevert(Errors.NotExpiredYet.selector);
        hub.expireJob(jobId);
    }

    function test_AmountAboveCap_Reverts() public {
        uint256 jobId = _driveTo(AssuranceHub.State.ClaimPending);
        vm.prank(forwarder);
        vm.expectRevert(Errors.AmountAboveCap.selector);
        hub.onReport(_metadataGood(), _report(jobId, true, GUARANTEE + 1));
    }

    // ---- replay / double-settle ---- //

    function test_DuplicatePayout_Reverts() public {
        uint256 jobId = _driveTo(AssuranceHub.State.ClaimPending);
        _onReport(jobId, true, GUARANTEE);
        vm.prank(forwarder);
        vm.expectRevert(Errors.AlreadySettled.selector);
        hub.onReport(_metadataGood(), _report(jobId, true, GUARANTEE));
    }

    function test_ReplayedClaim_Reverts() public {
        // Reject the first claim -> job returns to InitiallyApproved with claimFiled latched.
        uint256 jobId = _driveTo(AssuranceHub.State.ClaimPending);
        _onReport(jobId, false, 0);
        _assertState(jobId, AssuranceHub.State.InitiallyApproved);
        vm.prank(client);
        vm.expectRevert(Errors.ClaimAlreadyFiled.selector);
        hub.openClaim(jobId, EVIDENCE_COMMIT);
    }

    // ---- wrong-state ---- //

    function test_WrongState_AcceptBeforeFund_Reverts() public {
        // No such job; status None -> BadState.
        vm.prank(provider);
        vm.expectRevert(Errors.BadState.selector);
        hub.acceptJob(999);
    }

    function test_WrongState_SubmitBeforeAccept_Reverts() public {
        uint256 jobId = _driveTo(AssuranceHub.State.Funded);
        vm.prank(provider);
        vm.expectRevert(Errors.BadState.selector);
        hub.submitDeliverable(jobId, SUBMIT_COMMIT);
    }

    function test_WrongState_ReportBeforeClaim_Reverts() public {
        uint256 jobId = _driveTo(AssuranceHub.State.InitiallyApproved);
        vm.prank(forwarder);
        vm.expectRevert(Errors.BadState.selector);
        hub.onReport(_metadataGood(), _report(jobId, true, GUARANTEE));
    }

    // ---- pause: entries blocked, exits open ---- //

    function test_Pause_EntryBlocked_ExitsAllowed() public {
        uint256 accepted = _driveTo(AssuranceHub.State.AcceptedByProvider);
        uint256 funded = _driveTo(AssuranceHub.State.Funded);

        vm.prank(admin);
        hub.pause();

        vm.prank(client);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        hub.openJob(
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

        // Exits still work while paused.
        vm.prank(client);
        hub.cancelJob(funded);
        _assertState(funded, AssuranceHub.State.Cancelled);

        vm.warp(uint256(hub.getJob(accepted).submissionDeadline) + 1);
        hub.expireJob(accepted);
        _assertState(accepted, AssuranceHub.State.Expired);
    }

    // A pause must NOT strip a client's earned coverage: openClaim works while paused (finding 001).
    function test_PausedOpenClaim_DoesNotStrandClient() public {
        uint256 jobId = _driveTo(AssuranceHub.State.InitiallyApproved);
        vm.prank(admin);
        hub.pause();
        // Client can still open a claim while paused (non-pausable, accesses earned coverage).
        vm.prank(client);
        hub.openClaim(jobId, EVIDENCE_COMMIT);
        _assertState(jobId, AssuranceHub.State.ClaimPending);
        // And the confidential path can still finalize (also non-pausable).
        _onReport(jobId, true, GUARANTEE);
        _assertState(jobId, AssuranceHub.State.ClaimPaid);
        assertEq(usdc.balanceOf(client), MINT - FUNDED + GUARANTEE, "client paid despite pause");
    }

    function test_UnpauseIsAdminOnly() public {
        vm.prank(admin);
        hub.pause();
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, attacker, bytes32(0))
        );
        hub.unpause();
        vm.prank(admin);
        hub.unpause();
    }

    // ---- §6.6 no admin can seize funds ---- //

    function test_NoAdminCanSeizeFunds() public {
        _driveTo(AssuranceHub.State.AcceptedByProvider);
        (uint256 c0, uint256 p0, uint256 f0, uint256 h0) = _bal();
        uint256 admin0 = usdc.balanceOf(admin);

        vm.startPrank(admin);
        hub.setForwarder(makeAddr("newForwarder"));
        hub.setExpectedWorkflow(keccak256("wf2"), bytes10("wf2name000"), makeAddr("newOwner"));
        hub.setFeeRecipient(makeAddr("newFeeRecipient"));
        hub.grantRole(hub.EVALUATOR_ROLE(), attacker);
        hub.revokeRole(hub.EVALUATOR_ROLE(), attacker);
        hub.pause();
        hub.unpause();
        vm.stopPrank();

        (uint256 c1, uint256 p1, uint256 f1, uint256 h1) = _bal();
        assertEq(c1, c0, "client untouched");
        assertEq(p1, p0, "provider untouched");
        assertEq(f1, f0, "feeRecipient untouched");
        assertEq(h1, h0, "hub untouched");
        assertEq(usdc.balanceOf(admin), admin0, "admin gained nothing");
    }
}
