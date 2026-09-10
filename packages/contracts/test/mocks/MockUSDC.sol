// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockUSDC
/// @notice Minimal 6-decimal ERC-20 mock for local Foundry tests. Models the USDC
///         ERC-20 interface (6 decimals) used by AssuranceHub accounting.
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USD Coin", "USDC") {}

    /// @inheritdoc ERC20
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Freely mint test balances.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
