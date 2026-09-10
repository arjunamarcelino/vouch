// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AssuranceHub} from "../src/AssuranceHub.sol";
import {ReentrantUSDC} from "./mocks/ReentrantUSDC.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AssuranceHubConstants} from "./AssuranceHubConstants.sol";

/// @title AssuranceHubReentrancyTest
/// @notice Arms ReentrantUSDC on each outbound transfer path and asserts the guard trips.
/// @dev Shares actors + constants with the main suite via AssuranceHubConstants (finding 010);
///      only the token (ReentrantUSDC) and setUp differ.
contract AssuranceHubReentrancyTest is AssuranceHubConstants {
    AssuranceHub internal hub;
    ReentrantUSDC internal evil;

    bytes32 internal constant H = keccak256("h");

    function setUp() public {
        evil = new ReentrantUSDC();
        hub = new AssuranceHub(
            address(evil), forwarder, WORKFLOW_ID, WORKFLOW_NAME, workflowOwner, admin, evaluator, feeRecipient
        );
        evil.mint(client, MINT);
        evil.mint(provider, MINT);
        vm.prank(client);
        evil.approve(address(hub), type(uint256).max);
        vm.prank(provider);
        evil.approve(address(hub), type(uint256).max);
    }

    function _toApproved() internal returns (uint256 jobId) {
        vm.prank(client);
        jobId = hub.openJob(
            provider,
            address(evil),
            TASK_FEE,
            GUARANTEE,
            SERVICE_FEE,
            uint64(block.timestamp) + SUBMIT_WINDOW,
            COVERAGE_DURATION,
            H,
            H
        );
        vm.prank(provider);
        hub.acceptJob(jobId);
        vm.prank(provider);
        hub.submitDeliverable(jobId, H);
        vm.prank(evaluator);
        hub.resolveInitialEvaluation(jobId, true);
    }

    function _expectGuard() internal {
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
    }

    function test_Reentrancy_OnReportPayout() public {
        uint256 jobId = _toApproved();
        vm.prank(client);
        hub.openClaim(jobId, H);
        evil.arm(address(hub), abi.encodeCall(hub.withdrawCollateral, (jobId)));
        vm.prank(forwarder);
        _expectGuard();
        hub.onReport(
            abi.encodePacked(WORKFLOW_ID, WORKFLOW_NAME, workflowOwner),
            abi.encode(
                block.chainid, address(hub), jobId, true, GUARANTEE, keccak256("evidence"), uint64(block.timestamp)
            )
        );
    }

    function test_Reentrancy_WithdrawCollateral() public {
        uint256 jobId = _toApproved();
        vm.warp(uint256(hub.getJob(jobId).coverageEnd) + 1);
        evil.arm(address(hub), abi.encodeCall(hub.withdrawCollateral, (jobId)));
        vm.prank(provider);
        _expectGuard();
        hub.withdrawCollateral(jobId);
    }

    function test_Reentrancy_CancelJob() public {
        vm.prank(client);
        uint256 jobId = hub.openJob(
            provider,
            address(evil),
            TASK_FEE,
            GUARANTEE,
            SERVICE_FEE,
            uint64(block.timestamp) + SUBMIT_WINDOW,
            COVERAGE_DURATION,
            H,
            H
        );
        evil.arm(address(hub), abi.encodeCall(hub.cancelJob, (jobId)));
        vm.prank(client);
        _expectGuard();
        hub.cancelJob(jobId);
    }

    function test_Reentrancy_ExpireJob() public {
        vm.prank(client);
        uint256 jobId = hub.openJob(
            provider,
            address(evil),
            TASK_FEE,
            GUARANTEE,
            SERVICE_FEE,
            uint64(block.timestamp) + SUBMIT_WINDOW,
            COVERAGE_DURATION,
            H,
            H
        );
        vm.prank(provider);
        hub.acceptJob(jobId);
        vm.warp(uint256(hub.getJob(jobId).submissionDeadline) + 1);
        evil.arm(address(hub), abi.encodeCall(hub.expireJob, (jobId)));
        _expectGuard();
        hub.expireJob(jobId);
    }

    function test_Reentrancy_ResolveInitialReject() public {
        vm.prank(client);
        uint256 jobId = hub.openJob(
            provider,
            address(evil),
            TASK_FEE,
            GUARANTEE,
            SERVICE_FEE,
            uint64(block.timestamp) + SUBMIT_WINDOW,
            COVERAGE_DURATION,
            H,
            H
        );
        vm.prank(provider);
        hub.acceptJob(jobId);
        vm.prank(provider);
        hub.submitDeliverable(jobId, H);
        evil.arm(address(hub), abi.encodeCall(hub.expireJob, (jobId)));
        vm.prank(evaluator);
        _expectGuard();
        hub.resolveInitialEvaluation(jobId, false);
    }
}
