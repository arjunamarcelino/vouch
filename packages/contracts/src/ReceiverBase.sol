// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IReceiver} from "./interfaces/IReceiver.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {Errors} from "./libraries/Errors.sol";

/// @title ReceiverBase
/// @notice Abstract base implementing Chainlink CRE report authorization + ERC-165 discovery.
/// @dev Intentionally NOT AccessControl/Ownable: the concrete contract (AssuranceHub) owns the
///      authorities and gates these setters with `onlyRole(DEFAULT_ADMIN_ROLE)`. Settlement binds
///      to BOTH the transport (`forwarder`) AND the full workflow identity carried in the report
///      metadata, so a different workflow relayed by the same forwarder cannot settle jobs.
///
///      Metadata layout (Keystone, PACKED — plan §4.2): the report `metadata` is
///      `abi.encodePacked(bytes32 workflowId, bytes10 workflowName, address workflowOwner)` = 62
///      bytes; production forwarders append a 2-byte `reportId` (64 total). It MUST be slice-decoded
///      by byte offset — never `abi.decode` (that was the original bug).
abstract contract ReceiverBase is IReceiver {
    /// @notice Authorized transport for DON-signed reports (KeystoneForwarder or relay).
    address public forwarder;

    /// @notice Workflow id permitted to settle jobs.
    bytes32 public expectedWorkflowId;

    /// @notice Workflow name (bytes10) permitted to settle jobs.
    bytes10 public expectedWorkflowName;

    /// @notice Workflow owner permitted to settle jobs.
    address public expectedWorkflowOwner;

    event ForwarderUpdated(address indexed previous, address indexed current);
    event ExpectedWorkflowUpdated(bytes32 indexed workflowId, bytes10 workflowName, address indexed workflowOwner);

    /// @dev Sets the authorized forwarder. Concrete contract must gate the caller.
    function _setForwarder(address newForwarder) internal {
        if (newForwarder == address(0)) revert Errors.ZeroAddress();
        emit ForwarderUpdated(forwarder, newForwarder);
        forwarder = newForwarder;
    }

    /// @dev Sets the expected workflow identity. Concrete contract must gate the caller.
    function _setExpectedWorkflow(bytes32 workflowId, bytes10 workflowName, address workflowOwner) internal {
        if (workflowOwner == address(0)) revert Errors.ZeroAddress();
        expectedWorkflowId = workflowId;
        expectedWorkflowName = workflowName;
        expectedWorkflowOwner = workflowOwner;
        emit ExpectedWorkflowUpdated(workflowId, workflowName, workflowOwner);
    }

    /// @dev Decodes PACKED Keystone metadata by byte offset (first 62 bytes; extra suffix ignored).
    function _decodeMetadata(bytes calldata m)
        internal
        pure
        returns (bytes32 workflowId, bytes10 workflowName, address workflowOwner)
    {
        if (m.length < 62) revert Errors.BadMetadata();
        workflowId = bytes32(m[0:32]);
        workflowName = bytes10(m[32:42]);
        workflowOwner = address(bytes20(m[42:62]));
    }

    /// @dev Authorizes an incoming report: correct transport AND full workflow identity (id+name+owner).
    function _authorizeReport(bytes calldata metadata) internal view {
        if (msg.sender != forwarder) revert Errors.NotForwarder();
        (bytes32 workflowId, bytes10 workflowName, address workflowOwner) = _decodeMetadata(metadata);
        if (
            workflowId != expectedWorkflowId || workflowName != expectedWorkflowName
                || workflowOwner != expectedWorkflowOwner
        ) {
            revert Errors.UnauthorizedWorkflow();
        }
    }

    /// @inheritdoc IERC165
    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }
}
