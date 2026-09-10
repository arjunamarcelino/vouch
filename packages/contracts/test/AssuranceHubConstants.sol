// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

/// @title AssuranceHubConstants
/// @notice Single source of shared test actors + economic/workflow/commitment constants, inherited
///         by both AssuranceHubBase (MockUSDC) and the reentrancy suite (ReentrantUSDC) so the two
///         cannot drift (finding 010). Token deployment + per-suite helpers stay in each suite.
abstract contract AssuranceHubConstants is Test {
    // ---- actors ----
    address internal admin = makeAddr("admin");
    address internal evaluator = makeAddr("evaluator");
    address internal feeRecipient = makeAddr("feeRecipient");
    address internal forwarder = makeAddr("forwarder");
    address internal workflowOwner = makeAddr("workflowOwner");
    address internal client = makeAddr("client");
    address internal provider = makeAddr("provider");
    address internal attacker = makeAddr("attacker");

    // ---- CRE workflow identity ----
    bytes32 internal constant WORKFLOW_ID = keccak256("vouch-assurance-v1");
    bytes10 internal constant WORKFLOW_NAME = bytes10("vouchclaim");

    // ---- economics (6-dec USDC base units) ----
    uint256 internal constant TASK_FEE = 20e6;
    uint256 internal constant GUARANTEE = 100e6;
    uint256 internal constant SERVICE_FEE = 5e6;
    uint256 internal constant FUNDED = TASK_FEE + SERVICE_FEE;
    uint64 internal constant COVERAGE_DURATION = 24 hours;
    uint64 internal constant SUBMIT_WINDOW = 7 days;
    uint256 internal constant MINT = 1_000_000e6;

    // ---- commitments (bytes32; preimages never touch chain) ----
    bytes32 internal constant PUBLIC_HASH = keccak256("public-criteria");
    bytes32 internal constant PRIVATE_COMMIT = keccak256("private-criteria|salt");
    bytes32 internal constant SUBMIT_COMMIT = keccak256("submission|salt");
    bytes32 internal constant EVIDENCE_COMMIT = keccak256("evidence|salt");
}
