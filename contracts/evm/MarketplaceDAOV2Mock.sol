// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MarketplaceDAO} from "./MarketplaceDAO.sol";

/// @custom:oz-upgrades-unsafe-allow missing-initializer
contract MarketplaceDAOV2Mock is MarketplaceDAO {
    /// @notice Deploys the test-only DAO upgrade target with the configured forwarder.
    constructor(address trustedForwarder_) MarketplaceDAO(trustedForwarder_) {}

    /// @notice Returns the test-only implementation version marker.
    /// @notice Identifies this test-only DAO implementation version.
    function implementationVersion() external pure returns (uint256) {
        return 2;
    }
}
