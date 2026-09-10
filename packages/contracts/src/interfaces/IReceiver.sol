// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @title IReceiver
/// @notice Chainlink CRE / Keystone receiver interface. A KeystoneForwarder (or an
///         untrusted relay carrying a DON-signed blob) delivers a report by calling
///         `onReport(metadata, report)`. Implementers MUST advertise support via
///         {IERC165-supportsInterface}.
/// @dev The `metadata` blob carries the workflow identity (id + owner) so a receiver
///      can bind settlement to a specific workflow, not merely to the forwarder.
interface IReceiver is IERC165 {
    /// @param metadata Workflow identity + report routing metadata.
    /// @param report   ABI-encoded verdict payload produced by the workflow.
    function onReport(bytes calldata metadata, bytes calldata report) external;
}
