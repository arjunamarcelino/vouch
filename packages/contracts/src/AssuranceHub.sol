// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

import {ReceiverBase} from "./ReceiverBase.sol";
import {Errors} from "./libraries/Errors.sol";

/// @title AssuranceHub
/// @author Vouch
/// @notice Canonical financial settlement layer for the Vouch outcome-assurance protocol on Circle
///         Arc. Escrows a client task fee + optional service fee, holds a provider-funded guarantee
///         (collateral), runs the fund → accept → submit → initial-evaluation → coverage-window →
///         claim → confidential-resolution lifecycle, and pays a capped service credit to the client
///         on a proven covered failure.
/// @dev All accounting uses the 6-decimal USDC ERC-20 interface (never the 18-dec native/gas view).
///      Non-payable. Every value-moving function is `nonReentrant` (outermost) and follows strict
///      Checks-Effects-Interactions. Two trust surfaces: EVALUATOR_ROLE resolves the public
///      submission; the CRE receiver (ReceiverBase: forwarder + workflow identity) is the ONLY path
///      that finalizes confidential claims. Terminology is deliberate: assurance / guarantee /
///      coverage window / service credit — never "insurance".
contract AssuranceHub is ReceiverBase, AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ------------------------------------------------------------------ //
    //                              Roles                                  //
    // ------------------------------------------------------------------ //
    // DEFAULT_ADMIN_ROLE (0x00, from AccessControl) also pauses/unpauses and holds config.
    bytes32 public constant EVALUATOR_ROLE = keccak256("EVALUATOR_ROLE");

    // ------------------------------------------------------------------ //
    //                            Constants                               //
    // ------------------------------------------------------------------ //
    /// @notice Inclusive per-job coverage-duration bounds (seconds).
    uint64 public constant MIN_COVERAGE = 1 hours;
    uint64 public constant MAX_COVERAGE = 30 days;
    /// @notice Grace after `submissionDeadline` before a Submitted job can be expired (evaluator inactive).
    uint64 public constant RESOLUTION_GRACE = 3 days;
    /// @notice Grace after a claim is opened before `resolveClaimTimeout` is callable (CRE inactive, B1).
    uint64 public constant CLAIM_RESOLUTION_GRACE = 3 days;

    // ------------------------------------------------------------------ //
    //                              Types                                  //
    // ------------------------------------------------------------------ //

    /// @notice Lifecycle state (plan §19 D2 — `Created` merged into `Funded`).
    enum State {
        None, // 0
        Funded, // 1 client escrowed taskFee + serviceFee
        AcceptedByProvider, // 2 provider locked the full guarantee collateral
        Submitted, // 3 provider posted the deliverable commitment
        InitiallyApproved, // 4 approved; taskFee->provider, serviceFee->feeRecipient; coverage open
        ClaimPending, // 5 client opened a claim in coverage; awaiting confidential resolution
        ClaimPaid, // 6 TERMINAL: covered failure paid the service credit to the client
        Completed, // 7 TERMINAL: coverage ended clean; provider withdrew collateral
        Cancelled, // 8 TERMINAL: unaccepted / initial-rejected -> refunded
        Expired // 9 TERMINAL: deadline missed -> refunded
    }

    /// @notice Full onchain record. Amounts are 6-decimal USDC units; timestamps are uint64.
    struct AssuranceJob {
        address client;
        address provider;
        address paymentToken; // validated == canonical usdc
        uint256 taskFee;
        uint256 guaranteeAmount; // provider locks exactly this as collateral (plan §19 D1/D4)
        uint256 serviceFee; // optional (may be 0)
        bytes32 publicCriteriaHash;
        bytes32 privateCriteriaCommitment; // salted; preimage lives only in the CRE TEE
        bytes32 submissionCommitment; // set on submitDeliverable
        bytes32 claimEvidenceCommitment; // set on openClaim
        uint64 createdAt;
        uint64 submissionDeadline;
        uint64 coverageDuration; // persisted at openJob, consumed to stamp coverageEnd at approval
        uint64 coverageEnd; // stamped atomically at approval; immutable thereafter
        uint64 claimResolutionDeadline; // stamped at openClaim; after it, resolveClaimTimeout is callable
        State status;
    }

    // ------------------------------------------------------------------ //
    //                              Storage                                //
    // ------------------------------------------------------------------ //

    /// @notice The USDC token (6-decimal ERC-20 interface) used for all accounting.
    IERC20 public immutable usdc;

    /// @notice Recipient of the optional service fee at initial approval (config only, never principal).
    address public feeRecipient;

    /// @notice Auto-increment job id source (first assigned id is 1; 0 is reserved / None).
    uint256 public nextJobId = 1;

    /// @notice Solvency counter: escrowed taskFee+serviceFee + locked collateral still owed.
    /// @dev Invariant: `usdc.balanceOf(address(this)) >= totalLiabilities` (plan §6.7).
    uint256 public totalLiabilities;

    /// @notice Idempotency latch: a settled (claim-paid) job can never be paid again.
    mapping(uint256 jobId => bool) public settled;

    /// @notice Claim latch: prevents a second openClaim and a replayed onReport for a job.
    mapping(uint256 jobId => bool) public claimFiled;

    mapping(uint256 jobId => AssuranceJob) private _jobs;

    // ------------------------------------------------------------------ //
    //                        Events (frozen §4 / §19 D7)                 //
    // ------------------------------------------------------------------ //

    event JobCreated(
        uint256 indexed jobId,
        address indexed client,
        address indexed provider,
        address paymentToken,
        uint256 taskFee,
        uint256 guaranteeAmount,
        uint256 serviceFee,
        uint64 submissionDeadline,
        uint64 coverageDuration,
        bytes32 publicCriteriaHash,
        bytes32 privateCriteriaCommitment
    );
    event JobFunded(uint256 indexed jobId, address indexed client, uint256 amountFunded);
    event ProviderAccepted(uint256 indexed jobId, address indexed provider, uint256 collateral);
    event DeliverableSubmitted(uint256 indexed jobId, address indexed provider, bytes32 submissionCommitment);
    event InitialEvaluationResolved(uint256 indexed jobId, address indexed evaluator, bool approved);
    event CoverageStarted(uint256 indexed jobId, uint64 coverageEnd);
    event ClaimOpened(uint256 indexed jobId, address indexed client, bytes32 evidenceCommitment);
    event ConfidentialEvaluationResolved(uint256 indexed jobId, bool covered, uint256 serviceCredit);
    event GuaranteePaid(uint256 indexed jobId, address indexed client, uint256 amount);
    event CollateralReleased(uint256 indexed jobId, address indexed provider, uint256 amount);
    event JobExpired(
        uint256 indexed jobId, address indexed caller, uint256 refundToClient, uint256 collateralToProvider
    );
    event JobCancelled(
        uint256 indexed jobId, address indexed caller, uint256 refundToClient, uint256 collateralToProvider
    );
    event ServiceFeePaid(uint256 indexed jobId, address indexed feeRecipient, uint256 amount);
    event ClaimTimedOut(uint256 indexed jobId);
    event FeeRecipientUpdated(address indexed previous, address indexed current);

    // ------------------------------------------------------------------ //
    //                            Constructor                             //
    // ------------------------------------------------------------------ //

    constructor(
        address usdc_,
        address forwarder_,
        bytes32 workflowId_,
        bytes10 workflowName_,
        address workflowOwner_,
        address admin_,
        address evaluator_,
        address feeRecipient_
    ) {
        if (usdc_ == address(0) || admin_ == address(0) || evaluator_ == address(0) || feeRecipient_ == address(0)) {
            revert Errors.ZeroAddress();
        }
        usdc = IERC20(usdc_);
        feeRecipient = feeRecipient_;

        _setForwarder(forwarder_);
        _setExpectedWorkflow(workflowId_, workflowName_, workflowOwner_);

        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(EVALUATOR_ROLE, evaluator_);

        emit FeeRecipientUpdated(address(0), feeRecipient_);
    }

    // ------------------------------------------------------------------ //
    //                           View helpers                             //
    // ------------------------------------------------------------------ //

    function getJob(uint256 jobId) external view returns (AssuranceJob memory) {
        return _jobs[jobId];
    }

    // ------------------------------------------------------------------ //
    //                       Lifecycle: open / accept                     //
    // ------------------------------------------------------------------ //

    /// @notice Client creates AND funds a job in one tx (plan §19 D2). Returns the auto jobId.
    /// @dev `guaranteeAmount` encodes off-chain-negotiated terms (§19 D1); the provider's acceptJob
    ///      is the agreement. Escrows taskFee + serviceFee. Emits JobCreated then JobFunded.
    function openJob(
        address provider,
        address token,
        uint256 taskFee,
        uint256 guaranteeAmount,
        uint256 serviceFee,
        uint64 submissionDeadline,
        uint64 coverageDuration,
        bytes32 publicCriteriaHash,
        bytes32 privateCriteriaCommitment
    ) external whenNotPaused nonReentrant returns (uint256 jobId) {
        if (provider == address(0)) revert Errors.ZeroAddress();
        if (provider == msg.sender) revert Errors.SelfDealing();
        if (token != address(usdc)) revert Errors.InvalidToken();
        if (taskFee == 0 || guaranteeAmount == 0) revert Errors.ZeroAmount();
        if (submissionDeadline <= block.timestamp) revert Errors.DeadlineInPast();
        if (coverageDuration < MIN_COVERAGE) revert Errors.CoverageTooShort();
        if (coverageDuration > MAX_COVERAGE) revert Errors.CoverageTooLong();

        jobId = nextJobId++;
        uint256 funded = taskFee + serviceFee;

        _jobs[jobId] = AssuranceJob({
            client: msg.sender,
            provider: provider,
            paymentToken: token,
            taskFee: taskFee,
            guaranteeAmount: guaranteeAmount,
            serviceFee: serviceFee,
            publicCriteriaHash: publicCriteriaHash,
            privateCriteriaCommitment: privateCriteriaCommitment,
            submissionCommitment: bytes32(0),
            claimEvidenceCommitment: bytes32(0),
            createdAt: uint64(block.timestamp),
            submissionDeadline: submissionDeadline,
            coverageDuration: coverageDuration,
            coverageEnd: 0,
            claimResolutionDeadline: 0,
            status: State.Funded
        });
        totalLiabilities += funded;

        emit JobCreated(
            jobId,
            msg.sender,
            provider,
            token,
            taskFee,
            guaranteeAmount,
            serviceFee,
            submissionDeadline,
            coverageDuration,
            publicCriteriaHash,
            privateCriteriaCommitment
        );
        emit JobFunded(jobId, msg.sender, funded);

        usdc.safeTransferFrom(msg.sender, address(this), funded);
    }

    /// @notice Provider locks the full guarantee collateral. Funded -> AcceptedByProvider.
    function acceptJob(uint256 jobId) external whenNotPaused nonReentrant {
        AssuranceJob storage job = _jobs[jobId];
        if (job.status != State.Funded) revert Errors.BadState();
        if (msg.sender != job.provider) revert Errors.NotProvider();

        uint256 collateral = job.guaranteeAmount;
        job.status = State.AcceptedByProvider;
        totalLiabilities += collateral;

        emit ProviderAccepted(jobId, msg.sender, collateral);

        usdc.safeTransferFrom(msg.sender, address(this), collateral);
    }

    /// @notice Provider posts the deliverable commitment before the deadline. Accepted -> Submitted.
    function submitDeliverable(uint256 jobId, bytes32 submissionCommitment) external whenNotPaused {
        AssuranceJob storage job = _jobs[jobId];
        if (job.status != State.AcceptedByProvider) revert Errors.BadState();
        if (msg.sender != job.provider) revert Errors.NotProvider();
        if (block.timestamp > job.submissionDeadline) revert Errors.SubmissionExpired();
        if (submissionCommitment == bytes32(0)) revert Errors.BadCommitment();

        job.submissionCommitment = submissionCommitment;
        job.status = State.Submitted;

        emit DeliverableSubmitted(jobId, msg.sender, submissionCommitment);
    }

    // ------------------------------------------------------------------ //
    //                    Lifecycle: initial evaluation                   //
    // ------------------------------------------------------------------ //

    /// @notice Global evaluator approves/rejects the public submission.
    ///         approve: taskFee->provider, serviceFee->feeRecipient, coverage opens -> InitiallyApproved.
    ///         reject : refund client, return collateral -> Cancelled.
    function resolveInitialEvaluation(uint256 jobId, bool approved)
        external
        whenNotPaused
        nonReentrant
        onlyRole(EVALUATOR_ROLE)
    {
        AssuranceJob storage job = _jobs[jobId];
        if (job.status != State.Submitted) revert Errors.BadState();

        uint256 taskFee = job.taskFee;
        uint256 serviceFee = job.serviceFee;
        uint256 collateral = job.guaranteeAmount;

        if (approved) {
            uint64 coverageEnd = uint64(block.timestamp) + job.coverageDuration;
            job.coverageEnd = coverageEnd;
            job.status = State.InitiallyApproved;
            totalLiabilities -= (taskFee + serviceFee);

            emit InitialEvaluationResolved(jobId, msg.sender, true);
            emit CoverageStarted(jobId, coverageEnd);

            usdc.safeTransfer(job.provider, taskFee);
            if (serviceFee > 0) {
                usdc.safeTransfer(feeRecipient, serviceFee);
                emit ServiceFeePaid(jobId, feeRecipient, serviceFee);
            }
        } else {
            uint256 refund = taskFee + serviceFee;
            job.status = State.Cancelled;
            totalLiabilities -= (refund + collateral);

            emit InitialEvaluationResolved(jobId, msg.sender, false);
            emit JobCancelled(jobId, msg.sender, refund, collateral);

            if (refund > 0) usdc.safeTransfer(job.client, refund);
            if (collateral > 0) usdc.safeTransfer(job.provider, collateral);
        }
    }

    // ------------------------------------------------------------------ //
    //                      Lifecycle: claim + finalize                   //
    // ------------------------------------------------------------------ //

    /// @notice Client opens a claim within the coverage window. InitiallyApproved -> ClaimPending.
    /// @dev Sets the claim latch (one claim per job, ever) and stamps the resolution timeout (B1).
    function openClaim(uint256 jobId, bytes32 evidenceCommitment) external whenNotPaused {
        AssuranceJob storage job = _jobs[jobId];
        if (job.status != State.InitiallyApproved) revert Errors.BadState();
        if (msg.sender != job.client) revert Errors.NotClient();
        if (block.timestamp > job.coverageEnd) revert Errors.ClaimWindowClosed();
        if (claimFiled[jobId]) revert Errors.ClaimAlreadyFiled();
        if (evidenceCommitment == bytes32(0)) revert Errors.BadCommitment();

        claimFiled[jobId] = true;
        job.claimEvidenceCommitment = evidenceCommitment;
        job.claimResolutionDeadline = uint64(block.timestamp) + CLAIM_RESOLUTION_GRACE;
        job.status = State.ClaimPending;

        emit ClaimOpened(jobId, msg.sender, evidenceCommitment);
    }

    /// @notice CRE receiver finalizes the confidential claim. ClaimPending -> ClaimPaid | InitiallyApproved.
    /// @dev NOT pausable (an already-earned claim must finalize). Gated by forwarder + workflow identity.
    /// @param metadata Packed Keystone metadata (bytes32 id | bytes10 name | address owner).
    /// @param report   abi.encode(uint256 jobId, bool covered, uint256 amount). `amount` is the CRE's
    ///                 decided service credit; the contract caps it at the guarantee.
    function onReport(bytes calldata metadata, bytes calldata report) external override nonReentrant {
        _authorizeReport(metadata);

        (uint256 jobId, bool covered, uint256 amount) = abi.decode(report, (uint256, bool, uint256));

        AssuranceJob storage job = _jobs[jobId];
        if (settled[jobId]) revert Errors.AlreadySettled();
        if (job.status != State.ClaimPending) revert Errors.BadState();

        if (covered) {
            uint256 guarantee = job.guaranteeAmount;
            if (amount > guarantee) revert Errors.AmountAboveCap();
            uint256 payout = amount; // already capped at the guarantee
            if (payout == 0) revert Errors.ZeroPayout();
            uint256 remainder = guarantee - payout;

            settled[jobId] = true;
            job.status = State.ClaimPaid;
            totalLiabilities -= guarantee;

            emit ConfidentialEvaluationResolved(jobId, true, payout);

            usdc.safeTransfer(job.client, payout);
            emit GuaranteePaid(jobId, job.client, payout);

            if (remainder > 0) {
                usdc.safeTransfer(job.provider, remainder);
                emit CollateralReleased(jobId, job.provider, remainder);
            }
        } else {
            // Not covered: return to coverage. Claim latch stays set -> no re-claim. No funds move.
            job.status = State.InitiallyApproved;
            emit ConfidentialEvaluationResolved(jobId, false, 0);
        }
    }

    /// @notice Permissionless fallback if the CRE never resolves a claim (plan §19 D3, BLOCKER B1).
    ///         After `claimResolutionDeadline`, treat as not-covered and return to InitiallyApproved
    ///         so the provider can withdraw collateral after coverageEnd. NOT pausable (exit).
    function resolveClaimTimeout(uint256 jobId) external nonReentrant {
        AssuranceJob storage job = _jobs[jobId];
        if (job.status != State.ClaimPending) revert Errors.BadState();
        if (block.timestamp <= job.claimResolutionDeadline) revert Errors.ClaimNotTimedOut();

        job.status = State.InitiallyApproved;
        emit ClaimTimedOut(jobId);
        emit ConfidentialEvaluationResolved(jobId, false, 0);
    }

    // ------------------------------------------------------------------ //
    //                     Lifecycle: exits (never paused)                //
    // ------------------------------------------------------------------ //

    /// @notice Provider reclaims collateral after coverage ends clean. InitiallyApproved -> Completed.
    function withdrawCollateral(uint256 jobId) external nonReentrant {
        AssuranceJob storage job = _jobs[jobId];
        if (settled[jobId]) revert Errors.AlreadySettled();
        if (job.status != State.InitiallyApproved) revert Errors.BadState();
        if (msg.sender != job.provider) revert Errors.NotProvider();
        if (block.timestamp <= job.coverageEnd) revert Errors.CoverageWindowOpen();

        uint256 amount = job.guaranteeAmount;
        job.status = State.Completed;
        totalLiabilities -= amount;

        emit CollateralReleased(jobId, job.provider, amount);

        if (amount > 0) usdc.safeTransfer(job.provider, amount);
    }

    /// @notice Client cancels a Funded job the provider never accepted. Funded -> Cancelled.
    function cancelJob(uint256 jobId) external nonReentrant {
        AssuranceJob storage job = _jobs[jobId];
        if (job.status != State.Funded) revert Errors.BadState();
        if (msg.sender != job.client) revert Errors.NotClient();

        uint256 refund = job.taskFee + job.serviceFee;
        job.status = State.Cancelled;
        totalLiabilities -= refund;

        emit JobCancelled(jobId, msg.sender, refund, 0);

        if (refund > 0) usdc.safeTransfer(job.client, refund);
    }

    /// @notice Anyone expires a stalled job. AcceptedByProvider | Submitted -> Expired.
    /// @dev AcceptedByProvider: past submissionDeadline. Submitted: past deadline + RESOLUTION_GRACE.
    ///      Refunds the client, returns provider collateral.
    function expireJob(uint256 jobId) external nonReentrant {
        AssuranceJob storage job = _jobs[jobId];
        State s = job.status;
        if (s == State.AcceptedByProvider) {
            if (block.timestamp <= job.submissionDeadline) revert Errors.NotExpiredYet();
        } else if (s == State.Submitted) {
            if (block.timestamp <= uint256(job.submissionDeadline) + RESOLUTION_GRACE) {
                revert Errors.NotExpiredYet();
            }
        } else {
            revert Errors.BadState();
        }

        uint256 refund = job.taskFee + job.serviceFee;
        uint256 collateral = job.guaranteeAmount;
        job.status = State.Expired;
        totalLiabilities -= (refund + collateral);

        emit JobExpired(jobId, msg.sender, refund, collateral);

        if (refund > 0) usdc.safeTransfer(job.client, refund);
        if (collateral > 0) usdc.safeTransfer(job.provider, collateral);
    }

    // ------------------------------------------------------------------ //
    //                               Admin                                //
    // ------------------------------------------------------------------ //

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function setForwarder(address newForwarder) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setForwarder(newForwarder);
    }

    function setExpectedWorkflow(bytes32 workflowId, bytes10 workflowName, address workflowOwner)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        _setExpectedWorkflow(workflowId, workflowName, workflowOwner);
    }

    function setFeeRecipient(address newRecipient) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newRecipient == address(0)) revert Errors.ZeroAddress();
        emit FeeRecipientUpdated(feeRecipient, newRecipient);
        feeRecipient = newRecipient;
    }

    // ------------------------------------------------------------------ //
    //                            ERC-165                                 //
    // ------------------------------------------------------------------ //

    /// @dev Resolves the diamond across AccessControl (IAccessControl + IERC165) and ReceiverBase
    ///      (IReceiver + IERC165). Both branches MUST be named or the compiler errors.
    function supportsInterface(bytes4 interfaceId) public view override(AccessControl, ReceiverBase) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
