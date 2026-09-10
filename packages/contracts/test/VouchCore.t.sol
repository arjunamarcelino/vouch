// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

import {VouchCore} from "../src/VouchCore.sol";
import {IReceiver} from "../src/interfaces/IReceiver.sol";
import {Errors} from "../src/libraries/Errors.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {ReentrantUSDC} from "./mocks/ReentrantUSDC.sol";

/// @title VouchCoreTest
/// @notice Covers the happy path + edge cases E1–E11 and E8b from the plan (§3.3/§17.6),
///         a cap fuzz test, a conservation assertion, and admin/authorization guards.
contract VouchCoreTest is Test {
    VouchCore internal core;
    MockUSDC internal usdc;

    address internal client = makeAddr("client");
    address internal provider = makeAddr("provider");
    address internal forwarder = makeAddr("forwarder");
    address internal workflowOwner = makeAddr("workflowOwner");
    address internal attacker = makeAddr("attacker");

    bytes32 internal constant WORKFLOW_ID = keccak256("vouch-regression-v1");

    uint256 internal constant TASK_FEE = 20e6; // 20 USDC (6-dec)
    uint256 internal constant CAP = 100e6; // 100 USDC (6-dec)
    uint64 internal constant COVERAGE_WINDOW = 24 hours;
    uint64 internal constant FUNDING_WINDOW = 1 days;
    uint256 internal constant MINT = 1_000_000e6;

    uint256 internal constant JOB = 1;

    function setUp() public {
        usdc = new MockUSDC();
        core = new VouchCore(address(usdc), forwarder, COVERAGE_WINDOW, FUNDING_WINDOW);
        core.setExpectedWorkflow(WORKFLOW_ID, workflowOwner); // owner == this

        usdc.mint(client, MINT);
        usdc.mint(provider, MINT);
        vm.prank(client);
        usdc.approve(address(core), type(uint256).max);
        vm.prank(provider);
        usdc.approve(address(core), type(uint256).max);
    }

    // ------------------------------------------------------------------ //
    //                             Helpers                                //
    // ------------------------------------------------------------------ //

    function _createJob(uint256 jobId, uint256 fee, uint256 cap) internal {
        vm.prank(client);
        core.createJob(jobId, provider, fee, cap);
    }

    function _lock(uint256 jobId) internal {
        vm.prank(provider);
        core.lockGuarantee(jobId);
    }

    function _openCoverage(uint256 jobId) internal {
        core.markPublicTestsPassed(jobId); // owner
        vm.prank(provider);
        core.releaseTaskFee(jobId);
    }

    function _metadata(bytes32 id, address owner) internal pure returns (bytes memory) {
        return abi.encode(id, owner);
    }

    function _report(uint256 jobId, bool regressed, uint256 amount) internal pure returns (bytes memory) {
        return abi.encode(jobId, regressed, amount);
    }

    function _deliver(uint256 jobId, bool regressed, uint256 amount) internal {
        vm.prank(forwarder);
        core.onReport(_metadata(WORKFLOW_ID, workflowOwner), _report(jobId, regressed, amount));
    }

    // ------------------------------------------------------------------ //
    //                            Happy paths                             //
    // ------------------------------------------------------------------ //

    function test_HappyPath_RegressionPaid() public {
        _createJob(JOB, TASK_FEE, CAP);
        _lock(JOB);
        _openCoverage(JOB);

        _deliver(JOB, true, CAP);

        // Client: -taskFee (escrowed) + CAP payout.
        assertEq(usdc.balanceOf(client), MINT - TASK_FEE + CAP, "client balance");
        // Provider: -CAP (locked) + taskFee (released), refund 0.
        assertEq(usdc.balanceOf(provider), MINT - CAP + TASK_FEE, "provider balance");
        // Contract fully drained.
        assertEq(usdc.balanceOf(address(core)), 0, "core drained");
        assertTrue(core.settled(JOB), "settled latch");
    }

    function test_HappyPath_WindowExpiresClean_GuaranteeReleased() public {
        _createJob(JOB, TASK_FEE, CAP);
        _lock(JOB);
        _openCoverage(JOB);

        // E3: window elapses with no covered regression.
        vm.warp(block.timestamp + COVERAGE_WINDOW + 1);
        vm.prank(provider);
        core.releaseGuarantee(JOB);

        // Provider reclaims collateral, keeps released task fee.
        assertEq(usdc.balanceOf(provider), MINT + TASK_FEE, "provider reclaimed");
        assertEq(usdc.balanceOf(client), MINT - TASK_FEE, "client paid only fee");
        assertEq(usdc.balanceOf(address(core)), 0, "core drained");
    }

    // ------------------------------------------------------------------ //
    //                          Edge cases E1–E11                         //
    // ------------------------------------------------------------------ //

    // E1: public tests fail -> task fee not released.
    function test_E1_PublicTestsFail_TaskFeeNotReleased() public {
        _createJob(JOB, TASK_FEE, CAP);
        _lock(JOB);
        vm.prank(provider);
        vm.expectRevert(Errors.TestsNotPassed.selector);
        core.releaseTaskFee(JOB);
    }

    // E2: provider never locks -> coverage cannot open (fee release blocked).
    function test_E2_ReleaseFeeBlockedWithoutGuarantee() public {
        _createJob(JOB, TASK_FEE, CAP);
        // markPublicTestsPassed requires GuaranteeLocked.
        vm.expectRevert(Errors.BadState.selector);
        core.markPublicTestsPassed(JOB);
        // releaseTaskFee blocked without locked guarantee.
        vm.prank(provider);
        vm.expectRevert(Errors.BadState.selector);
        core.releaseTaskFee(JOB);
    }

    // E2 (refund path): unfunded job -> client reclaims fee after funding deadline.
    function test_E2_CancelUnfundedJob_RefundsClient() public {
        _createJob(JOB, TASK_FEE, CAP);
        vm.warp(block.timestamp + FUNDING_WINDOW + 1);
        vm.prank(client);
        core.cancelUnfundedJob(JOB);
        assertEq(usdc.balanceOf(client), MINT, "client fully refunded");
        assertEq(usdc.balanceOf(address(core)), 0, "core drained");
    }

    function test_CancelUnfundedJob_RevertsBeforeDeadline() public {
        _createJob(JOB, TASK_FEE, CAP);
        vm.prank(client);
        vm.expectRevert(Errors.FundingWindowNotElapsed.selector);
        core.cancelUnfundedJob(JOB);
    }

    // E4: regression proven after window closes -> rejected.
    function test_E4_RegressionAfterWindow_Reverts() public {
        _createJob(JOB, TASK_FEE, CAP);
        _lock(JOB);
        _openCoverage(JOB);
        vm.warp(block.timestamp + COVERAGE_WINDOW + 1);
        vm.prank(forwarder);
        vm.expectRevert(Errors.CoverageWindowClosed.selector);
        core.onReport(_metadata(WORKFLOW_ID, workflowOwner), _report(JOB, true, CAP));
    }

    // E5: double payout / replayed report -> idempotency latch.
    function test_E5_DoublePayout_Reverts() public {
        _createJob(JOB, TASK_FEE, CAP);
        _lock(JOB);
        _openCoverage(JOB);
        _deliver(JOB, true, CAP);
        vm.prank(forwarder);
        vm.expectRevert(Errors.AlreadySettled.selector);
        core.onReport(_metadata(WORKFLOW_ID, workflowOwner), _report(JOB, true, CAP));
    }

    // E6: payout is capped at collateral and ignores an inflated report amount.
    function test_E6_PayoutCappedIgnoresReportAmount() public {
        _createJob(JOB, TASK_FEE, CAP);
        _lock(JOB);
        _openCoverage(JOB);
        // Report claims a huge amount; contract must still pay only CAP.
        _deliver(JOB, true, 999_999e6);
        assertEq(usdc.balanceOf(client), MINT - TASK_FEE + CAP, "capped to CAP");
    }

    // E7: provider cannot withdraw collateral mid-window.
    function test_E7_ProviderCannotWithdrawMidWindow() public {
        _createJob(JOB, TASK_FEE, CAP);
        _lock(JOB);
        _openCoverage(JOB);
        vm.prank(provider);
        vm.expectRevert(Errors.CoverageWindowOpen.selector);
        core.releaseGuarantee(JOB);
    }

    // E8: unauthorized caller (not the forwarder) cannot trigger payout.
    function test_E8_UnauthorizedCaller_Reverts() public {
        _createJob(JOB, TASK_FEE, CAP);
        _lock(JOB);
        _openCoverage(JOB);
        vm.prank(attacker);
        vm.expectRevert(Errors.NotForwarder.selector);
        core.onReport(_metadata(WORKFLOW_ID, workflowOwner), _report(JOB, true, CAP));
    }

    // E8b: valid forwarder but wrong workflow identity -> revert.
    function test_E8b_UnauthorizedWorkflow_Reverts() public {
        _createJob(JOB, TASK_FEE, CAP);
        _lock(JOB);
        _openCoverage(JOB);
        // Correct forwarder, WRONG workflow id.
        vm.prank(forwarder);
        vm.expectRevert(Errors.UnauthorizedWorkflow.selector);
        core.onReport(_metadata(keccak256("evil-workflow"), workflowOwner), _report(JOB, true, CAP));

        // Correct forwarder + id, WRONG owner.
        vm.prank(forwarder);
        vm.expectRevert(Errors.UnauthorizedWorkflow.selector);
        core.onReport(_metadata(WORKFLOW_ID, attacker), _report(JOB, true, CAP));
    }

    // E9: inconclusive test -> no report -> window expires clean (provider reclaims).
    function test_E9_NoReport_WindowExpiresClean() public {
        _createJob(JOB, TASK_FEE, CAP);
        _lock(JOB);
        _openCoverage(JOB);
        // No onReport ever arrives.
        vm.warp(block.timestamp + COVERAGE_WINDOW + 1);
        vm.prank(provider);
        core.releaseGuarantee(JOB);
        assertEq(usdc.balanceOf(provider), MINT + TASK_FEE, "provider reclaimed clean");
    }

    // A report that does not prove a regression is rejected.
    function test_ReportWithoutRegression_Reverts() public {
        _createJob(JOB, TASK_FEE, CAP);
        _lock(JOB);
        _openCoverage(JOB);
        vm.prank(forwarder);
        vm.expectRevert(Errors.NoRegressionProven.selector);
        core.onReport(_metadata(WORKFLOW_ID, workflowOwner), _report(JOB, false, 0));
    }

    // E10: all accounting uses the 6-decimal ERC-20 interface.
    function test_E10_SixDecimalAccounting() public view {
        assertEq(usdc.decimals(), 6, "6-dec USDC");
    }

    // E10 / M3: contract is non-payable; native value is rejected.
    function test_NonPayable_RejectsNativeValue() public {
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(core).call{value: 1}("");
        assertFalse(ok, "native value must be rejected");
    }

    // E11: reentrancy on the payout/settlement transfer is blocked by nonReentrant.
    function test_E11_ReentrancyGuardBlocksReentry() public {
        ReentrantUSDC evil = new ReentrantUSDC();
        VouchCore rcore = new VouchCore(address(evil), forwarder, COVERAGE_WINDOW, FUNDING_WINDOW);
        rcore.setExpectedWorkflow(WORKFLOW_ID, workflowOwner);

        evil.mint(client, MINT);
        evil.mint(provider, MINT);
        vm.prank(client);
        evil.approve(address(rcore), type(uint256).max);
        vm.prank(provider);
        evil.approve(address(rcore), type(uint256).max);

        vm.prank(client);
        rcore.createJob(JOB, provider, TASK_FEE, CAP);
        vm.prank(provider);
        rcore.lockGuarantee(JOB);
        rcore.markPublicTestsPassed(JOB);
        vm.prank(provider);
        rcore.releaseTaskFee(JOB);

        vm.warp(block.timestamp + COVERAGE_WINDOW + 1);
        // Arm the token to re-enter releaseGuarantee during its outbound transfer.
        evil.arm(address(rcore), JOB);
        vm.prank(provider);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        rcore.releaseGuarantee(JOB);
    }

    // ------------------------------------------------------------------ //
    //                    Invariants: cap + conservation                  //
    // ------------------------------------------------------------------ //

    /// @notice Fuzz: the payout never exceeds the cap, equals the locked collateral (since
    ///         locked == cap), and conservation holds: paid + refund == lockedAtSettle.
    function testFuzz_PayoutNeverExceedsCap(uint256 capRaw, uint256 feeRaw, uint256 reportAmount) public {
        uint256 cap = bound(capRaw, 1e6, 500_000e6);
        uint256 fee = bound(feeRaw, 1e6, 500_000e6);

        _createJob(JOB, fee, cap);
        _lock(JOB);
        _openCoverage(JOB);

        uint256 lockedAtSettle = core.getJob(JOB).lockedCollateral;
        uint256 clientBefore = usdc.balanceOf(client);
        uint256 providerBefore = usdc.balanceOf(provider);

        // reportAmount is adversarial (may be huge) but must be ignored by the cap.
        _deliver(JOB, true, reportAmount);

        uint256 paid = usdc.balanceOf(client) - clientBefore;
        uint256 refund = usdc.balanceOf(provider) - providerBefore;

        assertLe(paid, cap, "payout <= cap");
        assertEq(paid, cap, "payout == locked cap");
        assertEq(paid + refund, lockedAtSettle, "conservation paid+refund==locked");
        assertEq(usdc.balanceOf(address(core)), 0, "core drained");
    }

    // ------------------------------------------------------------------ //
    //                         Admin / discovery                          //
    // ------------------------------------------------------------------ //

    function test_SupportsInterface() public view {
        assertTrue(core.supportsInterface(type(IReceiver).interfaceId), "IReceiver");
        assertTrue(core.supportsInterface(type(IERC165).interfaceId), "IERC165");
        assertFalse(core.supportsInterface(0xffffffff), "bad id");
    }

    function test_OnlyOwner_Admin() public {
        vm.startPrank(attacker);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, attacker));
        core.setForwarder(attacker);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, attacker));
        core.setExpectedWorkflow(WORKFLOW_ID, attacker);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, attacker));
        core.setCoverageWindow(1);
        vm.stopPrank();
    }

    function test_SetCoverageWindow_DoesNotMoveInFlightDeadline() public {
        _createJob(JOB, TASK_FEE, CAP);
        _lock(JOB);
        _openCoverage(JOB);
        uint64 deadlineBefore = core.getJob(JOB).coverageDeadline;
        core.setCoverageWindow(1 hours);
        assertEq(core.getJob(JOB).coverageDeadline, deadlineBefore, "deadline immutable");
    }

    function test_CreateJob_RejectsDuplicate() public {
        _createJob(JOB, TASK_FEE, CAP);
        vm.prank(client);
        vm.expectRevert(Errors.JobAlreadyExists.selector);
        core.createJob(JOB, provider, TASK_FEE, CAP);
    }

    function test_LockGuarantee_OnlyProvider() public {
        _createJob(JOB, TASK_FEE, CAP);
        vm.prank(attacker);
        vm.expectRevert(Errors.NotProvider.selector);
        core.lockGuarantee(JOB);
    }
}
