// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {
    BalanceDelta,
    toBalanceDelta
} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {
    Currency,
    CurrencyLibrary
} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

contract MockPoolManager {
    using CurrencyLibrary for Currency;

    /// @notice Fixed output used by the test double to simulate a pool swap.
    uint128 public outputAmount;

    /// @notice Configures the output amount returned by simulated swaps.
    constructor(uint128 outputAmount_) {
        outputAmount = outputAmount_;
    }

    /// @notice Invokes the calling router's unlock callback with test data.
    function unlock(bytes calldata data) external returns (bytes memory) {
        return IUnlockCallback(msg.sender).unlockCallback(data);
    }

    /// @notice Returns a synthetic exact-input delta without changing test state.
    function swap(
        PoolKey memory,
        SwapParams memory params,
        bytes calldata
    ) external view returns (BalanceDelta) {
        int128 amountIn = int128(-params.amountSpecified);
        return toBalanceDelta(-amountIn, int128(outputAmount));
    }

    /// @notice Implements the PoolManager sync entrypoint as a no-op test stub.
    function sync(Currency) external {}

    /// @notice Accepts simulated native settlement and reports the received value.
    function settle() external payable returns (uint256) {
        return msg.value;
    }

    /// @notice Transfers the configured output asset to the swap recipient.
    function take(
        Currency currency,
        address recipient,
        uint256 amount
    ) external {
        IERC20(Currency.unwrap(currency)).transfer(recipient, amount);
    }
}
