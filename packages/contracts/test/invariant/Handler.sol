// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {AssuranceHub} from "../../src/AssuranceHub.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";

/// @title Handler
/// @notice Drives AssuranceHub through valid transitions with bounded actors + ghost accounting.
///         Every action is state-guarded so it is a no-op (never reverts) under fail_on_revert=true.
contract Handler is Test {
    AssuranceHub public hub;
    MockUSDC public usdc;
    address internal immutable forwarder;
    address internal immutable evaluator;
    bytes32 internal immutable workflowId;
    bytes10 internal immutable workflowName;
    address internal immutable workflowOwner;

    address[] internal clients;
    address[] internal providers;

    uint256 internal constant TASK_FEE = 20e6;
    uint256 internal constant GUARANTEE = 100e6;
    uint256 internal constant SERVICE_FEE = 5e6;
    uint256 internal constant FUNDED = TASK_FEE + SERVICE_FEE;
    uint64 internal constant COVERAGE_DURATION = 1 days;
    uint64 internal constant SUBMIT_WINDOW = 2 days;
    bytes32 internal constant H = keccak256("h");

    uint256[] public jobs;

    uint256 public ghost_escrowedIn;
    uint256 public ghost_paidOut;
    uint256 public ghost_liabilities;

    constructor(
        AssuranceHub hub_,
        MockUSDC usdc_,
        address forwarder_,
        address evaluator_,
        bytes32 workflowId_,
        bytes10 workflowName_,
        address workflowOwner_
    ) {
        hub = hub_;
        usdc = usdc_;
        forwarder = forwarder_;
        evaluator = evaluator_;
        workflowId = workflowId_;
        workflowName = workflowName_;
        workflowOwner = workflowOwner_;

        for (uint256 i; i < 3; ++i) {
            address c = makeAddr(string.concat("client", vm.toString(i)));
            address p = makeAddr(string.concat("provider", vm.toString(i)));
            clients.push(c);
            providers.push(p);
            usdc.mint(c, 100_000_000e6);
            usdc.mint(p, 100_000_000e6);
            vm.prank(c);
            usdc.approve(address(hub), type(uint256).max);
            vm.prank(p);
            usdc.approve(address(hub), type(uint256).max);
        }
    }

    function _pick(uint256 seed) internal view returns (uint256) {
        if (jobs.length == 0) return type(uint256).max;
        return jobs[bound(seed, 0, jobs.length - 1)];
    }

    function _st(uint256 jobId) internal view returns (AssuranceHub.State) {
        return hub.getJob(jobId).status;
    }

    function _meta() internal view returns (bytes memory) {
        return abi.encodePacked(workflowId, workflowName, workflowOwner);
    }

    function openJob(uint256 seed) public {
        address c = clients[bound(seed, 0, clients.length - 1)];
        address p = providers[bound(seed >> 8, 0, providers.length - 1)];
        vm.prank(c);
        uint256 jobId = hub.openJob(
            p,
            address(usdc),
            TASK_FEE,
            GUARANTEE,
            SERVICE_FEE,
            uint64(block.timestamp) + SUBMIT_WINDOW,
            COVERAGE_DURATION,
            H,
            H
        );
        jobs.push(jobId);
        ghost_escrowedIn += FUNDED;
        ghost_liabilities += FUNDED;
    }

    function accept(uint256 seed) public {
        uint256 jobId = _pick(seed);
        if (jobId == type(uint256).max || _st(jobId) != AssuranceHub.State.Funded) return;
        vm.prank(hub.getJob(jobId).provider);
        hub.acceptJob(jobId);
        ghost_escrowedIn += GUARANTEE;
        ghost_liabilities += GUARANTEE;
    }

    function submit(uint256 seed) public {
        uint256 jobId = _pick(seed);
        if (jobId == type(uint256).max || _st(jobId) != AssuranceHub.State.AcceptedByProvider) return;
        if (block.timestamp > hub.getJob(jobId).submissionDeadline) return;
        vm.prank(hub.getJob(jobId).provider);
        hub.submitDeliverable(jobId, H);
    }

    function resolveInitial(uint256 seed, bool approved) public {
        uint256 jobId = _pick(seed);
        if (jobId == type(uint256).max || _st(jobId) != AssuranceHub.State.Submitted) return;
        vm.prank(evaluator);
        hub.resolveInitialEvaluation(jobId, approved);
        if (approved) {
            ghost_paidOut += FUNDED;
            ghost_liabilities -= FUNDED;
        } else {
            ghost_paidOut += FUNDED + GUARANTEE;
            ghost_liabilities -= (FUNDED + GUARANTEE);
        }
    }

    function openClaim(uint256 seed) public {
        uint256 jobId = _pick(seed);
        if (jobId == type(uint256).max || _st(jobId) != AssuranceHub.State.InitiallyApproved) return;
        if (block.timestamp > hub.getJob(jobId).coverageEnd) return;
        if (hub.claimFiled(jobId)) return; // latch: one claim per job (post-rejected-claim guard)
        vm.prank(hub.getJob(jobId).client);
        hub.openClaim(jobId, H);
    }

    function report(uint256 seed, bool covered, uint256 amountSeed) public {
        uint256 jobId = _pick(seed);
        if (jobId == type(uint256).max || _st(jobId) != AssuranceHub.State.ClaimPending) return;
        // Fuzz the covered credit across [1, GUARANTEE] so the partial-payout branch
        // (payout to client + remainder to provider) is exercised (finding 006).
        uint256 amount = covered ? bound(amountSeed, 1, GUARANTEE) : 0;
        vm.prank(forwarder);
        hub.onReport(_meta(), abi.encode(block.chainid, address(hub), jobId, covered, amount));
        if (covered) {
            // Total out == payout + remainder == GUARANTEE regardless of the split.
            ghost_paidOut += GUARANTEE;
            ghost_liabilities -= GUARANTEE;
        }
    }

    function resolveTimeout(uint256 seed) public {
        uint256 jobId = _pick(seed);
        if (jobId == type(uint256).max || _st(jobId) != AssuranceHub.State.ClaimPending) return;
        if (block.timestamp <= hub.getJob(jobId).claimResolutionDeadline) return;
        hub.resolveClaimTimeout(jobId); // no funds move; returns to InitiallyApproved
    }

    function withdraw(uint256 seed) public {
        uint256 jobId = _pick(seed);
        if (jobId == type(uint256).max || _st(jobId) != AssuranceHub.State.InitiallyApproved) return;
        if (block.timestamp <= hub.getJob(jobId).coverageEnd) return;
        vm.prank(hub.getJob(jobId).provider);
        hub.withdrawCollateral(jobId);
        ghost_paidOut += GUARANTEE;
        ghost_liabilities -= GUARANTEE;
    }

    function cancel(uint256 seed) public {
        uint256 jobId = _pick(seed);
        if (jobId == type(uint256).max || _st(jobId) != AssuranceHub.State.Funded) return;
        vm.prank(hub.getJob(jobId).client);
        hub.cancelJob(jobId);
        ghost_paidOut += FUNDED;
        ghost_liabilities -= FUNDED;
    }

    function expire(uint256 seed) public {
        uint256 jobId = _pick(seed);
        if (jobId == type(uint256).max) return;
        AssuranceHub.State s = _st(jobId);
        if (s == AssuranceHub.State.AcceptedByProvider) {
            if (block.timestamp <= hub.getJob(jobId).submissionDeadline) return;
        } else if (s == AssuranceHub.State.Submitted) {
            if (block.timestamp <= uint256(hub.getJob(jobId).submissionDeadline) + hub.RESOLUTION_GRACE()) return;
        } else {
            return;
        }
        hub.expireJob(jobId);
        ghost_paidOut += FUNDED + GUARANTEE;
        ghost_liabilities -= (FUNDED + GUARANTEE);
    }

    function warp(uint256 secondsRaw) public {
        vm.warp(block.timestamp + bound(secondsRaw, 1 hours, 3 days));
    }
}
