// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title QuoteBondEscrow
/// @notice Holds a small, refundable USDC bond the risk-quotation agent posts per signed quote —
///         capital at stake that the quote is honored (Vouch plan §7). This is the agent's OWN money;
///         it is NEVER guarantee principal (that lives in AssuranceHub on the DON-signed path), so
///         this contract is fully decoupled from settlement (ADR-004/005 untouched).
///
///         `quoteId` is the single-use nonce: a slot can hold at most one live bond, so a replayed
///         `postBond` reverts (on-chain replay backstop). USDC is moved via the ERC-20 interface
///         (`safeTransferFrom`), never `msg.value` — even though USDC is Arc's native gas token, the
///         two balances must not be conflated.
///
///         Exit paths (all CEI + nonReentrant, all pay the RECORDED poster except slashing):
///           - refundBond   permissionless AFTER expiry            -> poster (quote lapsed unused)
///           - releaseBond  PROTOCOL_ROLE, any time                -> poster (quote honored by a job)
///           - consumeBond  PROTOCOL_ROLE, any time                -> slashSink (proven-bad quote)
contract QuoteBondEscrow is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant PROTOCOL_ROLE = keccak256("PROTOCOL_ROLE");

    struct Bond {
        address poster;
        uint256 amount;
        uint64 expiresAt;
    }

    IERC20 public immutable usdc;
    /// @notice Destination for forfeited (slashed) bonds. Never `feeRecipient`, never principal.
    address public immutable slashSink;

    mapping(bytes32 quoteId => Bond) public bonds;

    event BondPosted(bytes32 indexed quoteId, address indexed poster, uint256 amount, uint64 expiresAt);
    event BondRefunded(bytes32 indexed quoteId, address indexed poster, uint256 amount);
    event BondReleased(bytes32 indexed quoteId, address indexed poster, uint256 amount);
    event BondConsumed(bytes32 indexed quoteId, address indexed slashSink, uint256 amount);

    error ZeroAmount();
    error BondExists();
    error BondNotFound();
    error InvalidExpiry();
    error NotExpired();

    constructor(IERC20 usdc_, address admin, address slashSink_) {
        require(address(usdc_) != address(0) && admin != address(0) && slashSink_ != address(0), "zero");
        usdc = usdc_;
        slashSink = slashSink_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Post a refundable bond for `quoteId`. Reverts on a duplicate/replayed post.
    function postBond(bytes32 quoteId, uint256 amount, uint64 expiresAt) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (bonds[quoteId].amount != 0) revert BondExists(); // quoteId is the single-use nonce
        if (expiresAt <= block.timestamp) revert InvalidExpiry();

        bonds[quoteId] = Bond({poster: msg.sender, amount: amount, expiresAt: expiresAt});
        emit BondPosted(quoteId, msg.sender, amount, expiresAt);
        usdc.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice Permissionless refund AFTER expiry. Pays the original poster (not `msg.sender`).
    function refundBond(bytes32 quoteId) external nonReentrant {
        Bond memory b = bonds[quoteId];
        if (b.amount == 0) revert BondNotFound();
        if (block.timestamp < b.expiresAt) revert NotExpired();

        delete bonds[quoteId]; // effects before interaction (CEI)
        emit BondRefunded(quoteId, b.poster, b.amount);
        usdc.safeTransfer(b.poster, b.amount);
    }

    /// @notice Early return of a bond whose quote was honored by an opened job. PROTOCOL_ROLE only.
    function releaseBond(bytes32 quoteId) external nonReentrant onlyRole(PROTOCOL_ROLE) {
        Bond memory b = bonds[quoteId];
        if (b.amount == 0) revert BondNotFound();

        delete bonds[quoteId];
        emit BondReleased(quoteId, b.poster, b.amount);
        usdc.safeTransfer(b.poster, b.amount);
    }

    /// @notice Slash a bond backing a proven-bad quote. PROTOCOL_ROLE only; sends to `slashSink`.
    function consumeBond(bytes32 quoteId) external nonReentrant onlyRole(PROTOCOL_ROLE) {
        Bond memory b = bonds[quoteId];
        if (b.amount == 0) revert BondNotFound();

        delete bonds[quoteId];
        emit BondConsumed(quoteId, slashSink, b.amount);
        usdc.safeTransfer(slashSink, b.amount);
    }
}
