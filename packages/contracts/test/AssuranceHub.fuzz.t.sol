// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AssuranceHubBase} from "./AssuranceHubBase.sol";
import {AssuranceHub} from "../src/AssuranceHub.sol";

/// @title AssuranceHubFuzzTest
/// @notice Bounded fuzz: payout <= cap and full monetary conservation (incl. service fee).
contract AssuranceHubFuzzTest is AssuranceHubBase {
    function _openToClaim(uint256 taskFee, uint256 guarantee, uint256 serviceFee) internal returns (uint256 jobId) {
        vm.prank(client);
        jobId = hub.openJob(
            provider,
            address(usdc),
            taskFee,
            guarantee,
            serviceFee,
            uint64(block.timestamp) + SUBMIT_WINDOW,
            COVERAGE_DURATION,
            PUBLIC_HASH,
            PRIVATE_COMMIT
        );
        vm.prank(provider);
        hub.acceptJob(jobId);
        vm.prank(provider);
        hub.submitDeliverable(jobId, SUBMIT_COMMIT);
        vm.prank(evaluator);
        hub.resolveInitialEvaluation(jobId, true);
        vm.prank(client);
        hub.openClaim(jobId, EVIDENCE_COMMIT);
    }

    function testFuzz_PayoutNeverExceedsCap(
        uint256 taskFeeRaw,
        uint256 guaranteeRaw,
        uint256 serviceFeeRaw,
        uint256 creditRaw
    ) public {
        uint256 taskFee = bound(taskFeeRaw, 1e6, 100_000e6);
        uint256 guarantee = bound(guaranteeRaw, 1e6, 100_000e6);
        uint256 serviceFee = bound(serviceFeeRaw, 0, 100_000e6);
        uint256 credit = bound(creditRaw, 1, guarantee); // CRE credit within the cap

        uint256 jobId = _openToClaim(taskFee, guarantee, serviceFee);
        uint256 clientBefore = usdc.balanceOf(client);
        _onReport(jobId, true, credit);

        uint256 paid = usdc.balanceOf(client) - clientBefore;
        assertLe(paid, guarantee, "payout <= cap");
        assertEq(paid, credit, "payout == credit");
        assertEq(usdc.balanceOf(address(hub)), 0, "hub drained");
        assertEq(hub.totalLiabilities(), 0, "liab cleared");
    }

    function testFuzz_Conservation_CoveredClaim(uint256 taskFeeRaw, uint256 guaranteeRaw, uint256 serviceFeeRaw)
        public
    {
        uint256 taskFee = bound(taskFeeRaw, 1e6, 100_000e6);
        uint256 guarantee = bound(guaranteeRaw, 1e6, 100_000e6);
        uint256 serviceFee = bound(serviceFeeRaw, 0, 100_000e6);
        uint256 supply = usdc.totalSupply();

        uint256 jobId = _openToClaim(taskFee, guarantee, serviceFee);
        _onReport(jobId, true, guarantee);

        uint256 out = usdc.balanceOf(client) + usdc.balanceOf(provider) + usdc.balanceOf(feeRecipient);
        assertEq(out, supply, "sum-out == sum-in");
        assertEq(usdc.balanceOf(address(hub)), 0, "hub drains");
        assertEq(usdc.balanceOf(feeRecipient), serviceFee, "fee exact");
        assertEq(usdc.balanceOf(client), MINT - taskFee - serviceFee + guarantee, "client exact");
        assertEq(usdc.balanceOf(provider), MINT - guarantee + taskFee, "provider exact");
    }

    function testFuzz_Conservation_CleanExit(uint256 taskFeeRaw, uint256 guaranteeRaw, uint256 serviceFeeRaw) public {
        uint256 taskFee = bound(taskFeeRaw, 1e6, 100_000e6);
        uint256 guarantee = bound(guaranteeRaw, 1e6, 100_000e6);
        uint256 serviceFee = bound(serviceFeeRaw, 0, 100_000e6);

        vm.prank(client);
        uint256 jobId = hub.openJob(
            provider,
            address(usdc),
            taskFee,
            guarantee,
            serviceFee,
            uint64(block.timestamp) + SUBMIT_WINDOW,
            COVERAGE_DURATION,
            PUBLIC_HASH,
            PRIVATE_COMMIT
        );
        vm.prank(provider);
        hub.acceptJob(jobId);
        vm.prank(provider);
        hub.submitDeliverable(jobId, SUBMIT_COMMIT);
        vm.prank(evaluator);
        hub.resolveInitialEvaluation(jobId, true);
        vm.warp(uint256(hub.getJob(jobId).coverageEnd) + 1);
        vm.prank(provider);
        hub.withdrawCollateral(jobId);

        assertEq(usdc.balanceOf(address(hub)), 0, "hub drains");
        assertEq(hub.totalLiabilities(), 0, "liab cleared");
        assertEq(usdc.balanceOf(client), MINT - taskFee - serviceFee, "client exact");
        assertEq(usdc.balanceOf(provider), MINT + taskFee, "provider exact");
        assertEq(usdc.balanceOf(feeRecipient), serviceFee, "fee exact");
    }
}
