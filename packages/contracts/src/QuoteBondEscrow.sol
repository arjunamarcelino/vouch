// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Errors} from "./libraries/Errors.sol";

/// @title QuoteBondEscrow
/// @author Vouch
/// @notice Holds a small, refundable USDC bond the risk-quotation agent posts per signed quote —
///         capital at stake that the quote is honored (Vouch plan §7). This is the agent's OWN money;
///         it is NEVER guarantee principal (that lives in AssuranceHub on the DON-signed path), so this
///         contract is fully decoupled from settlement (ADR-004/005 untouched).
///
///         `quoteId` is the single-use nonce: a slot can hold at most one live bond, so a replayed
///         `postBond` reverts (on-chain replay backstop). USDC moves via the ERC-20 interface
///         (`safeTransferFrom`), never `msg.value` — even though USDC is Arc's native gas token, the
///         two balances must not be conflated.
///
///         Lifecycle (both permissionless, CEI + nonReentrant): `postBond` → (after `expiresAt`)
///         `refundBond` → recorded poster. Slashing / early release were intentionally removed until a
///         dispute mechanism exists (review 043); re-add behind a role when needed.
contract QuoteBondEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Bond {
        address poster; // slot 0 (20 bytes) ...
        uint64 expiresAt; // ... + 8 bytes → packs with poster
        uint256 amount; // slot 1
    }

    IERC20 public immutable usdc;

    mapping(bytes32 quoteId => Bond) public bonds;

    event BondPosted(bytes32 indexed quoteId, address indexed poster, uint256 amount, uint64 expiresAt);
    event BondRefunded(bytes32 indexed quoteId, address indexed poster, uint256 amount);

    constructor(IERC20 usdc_) {
        if (address(usdc_) == address(0)) revert Errors.ZeroAddress();
        usdc = usdc_;
    }

    /// @notice Post a refundable bond for `quoteId`. Reverts on a duplicate/replayed post.
    function postBond(bytes32 quoteId, uint256 amount, uint64 expiresAt) external nonReentrant {
        if (amount == 0) revert Errors.ZeroAmount();
        if (bonds[quoteId].amount != 0) revert Errors.BondExists(); // quoteId is the single-use nonce
        if (expiresAt <= block.timestamp) revert Errors.InvalidExpiry();

        bonds[quoteId] = Bond({poster: msg.sender, expiresAt: expiresAt, amount: amount});
        emit BondPosted(quoteId, msg.sender, amount, expiresAt);
        usdc.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice Permissionless refund AFTER expiry. Pays the original poster (not `msg.sender`).
    function refundBond(bytes32 quoteId) external nonReentrant {
        Bond memory b = bonds[quoteId];
        if (b.amount == 0) revert Errors.BondNotFound();
        if (block.timestamp < b.expiresAt) revert Errors.NotExpiredYet();

        delete bonds[quoteId]; // effects before interaction (CEI)
        emit BondRefunded(quoteId, b.poster, b.amount);
        usdc.safeTransfer(b.poster, b.amount);
    }
}
