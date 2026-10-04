// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC2771Forwarder} from "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";

/// @notice OpenZeppelin ERC-2771 forwarder for signed, relayed user transactions.
contract MarketplaceForwarder is ERC2771Forwarder {
    constructor() ERC2771Forwarder("Liberland Marketplace Forwarder") {}
}
