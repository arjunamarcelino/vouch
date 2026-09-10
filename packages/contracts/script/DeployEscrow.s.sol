// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {QuoteBondEscrow} from "../src/QuoteBondEscrow.sol";

/// @title DeployEscrow
/// @notice Deploys QuoteBondEscrow to Circle Arc — the refundable per-quote USDC bond the risk agent
///         posts (ADR-008). Reads the USDC address from the environment and FAILS LOUDLY if it is not
///         the canonical Arc predeploy or has no code (mirrors Deploy.s.sol; never guesses an address).
///         Uses the same `ARC_USDC_ADDRESS` / `PRIVATE_KEY` env vars as the AssuranceHub deploy.
contract DeployEscrow is Script {
    /// @dev Canonical Arc USDC predeploy (6-decimal ERC-20 interface). Verified: docs.arc.io.
    address internal constant ARC_USDC = 0x3600000000000000000000000000000000000000;

    function run() external returns (QuoteBondEscrow escrow) {
        address usdc = vm.envAddress("ARC_USDC_ADDRESS");
        uint256 deployerPk = vm.envUint("PRIVATE_KEY");

        // Fail loudly: USDC must be the canonical predeploy WITH code on this RPC/chain.
        require(usdc == ARC_USDC, "ARC_USDC_ADDRESS != canonical Arc USDC predeploy");
        require(usdc.code.length > 0, "ARC_USDC_ADDRESS has no code on this RPC/chain");

        vm.startBroadcast(deployerPk);
        escrow = new QuoteBondEscrow(IERC20(usdc));
        vm.stopBroadcast();

        console2.log("QuoteBondEscrow:", address(escrow));
        console2.log("USDC:", usdc);
    }
}
