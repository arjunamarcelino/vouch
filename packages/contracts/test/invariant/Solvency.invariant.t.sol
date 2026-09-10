// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {AssuranceHub} from "../../src/AssuranceHub.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";
import {Handler} from "./Handler.sol";

/// @title SolvencyInvariantTest
/// @notice §6.7 invariants: assets cover liabilities, conservation, shadow match.
contract SolvencyInvariantTest is StdInvariant, Test {
    AssuranceHub internal hub;
    MockUSDC internal usdc;
    Handler internal handler;

    address internal admin = makeAddr("admin");
    address internal evaluator = makeAddr("evaluator");
    address internal feeRecipient = makeAddr("feeRecipient");
    address internal forwarder = makeAddr("forwarder");
    address internal workflowOwner = makeAddr("workflowOwner");

    bytes32 internal constant WORKFLOW_ID = keccak256("vouch-assurance-v1");
    bytes10 internal constant WORKFLOW_NAME = bytes10("vouchclaim");

    function setUp() public {
        usdc = new MockUSDC();
        hub = new AssuranceHub(
            address(usdc), forwarder, WORKFLOW_ID, WORKFLOW_NAME, workflowOwner, admin, evaluator, feeRecipient
        );
        handler = new Handler(hub, usdc, forwarder, evaluator, WORKFLOW_ID, WORKFLOW_NAME, workflowOwner);

        bytes4[] memory sel = new bytes4[](10);
        sel[0] = Handler.openJob.selector;
        sel[1] = Handler.accept.selector;
        sel[2] = Handler.submit.selector;
        sel[3] = Handler.resolveInitial.selector;
        sel[4] = Handler.openClaim.selector;
        sel[5] = Handler.report.selector;
        sel[6] = Handler.withdraw.selector;
        sel[7] = Handler.cancel.selector;
        sel[8] = Handler.expire.selector;
        sel[9] = Handler.warp.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: sel}));
        targetContract(address(handler));
    }

    function invariant_assetsCoverLiabilities() public view {
        assertGe(usdc.balanceOf(address(hub)), hub.totalLiabilities(), "assets < liabilities");
    }

    function invariant_conservation() public view {
        assertEq(
            usdc.balanceOf(address(hub)), handler.ghost_escrowedIn() - handler.ghost_paidOut(), "balance != in - out"
        );
    }

    function invariant_liabilitiesMatchShadow() public view {
        assertEq(hub.totalLiabilities(), handler.ghost_liabilities(), "liability shadow drift");
    }
}
