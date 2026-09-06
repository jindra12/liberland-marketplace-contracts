// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MarketplaceLPToken} from "./MarketplaceLPToken.sol";

/// @custom:oz-upgrades-unsafe-allow missing-initializer
contract MarketplaceLPTokenV2Mock is MarketplaceLPToken {
    function version() external pure returns (uint256) {
        return 2;
    }
}
