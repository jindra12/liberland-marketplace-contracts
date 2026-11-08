// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {StateView} from "@uniswap/v4-periphery/src/lens/StateView.sol";

/// @notice Offline infrastructure doubles installed only on the isolated Hardhat chain.
contract PositionManagerFixture {
    address public immutable poolManager;
    address public immutable permit2;
    constructor(address manager, address permits) {
        poolManager = manager;
        permit2 = permits;
    }
}

contract Permit2Fixture {
    event Approval(
        address token,
        address spender,
        uint160 amount,
        uint48 expiration
    );
    function approve(
        address token,
        address spender,
        uint160 amount,
        uint48 expiration
    ) external {
        emit Approval(token, spender, amount, expiration);
    }
}

contract StateViewFixture is StateView {
    constructor(IPoolManager manager) StateView(manager) {}
}
