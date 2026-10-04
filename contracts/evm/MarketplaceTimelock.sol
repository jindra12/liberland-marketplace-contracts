// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {TimelockControllerUpgradeable} from "@openzeppelin/contracts-upgradeable/governance/TimelockControllerUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @notice Timelock whose upgrades can only be authorized by a scheduled self-call.
contract MarketplaceTimelock is
    Initializable,
    TimelockControllerUpgradeable,
    UUPSUpgradeable
{
    bool public upgradesEnabled;
    bool public upgradesPermanentlyDisabled;

    error TimelockSelfCallOnly();
    error TimelockUpgradesDisabled();
    error TimelockUpgradesPermanentlyDisabled();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        uint256 minDelay,
        address[] memory proposers,
        address[] memory executors,
        address admin
    ) public override initializer {
        __TimelockController_init(minDelay, proposers, executors, admin);
    }

    function enableUpgrades() external {
        if (msg.sender != address(this)) revert TimelockSelfCallOnly();
        if (upgradesPermanentlyDisabled)
            revert TimelockUpgradesPermanentlyDisabled();
        upgradesEnabled = true;
    }

    function disableUpgradesPermanently() external {
        if (msg.sender != address(this)) revert TimelockSelfCallOnly();
        upgradesEnabled = false;
        upgradesPermanentlyDisabled = true;
    }

    function _authorizeUpgrade(address) internal view override {
        if (msg.sender != address(this)) revert TimelockSelfCallOnly();
        if (!upgradesEnabled) revert TimelockUpgradesDisabled();
    }
}
