// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

import {ReceiverBase} from "./ReceiverBase.sol";
import {Errors} from "./libraries/Errors.sol";

/// @title VouchCore
/// @author Vouch
/// @notice Onchain financial settlement for the Vouch confidential outcome-assurance
///         protocol on Circle Arc. Owns escrow of the client task fee, the
///         provider-funded capped performance guarantee, the post-acceptance coverage
///         window, and the capped + idempotent payout gated by a DON-signed CRE report.
/// @dev All accounting uses the 6-decimal USDC ERC-20 interface (never native/18-dec gas
///      accounting, plan E10). The contract is non-payable: it accepts no `msg.value`.
///      Every token-moving function follows strict Checks-Effects-Interactions and is
///      `nonReentrant` (plan E11). Payout authority is the DON signature carried by an
///      authorized transport, bound to a specific workflow identity (plan §17.3).
contract VouchCore is ReceiverBase, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ------------------------------------------------------------------ //
    //                              Types                                  //
    // ------------------------------------------------------------------ //

    /// @notice Lifecycle state of a job. Mirrors the plan state machine (§3.1/§3.2).
    enum State {
        None, // 0 - never created
        Created, // 1 - task fee funded by client, awaiting provider collateral
        GuaranteeLocked, // 2 - provider locked capped collateral
        CoverageOpen, // 3 - task fee released, coverage window running
        Settled, // 4 - terminal: paid to client and/or released to provider
        Cancelled // 5 - terminal: unfunded job refunded to client
    }

    /// @notice Full onchain record for a job. Amounts are 6-decimal USDC units.
    struct Job {
        address client;
        address provider;
        uint256 taskFee;
        uint256 guaranteeCap;
        uint256 lockedCollateral;
        uint64 coverageDeadline; // set atomically at releaseTaskFee, immutable thereafter
        uint64 fundingDeadline; // provider must lock collateral before this
        State state;
        bool testsPassed; // public acceptance tests attested by owner
    }

    // ------------------------------------------------------------------ //
    //                              Storage                                //
    // ------------------------------------------------------------------ //

    /// @notice The USDC token (6-decimal ERC-20 interface) used for all accounting.
    IERC20 public immutable usdc;

    /// @notice Coverage window duration (seconds) applied when a task fee is released.
    /// @dev Bounded + immutable per job once `coverageDeadline` is stamped; changing this
    ///      never retroactively moves in-flight deadlines (plan §17.6 H5).
    uint64 public coverageWindow;

    /// @notice Funding window duration (seconds): how long a client's task fee is escrowed
    ///         before it becomes reclaimable if the provider never locks collateral.
    uint64 public fundingWindow;

    /// @notice Idempotency latch: a settled job can never be paid twice (plan E5).
    mapping(uint256 jobId => bool) public settled;

    /// @notice Job records keyed by the client-supplied job id.
    mapping(uint256 jobId => Job) private _jobs;

    // ------------------------------------------------------------------ //
    //                              Events                                 //
    // ------------------------------------------------------------------ //

    event JobCreated(
        uint256 indexed jobId, address indexed client, address indexed provider, uint256 taskFee, uint256 guaranteeCap
    );
    event GuaranteeLocked(uint256 indexed jobId, address indexed provider, uint256 collateral, uint256 guaranteeCap);
    event TaskFeeReleased(uint256 indexed jobId, address indexed provider, uint256 amount);
    event CoverageOpened(uint256 indexed jobId, address indexed provider, uint64 coverageDeadline);
    event RegressionProven(uint256 indexed jobId, address indexed provider, address indexed client, uint256 payout);
    event GuaranteePaid(uint256 indexed jobId, address indexed client, uint256 amount);
    event GuaranteeReleased(uint256 indexed jobId, address indexed provider, uint256 amount);
    event JobCancelled(uint256 indexed jobId, address indexed client, uint256 refund);

    /// @notice Emitted when the public-tests-passed attestation is recorded.
    event PublicTestsPassed(uint256 indexed jobId, address indexed provider);
    /// @notice Emitted when the coverage window duration is updated by the owner.
    event CoverageWindowUpdated(uint64 previous, uint64 current);
    /// @notice Emitted when the funding window duration is updated by the owner.
    event FundingWindowUpdated(uint64 previous, uint64 current);

    // ------------------------------------------------------------------ //
    //                            Constructor                             //
    // ------------------------------------------------------------------ //

    /// @param usdc_ The 6-decimal USDC ERC-20 used for all accounting.
    /// @param forwarder_ Authorized transport for DON-signed reports.
    /// @param coverageWindow_ Coverage window duration in seconds.
    /// @param fundingWindow_ Funding window duration in seconds.
    constructor(address usdc_, address forwarder_, uint64 coverageWindow_, uint64 fundingWindow_) Ownable(msg.sender) {
        if (usdc_ == address(0)) revert Errors.ZeroAddress();
        if (coverageWindow_ == 0 || fundingWindow_ == 0) revert Errors.ZeroAmount();
        usdc = IERC20(usdc_);
        coverageWindow = coverageWindow_;
        fundingWindow = fundingWindow_;
        _setForwarder(forwarder_);
    }

    // ------------------------------------------------------------------ //
    //                           View helpers                             //
    // ------------------------------------------------------------------ //

    /// @notice Returns the full job record.
    function getJob(uint256 jobId) external view returns (Job memory) {
        return _jobs[jobId];
    }

    // ------------------------------------------------------------------ //
    //                          Lifecycle: setup                          //
    // ------------------------------------------------------------------ //

    /// @notice Client creates a job and escrows the task fee (pulled via `safeTransferFrom`).
    /// @dev Caller is the client. `guaranteeCap` is the provider's advertised coverage.
    function createJob(uint256 jobId, address provider, uint256 taskFee, uint256 guaranteeCap) external nonReentrant {
        if (_jobs[jobId].state != State.None) revert Errors.JobAlreadyExists();
        if (provider == address(0)) revert Errors.ZeroAddress();
        if (taskFee == 0 || guaranteeCap == 0) revert Errors.ZeroAmount();

        _jobs[jobId] = Job({
            client: msg.sender,
            provider: provider,
            taskFee: taskFee,
            guaranteeCap: guaranteeCap,
            lockedCollateral: 0,
            coverageDeadline: 0,
            fundingDeadline: uint64(block.timestamp) + fundingWindow,
            state: State.Created,
            testsPassed: false
        });

        // Effects done; interaction last (CEI).
        usdc.safeTransferFrom(msg.sender, address(this), taskFee);

        emit JobCreated(jobId, msg.sender, provider, taskFee, guaranteeCap);
    }

    /// @notice Provider locks capped collateral (== `guaranteeCap`) as the guarantee.
    /// @dev Enforces the `locked >= cap` invariant (plan §17.6 H5, E6): a provider cannot
    ///      advertise a large cap while locking less.
    function lockGuarantee(uint256 jobId) external nonReentrant {
        Job storage job = _jobs[jobId];
        if (job.state != State.Created) revert Errors.BadState();
        if (msg.sender != job.provider) revert Errors.NotProvider();

        uint256 collateral = job.guaranteeCap;
        job.lockedCollateral = collateral;
        job.state = State.GuaranteeLocked;

        // Invariant: locked collateral must fully back the advertised cap.
        if (job.lockedCollateral < job.guaranteeCap) revert Errors.InsufficientCollateral();

        usdc.safeTransferFrom(msg.sender, address(this), collateral);

        emit GuaranteeLocked(jobId, msg.sender, collateral, job.guaranteeCap);
    }

    /// @notice Owner attests that the public acceptance tests passed (precondition for
    ///         releasing the task fee). Requires the guarantee to be locked first (E2).
    function markPublicTestsPassed(uint256 jobId) external onlyOwner {
        Job storage job = _jobs[jobId];
        if (job.state != State.GuaranteeLocked) revert Errors.BadState();
        job.testsPassed = true;
        emit PublicTestsPassed(jobId, job.provider);
    }

    /// @notice Provider claims the task fee once public tests passed; this atomically opens
    ///         the coverage window (sets `coverageDeadline`, immutable thereafter).
    function releaseTaskFee(uint256 jobId) external nonReentrant {
        Job storage job = _jobs[jobId];
        if (job.state != State.GuaranteeLocked) revert Errors.BadState();
        if (msg.sender != job.provider) revert Errors.NotProvider();
        if (!job.testsPassed) revert Errors.TestsNotPassed();

        uint256 fee = job.taskFee;
        uint64 deadline = uint64(block.timestamp) + coverageWindow;
        job.coverageDeadline = deadline;
        job.state = State.CoverageOpen;

        usdc.safeTransfer(job.provider, fee);

        emit TaskFeeReleased(jobId, job.provider, fee);
        emit CoverageOpened(jobId, job.provider, deadline);
    }

    // ------------------------------------------------------------------ //
    //                         Lifecycle: settlement                      //
    // ------------------------------------------------------------------ //

    /// @notice CRE receiver entrypoint. An authorized transport delivers a DON-signed
    ///         report proving a covered regression; this settles the guarantee.
    /// @dev Gated by {ReceiverBase-_authorizeReport}: correct forwarder AND workflow
    ///      identity (plan §17.3, edge cases E8/E8b). Decodes
    ///      `(uint256 jobId, bool regressed, uint256 amount)`; `amount` is advisory — the
    ///      contract independently caps the payout.
    /// @param metadata `abi.encode(bytes32 workflowId, address workflowOwner)`.
    /// @param report   `abi.encode(uint256 jobId, bool regressed, uint256 amount)`.
    function onReport(bytes calldata metadata, bytes calldata report) external override nonReentrant {
        _authorizeReport(metadata);

        (uint256 jobId, bool regressed,) = abi.decode(report, (uint256, bool, uint256));
        if (!regressed) revert Errors.NoRegressionProven();

        Job storage job = _jobs[jobId];
        if (settled[jobId]) revert Errors.AlreadySettled();
        if (job.state != State.CoverageOpen) revert Errors.BadState();
        if (block.timestamp > job.coverageDeadline) revert Errors.CoverageWindowClosed();

        uint256 locked = job.lockedCollateral;
        // Cap enforced: payout can never exceed the locked collateral (E6).
        uint256 payout = job.guaranteeCap < locked ? job.guaranteeCap : locked;
        if (payout == 0) revert Errors.ZeroPayout();
        uint256 refund = locked - payout;

        // Effects BEFORE interactions: latch + terminal state (CEI + E5 idempotency).
        settled[jobId] = true;
        job.state = State.Settled;

        emit RegressionProven(jobId, job.provider, job.client, payout);

        // Interactions. Conservation: paid + refund == lockedAtSettle.
        usdc.safeTransfer(job.client, payout);
        emit GuaranteePaid(jobId, job.client, payout);

        if (refund > 0) {
            usdc.safeTransfer(job.provider, refund);
            emit GuaranteeReleased(jobId, job.provider, refund);
        }
    }

    /// @notice Provider reclaims collateral after the coverage window closes with no
    ///         proven regression (plan E3).
    function releaseGuarantee(uint256 jobId) external nonReentrant {
        Job storage job = _jobs[jobId];
        if (settled[jobId]) revert Errors.AlreadySettled();
        if (job.state != State.CoverageOpen) revert Errors.BadState();
        if (msg.sender != job.provider) revert Errors.NotProvider();
        if (block.timestamp <= job.coverageDeadline) revert Errors.CoverageWindowOpen();

        uint256 amount = job.lockedCollateral;
        if (amount == 0) revert Errors.ZeroAmount();

        settled[jobId] = true;
        job.state = State.Settled;

        usdc.safeTransfer(job.provider, amount);

        emit GuaranteeReleased(jobId, job.provider, amount);
    }

    /// @notice Client reclaims the task fee if the provider never locked collateral by the
    ///         funding deadline (plan §17.6 M4, edge case E2).
    function cancelUnfundedJob(uint256 jobId) external nonReentrant {
        Job storage job = _jobs[jobId];
        if (job.state != State.Created) revert Errors.BadState();
        if (msg.sender != job.client) revert Errors.NotClient();
        if (block.timestamp <= job.fundingDeadline) revert Errors.FundingWindowNotElapsed();

        uint256 refund = job.taskFee;
        job.state = State.Cancelled;

        usdc.safeTransfer(job.client, refund);

        emit JobCancelled(jobId, job.client, refund);
    }

    // ------------------------------------------------------------------ //
    //                              Admin                                 //
    // ------------------------------------------------------------------ //

    /// @notice Sets the authorized report transport (KeystoneForwarder or relay).
    function setForwarder(address newForwarder) external onlyOwner {
        _setForwarder(newForwarder);
    }

    /// @notice Binds settlement to a specific workflow identity (id + owner).
    function setExpectedWorkflow(bytes32 workflowId, address workflowOwner) external onlyOwner {
        _setExpectedWorkflow(workflowId, workflowOwner);
    }

    /// @notice Updates the coverage window duration for FUTURE jobs only.
    /// @dev Does not retroactively move in-flight `coverageDeadline`s (plan §17.6 H5).
    function setCoverageWindow(uint64 newWindow) external onlyOwner {
        if (newWindow == 0) revert Errors.ZeroAmount();
        emit CoverageWindowUpdated(coverageWindow, newWindow);
        coverageWindow = newWindow;
    }

    /// @notice Updates the funding window duration for FUTURE jobs only.
    function setFundingWindow(uint64 newWindow) external onlyOwner {
        if (newWindow == 0) revert Errors.ZeroAmount();
        emit FundingWindowUpdated(fundingWindow, newWindow);
        fundingWindow = newWindow;
    }

    // ------------------------------------------------------------------ //
    //                          ERC-165 / Ownable                         //
    // ------------------------------------------------------------------ //

    /// @inheritdoc ReceiverBase
    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
