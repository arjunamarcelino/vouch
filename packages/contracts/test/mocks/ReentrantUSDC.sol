// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface IReleaseGuarantee {
    function releaseGuarantee(uint256 jobId) external;
}

/// @title ReentrantUSDC
/// @notice A malicious 6-decimal ERC-20 that attempts to re-enter VouchCore during a
///         `transfer` (the outbound leg of a settlement), used to prove the
///         `nonReentrant` guard holds (plan E11).
contract ReentrantUSDC is ERC20 {
    address public target;
    uint256 public armedJobId;
    bool public armed;

    constructor() ERC20("Reentrant USD Coin", "rUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @notice Arm the token to re-enter `releaseGuarantee(jobId)` on the next transfer.
    function arm(address target_, uint256 jobId) external {
        target = target_;
        armedJobId = jobId;
        armed = true;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (armed) {
            armed = false; // one-shot to avoid infinite loop if the guard somehow passed
            IReleaseGuarantee(target).releaseGuarantee(armedJobId);
        }
        super._update(from, to, value);
    }
}
