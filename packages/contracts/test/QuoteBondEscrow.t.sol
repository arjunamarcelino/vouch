// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {QuoteBondEscrow} from "../src/QuoteBondEscrow.sol";
import {Errors} from "../src/libraries/Errors.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {ReentrantUSDC} from "./mocks/ReentrantUSDC.sol";

contract QuoteBondEscrowTest is Test {
    QuoteBondEscrow internal escrow;
    MockUSDC internal usdc;

    address internal agent = makeAddr("agent"); // the quote signer / bond poster
    address internal attacker = makeAddr("attacker");

    bytes32 internal constant QID = keccak256("quote-1");
    uint256 internal constant BOND = 1_000_000; // 1 USDC (6-dec)

    function setUp() public {
        usdc = new MockUSDC();
        escrow = new QuoteBondEscrow(usdc);
        usdc.mint(agent, 10_000_000);
        vm.prank(agent);
        usdc.approve(address(escrow), type(uint256).max);
    }

    function _post(bytes32 qid) internal {
        vm.prank(agent);
        escrow.postBond(qid, BOND, uint64(block.timestamp + 1 days));
    }

    function test_Constructor_RevertsOnZeroToken() public {
        vm.expectRevert(Errors.ZeroAddress.selector);
        new QuoteBondEscrow(MockUSDC(address(0)));
    }

    function test_PostBond_EscrowsAndStores() public {
        _post(QID);
        assertEq(usdc.balanceOf(address(escrow)), BOND);
        (address poster, uint64 expiresAt, uint256 amount) = escrow.bonds(QID);
        assertEq(poster, agent);
        assertEq(amount, BOND);
        assertEq(expiresAt, uint64(block.timestamp + 1 days));
    }

    function test_PostBond_RevertsOnDuplicateQuoteId() public {
        _post(QID);
        vm.prank(agent);
        vm.expectRevert(Errors.BondExists.selector);
        escrow.postBond(QID, BOND, uint64(block.timestamp + 1 days));
    }

    function test_PostBond_RevertsOnZeroAmount() public {
        vm.prank(agent);
        vm.expectRevert(Errors.ZeroAmount.selector);
        escrow.postBond(QID, 0, uint64(block.timestamp + 1 days));
    }

    function test_PostBond_RevertsOnPastExpiry() public {
        vm.prank(agent);
        vm.expectRevert(Errors.InvalidExpiry.selector);
        escrow.postBond(QID, BOND, uint64(block.timestamp));
    }

    function test_RefundBond_RevertsBeforeExpiry() public {
        _post(QID);
        vm.expectRevert(Errors.NotExpiredYet.selector);
        escrow.refundBond(QID);
    }

    function test_RefundBond_PaysPosterAfterExpiry_Permissionless() public {
        _post(QID);
        vm.warp(block.timestamp + 1 days + 1);
        uint256 before = usdc.balanceOf(agent);
        vm.prank(attacker); // permissionless caller...
        escrow.refundBond(QID);
        assertEq(usdc.balanceOf(agent), before + BOND); // ...but funds go to the recorded poster
        (,, uint256 amount) = escrow.bonds(QID);
        assertEq(amount, 0); // cleared
    }

    function test_RefundBond_RevertsOnUnknown() public {
        vm.warp(block.timestamp + 2 days);
        vm.expectRevert(Errors.BondNotFound.selector);
        escrow.refundBond(keccak256("nope"));
    }

    function test_Reentrancy_RefundGuarded() public {
        ReentrantUSDC evil = new ReentrantUSDC();
        QuoteBondEscrow e = new QuoteBondEscrow(evil);
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
