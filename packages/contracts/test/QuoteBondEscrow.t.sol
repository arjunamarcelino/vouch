// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {QuoteBondEscrow} from "../src/QuoteBondEscrow.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {ReentrantUSDC} from "./mocks/ReentrantUSDC.sol";

contract QuoteBondEscrowTest is Test {
    QuoteBondEscrow internal escrow;
    MockUSDC internal usdc;

    address internal admin = makeAddr("admin");
    address internal protocol = makeAddr("protocol");
    address internal agent = makeAddr("agent"); // the quote signer / bond poster
    address internal slashSink = makeAddr("slashSink");
    address internal attacker = makeAddr("attacker");

    bytes32 internal constant QID = keccak256("quote-1");
    uint256 internal constant BOND = 1_000_000; // 1 USDC (6-dec)

    // Cache the role: reading protocolRole inline as a call argument would consume the
    // preceding vm.prank (documented repo gotcha: foundry-expectrevert-prank-consumed-by-argument).
    bytes32 internal protocolRole;

    function setUp() public {
        usdc = new MockUSDC();
        escrow = new QuoteBondEscrow(usdc, admin, slashSink);
        protocolRole = escrow.PROTOCOL_ROLE();
        vm.prank(admin);
        escrow.grantRole(protocolRole, protocol);

        usdc.mint(agent, 10_000_000);
        vm.prank(agent);
        usdc.approve(address(escrow), type(uint256).max);
    }

    function _post(bytes32 qid) internal {
        vm.prank(agent);
        escrow.postBond(qid, BOND, uint64(block.timestamp + 1 days));
    }

    function test_PostBond_EscrowsAndStores() public {
        _post(QID);
        assertEq(usdc.balanceOf(address(escrow)), BOND);
        (address poster, uint256 amount,) = escrow.bonds(QID);
        assertEq(poster, agent);
        assertEq(amount, BOND);
    }

    function test_PostBond_RevertsOnDuplicateQuoteId() public {
        _post(QID);
        vm.prank(agent);
        vm.expectRevert(QuoteBondEscrow.BondExists.selector);
        escrow.postBond(QID, BOND, uint64(block.timestamp + 1 days));
    }

    function test_PostBond_RevertsOnZeroAmount() public {
        vm.prank(agent);
        vm.expectRevert(QuoteBondEscrow.ZeroAmount.selector);
        escrow.postBond(QID, 0, uint64(block.timestamp + 1 days));
    }

    function test_PostBond_RevertsOnPastExpiry() public {
        vm.prank(agent);
        vm.expectRevert(QuoteBondEscrow.InvalidExpiry.selector);
        escrow.postBond(QID, BOND, uint64(block.timestamp));
    }

    function test_RefundBond_RevertsBeforeExpiry() public {
        _post(QID);
        vm.expectRevert(QuoteBondEscrow.NotExpired.selector);
        escrow.refundBond(QID);
    }

    function test_RefundBond_PaysPosterAfterExpiry_Permissionless() public {
        _post(QID);
        vm.warp(block.timestamp + 1 days + 1);
        uint256 before = usdc.balanceOf(agent);
        vm.prank(attacker); // permissionless caller...
        escrow.refundBond(QID);
        assertEq(usdc.balanceOf(agent), before + BOND); // ...but funds go to the recorded poster
        (, uint256 amount,) = escrow.bonds(QID);
        assertEq(amount, 0); // cleared
    }

    function test_RefundBond_RevertsOnUnknown() public {
        vm.warp(block.timestamp + 2 days);
        vm.expectRevert(QuoteBondEscrow.BondNotFound.selector);
        escrow.refundBond(keccak256("nope"));
    }

    function test_ReleaseBond_ByProtocol_PaysPoster() public {
        _post(QID);
        uint256 before = usdc.balanceOf(agent);
        vm.prank(protocol);
        escrow.releaseBond(QID); // early return, before expiry
        assertEq(usdc.balanceOf(agent), before + BOND);
    }

    function test_ReleaseBond_ByNonProtocol_Reverts() public {
        _post(QID);
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, attacker, protocolRole
            )
        );
        escrow.releaseBond(QID);
    }

    function test_ConsumeBond_ByProtocol_PaysSlashSink() public {
        _post(QID);
        vm.prank(protocol);
        escrow.consumeBond(QID);
        assertEq(usdc.balanceOf(slashSink), BOND);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_ConsumeBond_ByNonProtocol_Reverts() public {
        _post(QID);
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, attacker, protocolRole
            )
        );
        escrow.consumeBond(QID);
    }

    function test_Reentrancy_RefundGuarded() public {
        ReentrantUSDC evil = new ReentrantUSDC();
        QuoteBondEscrow e = new QuoteBondEscrow(evil, admin, slashSink);
        evil.mint(agent, 10_000_000);
        vm.prank(agent);
        evil.approve(address(e), type(uint256).max);
        vm.prank(agent);
        e.postBond(QID, BOND, uint64(block.timestamp + 1 days));

        // Arm a re-entry into refundBond on the outbound transfer leg; the guard must trip.
        evil.arm(address(e), abi.encodeWithSelector(QuoteBondEscrow.refundBond.selector, QID));
        vm.warp(block.timestamp + 1 days + 1);
        vm.expectRevert();
        e.refundBond(QID);
    }
}
