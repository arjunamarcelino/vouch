// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title ReentrantUSDC
/// @notice Malicious 6-decimal ERC-20: on the next `_update` (outbound transfer leg) it re-enters
///         `target` with `data` and BUBBLES any revert, proving the nonReentrant guard trips on
///         every outbound path.
contract ReentrantUSDC is ERC20 {
    address public target;
    bytes public data;
    bool public armed;

    constructor() ERC20("Reentrant USD Coin", "rUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @notice Arm a one-shot re-entry into `target_.call(data_)` on the next transfer.
    function arm(address target_, bytes calldata data_) external {
        target = target_;
        data = data_;
        armed = true;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (armed) {
            armed = false; // one-shot
            (bool ok, bytes memory ret) = target.call(data);
            if (!ok) {
                assembly {
                    revert(add(ret, 0x20), mload(ret)) // bubble ReentrancyGuardReentrantCall
                }
            }
        }
        super._update(from, to, value);
    }
}
