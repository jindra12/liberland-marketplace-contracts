// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IV4Quoter} from "@uniswap/v4-periphery/src/interfaces/IV4Quoter.sol";
import {MockPoolManager} from "./MockPoolManager.sol";

/// @notice Test-only quoter that matches its configured mock pool's fixed output.
contract MockV4Quoter {
    MockPoolManager public immutable poolManager;

    /// @notice Associates quotes with the same manager used by the router under test.
    constructor(MockPoolManager manager) {
        poolManager = manager;
    }

    /// @notice Returns the mock pool output without approving or moving any assets.
    function quoteExactInputSingle(
        IV4Quoter.QuoteExactSingleParams calldata
    ) external view returns (uint256 amountOut, uint256 gasEstimate) {
        return (poolManager.outputAmount(), 100000);
    }
}
