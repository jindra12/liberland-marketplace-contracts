// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MarketplaceLPToken} from "./MarketplaceLPToken.sol";

/// @custom:oz-upgrades-unsafe-allow missing-initializer
contract MarketplaceLPTokenV2Mock is MarketplaceLPToken {
    /// @notice Deploys the test-only reward-token upgrade target.
    constructor(
        address trustedForwarder_
    ) MarketplaceLPToken(trustedForwarder_) {}

    /// @notice Identifies this test-only reward-token implementation version.
    /// @notice Returns the test-only implementation version marker.
    function version() external pure returns (uint256) {
        return 2;
    }
}
