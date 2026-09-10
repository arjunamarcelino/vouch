// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {AssuranceHub} from "../src/AssuranceHub.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// @title AssuranceHubBase
/// @notice Shared setUp + actors + amounts + CRE report/metadata helpers + a state-machine driver.
/// @dev Events are re-declared so tests can `emit Foo(...)` inside `vm.expectEmit` blocks.
abstract contract AssuranceHubBase is Test {
    AssuranceHub internal hub;
    MockUSDC internal usdc;

    address internal admin = makeAddr("admin");
    address internal evaluator = makeAddr("evaluator");
    address internal feeRecipient = makeAddr("feeRecipient");
    address internal forwarder = makeAddr("forwarder");
    address internal workflowOwner = makeAddr("workflowOwner");
    address internal client = makeAddr("client");
    address internal provider = makeAddr("provider");
    address internal attacker = makeAddr("attacker");

    bytes32 internal constant WORKFLOW_ID = keccak256("vouch-assurance-v1");
    bytes10 internal constant WORKFLOW_NAME = bytes10("vouchclaim");

    uint256 internal constant TASK_FEE = 20e6;
    uint256 internal constant GUARANTEE = 100e6;
    uint256 internal constant SERVICE_FEE = 5e6;
    uint256 internal constant FUNDED = TASK_FEE + SERVICE_FEE;
    uint64 internal constant COVERAGE_DURATION = 24 hours;
    uint64 internal constant SUBMIT_WINDOW = 7 days;
    uint256 internal constant MINT = 1_000_000e6;

    bytes32 internal constant PUBLIC_HASH = keccak256("public-criteria");
    bytes32 internal constant PRIVATE_COMMIT = keccak256("private-criteria|salt");
    bytes32 internal constant SUBMIT_COMMIT = keccak256("submission|salt");
    bytes32 internal constant EVIDENCE_COMMIT = keccak256("evidence|salt");

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
