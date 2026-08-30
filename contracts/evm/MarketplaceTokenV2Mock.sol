// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MarketplaceToken} from "./MarketplaceToken.sol";

/// @custom:oz-upgrades-unsafe-allow missing-initializer
contract MarketplaceTokenV2Mock is MarketplaceToken {
    /// @custom:oz-upgrades-validate-as-initializer
    function initializeV2() external reinitializer(2) {}

    function version() external pure returns (uint256) {
        return 2;
    }
}
