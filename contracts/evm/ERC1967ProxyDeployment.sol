// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// @notice Gives the browser deployment package a stable proxy artifact.
contract ERC1967ProxyDeployment is ERC1967Proxy {
    /// @notice Deploys an ERC-1967 proxy and atomically delegatecalls its initializer.
    constructor(
        address implementation,
        bytes memory data
    ) ERC1967Proxy(implementation, data) {}
}
