// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MarketplaceDAO} from "./MarketplaceDAO.sol";

/// @custom:oz-upgrades-unsafe-allow missing-initializer
contract MarketplaceDAOV2Mock is MarketplaceDAO {
    function version() external pure returns (uint256) {
        return 2;
    }
}
