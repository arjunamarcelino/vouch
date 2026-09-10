// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title Errors
/// @notice Gas-cheap custom errors for VouchCore. Selectors are stable and can be
///         asserted in tests via `vm.expectRevert(Errors.<Name>.selector)`.
library Errors {
    /// @dev Caller is not the job's client.
    error NotClient();
    /// @dev Caller is not the job's provider.
    error NotProvider();
    /// @dev Caller is not the configured KeystoneForwarder / relay.
    error NotForwarder();
    /// @dev The job is not in a state that permits this transition.
    error BadState();
    /// @dev The job has already been settled (idempotency latch).
    error AlreadySettled();
    /// @dev The coverage window is still open (action requires it closed).
    error CoverageWindowOpen();
    /// @dev The coverage window has closed (action requires it open).
    error CoverageWindowClosed();
    /// @dev A payout report was delivered but does not prove a covered regression.
    error NoRegressionProven();
    /// @dev A payout would move zero tokens.
    error ZeroPayout();
    /// @dev Provider attempted to lock less collateral than the advertised cap.
    error InsufficientCollateral();
    /// @dev The report was signed by / bound to a workflow that is not authorized.
    error UnauthorizedWorkflow();
    /// @dev A zero address was supplied where a real address is required.
    error ZeroAddress();
    /// @dev A zero amount was supplied where a positive amount is required.
    error ZeroAmount();
    /// @dev Public acceptance tests have not been attested as passing.
    error TestsNotPassed();
    /// @dev The funding deadline has not yet elapsed (cannot cancel yet).
    error FundingWindowNotElapsed();
    /// @dev A job with this id already exists.
    error JobAlreadyExists();
}
