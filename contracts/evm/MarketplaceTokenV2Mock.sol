// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MarketplaceToken} from "./MarketplaceToken.sol";

/// @custom:oz-upgrades-unsafe-allow missing-initializer
contract MarketplaceTokenV2Mock is MarketplaceToken {
    /// @notice Deploys the test-only upgrade target with the same trusted forwarder.
    constructor(
        address trustedForwarder_
    ) MarketplaceToken(trustedForwarder_) {}

    /// @notice Initializes test-only V2 storage after the implementation upgrade.
    /// @custom:oz-upgrades-validate-as-initializer
    /// @notice Exercises a versioned storage initializer after a proxy upgrade.
    function initializeV2() external reinitializer(2) {}

    /// @notice Identifies this test-only token implementation version.
    function version() external pure returns (uint256) {
        return 2;
    }
}
