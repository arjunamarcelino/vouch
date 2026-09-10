// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AssuranceHub} from "../src/AssuranceHub.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {AssuranceHubConstants} from "./AssuranceHubConstants.sol";

/// @title AssuranceHubBase
/// @notice Shared setUp + CRE report/metadata helpers + a state-machine driver. Actors and
///         economic/workflow/commitment constants come from AssuranceHubConstants (finding 010).
/// @dev Events are re-declared so tests can `emit Foo(...)` inside `vm.expectEmit` blocks.
abstract contract AssuranceHubBase is AssuranceHubConstants {
    AssuranceHub internal hub;
    MockUSDC internal usdc;

    // Re-declared for `vm.expectEmit`. Scope: the lifecycle + money-moving events asserted by the
    // suites. Config events (ClaimTimedOut, FeeRecipientUpdated, Forwarder/ExpectedWorkflow*) are
    // not mirrored here; a test asserting one should declare it locally (finding 015).
    event JobCreated(
        uint256 indexed jobId,
        address indexed client,
        address indexed provider,
        address paymentToken,
        uint256 taskFee,
        uint256 guaranteeAmount,
        uint256 serviceFee,
        uint64 submissionDeadline,
        uint64 coverageDuration,
        bytes32 publicCriteriaHash,
        bytes32 privateCriteriaCommitment
    );
    event JobFunded(uint256 indexed jobId, address indexed client, uint256 amountFunded);
    event ProviderAccepted(uint256 indexed jobId, address indexed provider, uint256 collateral);
    event DeliverableSubmitted(uint256 indexed jobId, address indexed provider, bytes32 submissionCommitment);
    event InitialEvaluationResolved(uint256 indexed jobId, address indexed evaluator, bool approved);
    event CoverageStarted(uint256 indexed jobId, uint64 coverageEnd);
    event ClaimOpened(uint256 indexed jobId, address indexed client, bytes32 evidenceCommitment);
    event ConfidentialEvaluationResolved(uint256 indexed jobId, bool covered, uint256 serviceCredit);
    event GuaranteePaid(uint256 indexed jobId, address indexed client, uint256 amount);
    event CollateralReleased(uint256 indexed jobId, address indexed provider, uint256 amount);
    event JobExpired(
        uint256 indexed jobId, address indexed caller, uint256 refundToClient, uint256 collateralToProvider
    );
    event JobCancelled(
        uint256 indexed jobId, address indexed caller, uint256 refundToClient, uint256 collateralToProvider
    );
    event ServiceFeePaid(uint256 indexed jobId, address indexed feeRecipient, uint256 amount);

    function setUp() public virtual {
        usdc = new MockUSDC();
        hub = new AssuranceHub(
            address(usdc), forwarder, WORKFLOW_ID, WORKFLOW_NAME, workflowOwner, admin, evaluator, feeRecipient
        );
        usdc.mint(client, MINT);
        usdc.mint(provider, MINT);
        vm.prank(client);
        usdc.approve(address(hub), type(uint256).max);
        vm.prank(provider);
        usdc.approve(address(hub), type(uint256).max);
    }

    // ---- CRE report / metadata helpers ---- //

    /// @dev Packed Keystone metadata (§4.2): bytes32 | bytes10 | address == 62 bytes.
    function _metadata(bytes32 id, bytes10 name, address owner) internal pure returns (bytes memory) {
        return abi.encodePacked(id, name, owner);
    }

    function _metadataGood() internal view returns (bytes memory) {
        return _metadata(WORKFLOW_ID, WORKFLOW_NAME, workflowOwner);
    }

    function _report(uint256 jobId, bool covered, uint256 amount) internal view returns (bytes memory) {
        // Domain-bound report (003): chainId + hub prefix the verdict tuple.
        return abi.encode(block.chainid, address(hub), jobId, covered, amount);
    }

    function _onReport(uint256 jobId, bool covered, uint256 amount) internal {
        vm.prank(forwarder);
        hub.onReport(_metadataGood(), _report(jobId, covered, amount));
    }

    // ---- state-machine driver ---- //

    function _openDefaultJob() internal returns (uint256 jobId) {
        vm.prank(client);
        jobId = hub.openJob(
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
    }

    function _driveTo(AssuranceHub.State target) internal returns (uint256 jobId) {
        jobId = _openDefaultJob(); // Funded
        if (target == AssuranceHub.State.Funded) return jobId;

        vm.prank(provider);
        hub.acceptJob(jobId);
        if (target == AssuranceHub.State.AcceptedByProvider) return jobId;

        vm.prank(provider);
        hub.submitDeliverable(jobId, SUBMIT_COMMIT);
        if (target == AssuranceHub.State.Submitted) return jobId;

        vm.prank(evaluator);
        hub.resolveInitialEvaluation(jobId, true);
        if (target == AssuranceHub.State.InitiallyApproved) return jobId;

        vm.prank(client);
        hub.openClaim(jobId, EVIDENCE_COMMIT);
        if (target == AssuranceHub.State.ClaimPending) return jobId;

        revert("driveTo: unsupported target");
    }

    function _assertState(uint256 jobId, AssuranceHub.State s) internal view {
        assertEq(uint256(hub.getJob(jobId).status), uint256(s), "state");
    }

    function _bal() internal view returns (uint256 c, uint256 p, uint256 f, uint256 h) {
        c = usdc.balanceOf(client);
        p = usdc.balanceOf(provider);
        f = usdc.balanceOf(feeRecipient);
        h = usdc.balanceOf(address(hub));
    }
}
