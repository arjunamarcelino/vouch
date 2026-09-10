// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {AssuranceHub} from "../src/AssuranceHub.sol";

/// @title Deploy
/// @notice Deploys AssuranceHub to Circle Arc. Reads every address from the environment and
///         FAILS LOUDLY on anything missing or non-canonical — never inserts a guessed address
///         (plan §5 / §9 / §19 D6). `vm.envAddress`/`vm.envBytes32` revert if a var is unset.
contract Deploy is Script {
    /// @dev Canonical Arc USDC predeploy (6-decimal ERC-20 interface). Verified: docs.arc.io.
    address internal constant ARC_USDC = 0x3600000000000000000000000000000000000000;

    function run() external returns (AssuranceHub hub) {
        address usdc = vm.envAddress("ARC_USDC_ADDRESS");
        address forwarder = vm.envAddress("CRE_FORWARDER_ADDRESS");
        bytes32 workflowId = vm.envBytes32("CRE_WORKFLOW_ID");
        // bytes10(...) takes the leading 10 bytes, matching ReceiverBase's m[32:42] name decode.
        bytes10 workflowName = bytes10(vm.envBytes32("CRE_WORKFLOW_NAME"));
        address workflowOwner = vm.envAddress("CRE_WORKFLOW_OWNER");
        address admin = vm.envAddress("ADMIN_ADDRESS");
        address evaluator = vm.envAddress("EVALUATOR_ADDRESS");
        address feeRecipient = vm.envAddress("FEE_RECIPIENT_ADDRESS");
        uint256 deployerPk = vm.envUint("PRIVATE_KEY");

        // Fail loudly: USDC must be the canonical predeploy WITH code on this RPC/chain.
        require(usdc == ARC_USDC, "ARC_USDC_ADDRESS != canonical Arc USDC predeploy");
        require(usdc.code.length > 0, "ARC_USDC_ADDRESS has no code on this RPC/chain");
        // Forwarder may be a KeystoneForwarder contract OR an authorized relay EOA (plan §5) —
        // require non-zero and operator-supplied; do NOT require code (an EOA relay has none).
        require(forwarder != address(0), "CRE_FORWARDER_ADDRESS unset/zero");
        require(workflowOwner != address(0), "CRE_WORKFLOW_OWNER unset/zero");
        require(workflowId != bytes32(0), "CRE_WORKFLOW_ID unset/zero");
        require(workflowName != bytes10(0), "CRE_WORKFLOW_NAME unset/zero");

        vm.startBroadcast(deployerPk);
        hub = new AssuranceHub(usdc, forwarder, workflowId, workflowName, workflowOwner, admin, evaluator, feeRecipient);
        vm.stopBroadcast();

        console2.log("AssuranceHub:", address(hub));
        console2.log("USDC:", usdc);
        console2.log("Forwarder:", forwarder);
        console2.log("Admin:", admin);
        console2.log("Evaluator:", evaluator);
        console2.log("FeeRecipient:", feeRecipient);
    }
}
