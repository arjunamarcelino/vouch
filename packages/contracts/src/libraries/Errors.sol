// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title Errors
/// @notice Gas-cheap custom errors for AssuranceHub / ReceiverBase. Selectors are stable and
///         asserted in tests via `vm.expectRevert(Errors.<Name>.selector)`.
library Errors {
    // --- Auth / actor ---
    error NotClient();
    error NotProvider();
    error NotForwarder();
    error UnauthorizedWorkflow();
    error ZeroWorkflowIdentity(); // workflowId or workflowName is zero (weakens the settlement gate)
    error ReportDomainMismatch(); // report chainId/receiver != this deployment (cross-chain replay)
    error NoPendingChange(); // apply* called with nothing queued
    error TimelockNotElapsed(); // apply* called before the timelock eta

    // --- State machine ---
    error BadState();
    error AlreadySettled();

    // --- Claim / coverage windows ---
    error ClaimAlreadyFiled();
    error ClaimWindowClosed();
    error CoverageWindowOpen(); // withdrawCollateral before coverageEnd
    error CoverageTooLong(); // coverageDuration > MAX_COVERAGE
    error CoverageTooShort(); // coverageDuration < MIN_COVERAGE

    // --- Deadlines / expiry ---
    error SubmissionExpired();
    error DeadlineInPast();
    error NotExpiredYet();
    error ClaimNotTimedOut();

    // --- Validation ---
    error InvalidToken();
    error ZeroAddress();
    error ZeroAmount();
    error ZeroPayout();
    error BadCommitment();
    error BadMetadata(); // packed CRE metadata shorter than 62 bytes
    error SelfDealing(); // provider == client
    error AmountAboveCap(); // reported service credit exceeds the guarantee

    // --- Quote bond escrow ---
    error BondExists(); // a live bond already occupies this quoteId slot (replay backstop)
    error BondNotFound(); // no live bond for this quoteId
    error InvalidExpiry(); // bond expiry not in the future
}
