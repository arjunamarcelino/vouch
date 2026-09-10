// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {VouchCore} from "../src/VouchCore.sol";

/// @title Deploy
/// @notice Env-driven deployment of VouchCore. NOTHING is hard-coded — all addresses and
///         parameters come from the environment (plan §17.6). Run against Arc testnet:
///
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url arc_testnet --broadcast
///
/// Required env vars (see .env.example):
///   USDC_ADDRESS        6-decimal USDC ERC-20 on the target chain
///   KEYSTONE_FORWARDER  Authorized DON-report transport (forwarder or relay/verifier)
///   COVERAGE_WINDOW     Coverage window duration in seconds
///   FUNDING_WINDOW      Funding window duration in seconds (optional; defaults to 1 day)
///   DEPLOYER_PK         Deployer private key
contract Deploy is Script {
    function run() external returns (VouchCore core) {
        address usdc = vm.envAddress("USDC_ADDRESS");
        address forwarder = vm.envAddress("KEYSTONE_FORWARDER");
        uint64 coverageWindow = uint64(vm.envUint("COVERAGE_WINDOW"));
        uint64 fundingWindow = uint64(vm.envOr("FUNDING_WINDOW", uint256(1 days)));
        uint256 deployerPk = vm.envUint("DEPLOYER_PK");

        vm.startBroadcast(deployerPk);
        core = new VouchCore(usdc, forwarder, coverageWindow, fundingWindow);
        vm.stopBroadcast();

        console2.log("VouchCore deployed at:", address(core));
        console2.log("  usdc:", usdc);
        console2.log("  forwarder:", forwarder);
        console2.log("  coverageWindow:", coverageWindow);
        console2.log("  fundingWindow:", fundingWindow);
    }
}
