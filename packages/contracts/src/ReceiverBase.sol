// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IReceiver} from "./interfaces/IReceiver.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {Errors} from "./libraries/Errors.sol";

/// @title ReceiverBase
/// @notice Abstract base implementing CRE report authorization + ERC-165 discovery.
/// @dev Intentionally NOT `Ownable`: the concrete contract (VouchCore) owns the single
///      `Ownable2Step` lineage and exposes the owner-gated setters. This avoids the
///      double-`Ownable` diamond called out in the plan (§17.6).
///
///      Trust model (plan §17.3): the receiver binds settlement to BOTH the transport
///      (`forwarder`) AND the workflow identity (`expectedWorkflowId`/`expectedWorkflowOwner`)
///      carried in the report `metadata`. A different workflow relayed by the same
///      forwarder therefore cannot settle Vouch jobs (edge case E8b).
abstract contract ReceiverBase is IReceiver {
    /// @notice Authorized transport for DON-signed reports (KeystoneForwarder or relay).
    address public forwarder;

    /// @notice Workflow id (CRE workflow identifier) permitted to settle jobs.
    bytes32 public expectedWorkflowId;

    /// @notice Workflow owner address permitted to settle jobs.
    address public expectedWorkflowOwner;

    /// @notice Emitted when the authorized forwarder changes.
    event ForwarderUpdated(address indexed previous, address indexed current);

    /// @notice Emitted when the expected workflow identity changes.
    event ExpectedWorkflowUpdated(bytes32 indexed workflowId, address indexed workflowOwner);

    /// @dev Sets the authorized forwarder. Concrete contract must gate the caller.
    function _setForwarder(address newForwarder) internal {
        if (newForwarder == address(0)) revert Errors.ZeroAddress();
        emit ForwarderUpdated(forwarder, newForwarder);
        forwarder = newForwarder;
    }

    /// @dev Sets the expected workflow identity. Concrete contract must gate the caller.
    function _setExpectedWorkflow(bytes32 workflowId, address workflowOwner) internal {
        if (workflowOwner == address(0)) revert Errors.ZeroAddress();
        expectedWorkflowId = workflowId;
        expectedWorkflowOwner = workflowOwner;
        emit ExpectedWorkflowUpdated(workflowId, workflowOwner);
    }

    /// @dev Decodes the workflow identity from Keystone report metadata.
    ///      Vouch expects metadata as `abi.encode(bytes32 workflowId, address workflowOwner)`.
    function _decodeMetadata(bytes calldata metadata)
        internal
        pure
        returns (bytes32 workflowId, address workflowOwner)
    {
        (workflowId, workflowOwner) = abi.decode(metadata, (bytes32, address));
    }

    /// @dev Authorizes an incoming report: correct transport AND correct workflow identity.
    ///      Reverts with {Errors.NotForwarder} or {Errors.UnauthorizedWorkflow}.
    function _authorizeReport(bytes calldata metadata) internal view {
        if (msg.sender != forwarder) revert Errors.NotForwarder();
        (bytes32 workflowId, address workflowOwner) = _decodeMetadata(metadata);
        if (workflowId != expectedWorkflowId || workflowOwner != expectedWorkflowOwner) {
            revert Errors.UnauthorizedWorkflow();
        }
    }

    /// @inheritdoc IERC165
    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }
}
