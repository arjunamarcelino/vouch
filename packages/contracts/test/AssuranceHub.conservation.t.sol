// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AssuranceHubBase} from "./AssuranceHubBase.sol";
import {AssuranceHub} from "../src/AssuranceHub.sol";

/// @title AssuranceHubConservationTest
/// @notice End-to-end money-CONSERVATION checks across the three canonical demo scenarios
///         (covered claim / no claim / rejected claim), asserted with EQUALITY (not the fuzz
///         invariant's `>=`). Added by the "verify end-to-end assurance lifecycle" pass
///         (plan §C1 / data-integrity review P0-3). Reserved file name (`*.conservation.t.sol`)
///         so it never collides with the per-track suites.
/// @dev Total USDC in the system is fixed at `2 * MINT` (client + provider each minted `MINT`;
///      feeRecipient and hub start at 0). Every terminal state must (a) leave the hub holding 0,
///      (b) drive `totalLiabilities()` to 0, and (c) conserve the global total — no USDC created
///      or destroyed, and the client made whole / the provider not double-charged.
contract AssuranceHubConservationTest is AssuranceHubBase {
    uint256 internal constant TOTAL = 2 * MINT;

    /// @dev Sum of every USDC-holding actor in the system + the hub. Must always equal `TOTAL`.
    function _systemTotal() internal view returns (uint256) {
        (uint256 c, uint256 p, uint256 f, uint256 h) = _bal();
        return c + p + f + h;
    }

    function _assertFullySettled(uint256 jobId, AssuranceHub.State expected) internal view {
        _assertState(jobId, expected);
        assertEq(hub.totalLiabilities(), 0, "totalLiabilities != 0 at terminal");
        (,,, uint256 h) = _bal();
        assertEq(h, 0, "hub still holds USDC at terminal");
        assertEq(_systemTotal(), TOTAL, "USDC not conserved (created/destroyed)");
    }

    /// Scenario 1 — covered claim: client is made whole via the guarantee service credit.
    function test_Conservation_CoveredClaim() public {
        assertEq(_systemTotal(), TOTAL, "precondition: system total");
        uint256 jobId = _driveTo(AssuranceHub.State.ClaimPending);

        // Covered verdict pays the full guarantee as a service credit to the client.
        _onReport(jobId, true, GUARANTEE);

        _assertFullySettled(jobId, AssuranceHub.State.ClaimPaid);

        (uint256 c, uint256 p, uint256 f,) = _bal();
        // Client: escrowed taskFee+serviceFee, received the guarantee service credit.
        assertEq(c, MINT - FUNDED + GUARANTEE, "client net (covered)");
        // Provider: locked collateral (all went to the client), received the taskFee on approval.
        assertEq(p, MINT - GUARANTEE + TASK_FEE, "provider net (covered)");
        // Fee recipient: exactly one service fee.
        assertEq(f, SERVICE_FEE, "feeRecipient (covered)");
    }

    /// Scenario 2 — no claim: coverage expires, collateral returns to the provider.
    function test_Conservation_NoClaim() public {
        assertEq(_systemTotal(), TOTAL, "precondition: system total");
        uint256 jobId = _driveTo(AssuranceHub.State.InitiallyApproved);

        // Coverage window elapses with no claim; provider withdraws the collateral.
        vm.warp(block.timestamp + COVERAGE_DURATION + 1);
        vm.prank(provider);
        hub.withdrawCollateral(jobId);

        _assertFullySettled(jobId, AssuranceHub.State.Completed);

        (uint256 c, uint256 p, uint256 f,) = _bal();
        assertEq(c, MINT - FUNDED, "client net (no claim)");
        assertEq(p, MINT + TASK_FEE, "provider net (no claim: collateral returned)");
        assertEq(f, SERVICE_FEE, "feeRecipient (no claim)");
    }

    /// Scenario 3 — rejected claim: confidential verdict finds no covered failure; no funds move,
    /// job returns to InitiallyApproved, then collateral returns to the provider after coverage.
    function test_Conservation_RejectedClaim() public {
        uint256 jobId = _driveTo(AssuranceHub.State.ClaimPending);

        // Snapshot balances immediately before the verdict: a rejection must move NO funds.
        (uint256 c0, uint256 p0, uint256 f0, uint256 h0) = _bal();
        _onReport(jobId, false, 0);
        _assertState(jobId, AssuranceHub.State.InitiallyApproved);
        (uint256 c1, uint256 p1, uint256 f1, uint256 h1) = _bal();
        assertEq(c1, c0, "rejected claim moved client funds");
        assertEq(p1, p0, "rejected claim moved provider funds");
        assertEq(f1, f0, "rejected claim moved fee funds");
        assertEq(h1, h0, "rejected claim moved hub funds");

        // Coverage then expires cleanly and the provider recovers the collateral.
        vm.warp(block.timestamp + COVERAGE_DURATION + 1);
        vm.prank(provider);
        hub.withdrawCollateral(jobId);

        _assertFullySettled(jobId, AssuranceHub.State.Completed);
        (uint256 c, uint256 p, uint256 f,) = _bal();
        assertEq(c, MINT - FUNDED, "client net (rejected)");
        assertEq(p, MINT + TASK_FEE, "provider net (rejected: collateral returned)");
        assertEq(f, SERVICE_FEE, "feeRecipient (rejected)");
    }
}
