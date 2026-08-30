// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";

/// @notice Deployment entry point for a local or dedicated V4 PoolManager.
contract MarketplacePoolManager is PoolManager {
    constructor(address initialOwner) PoolManager(initialOwner) {}
}
