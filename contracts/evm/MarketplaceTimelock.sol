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
    /// @notice Whether DAO-approved self-execution currently permits implementation upgrades.
    bool public upgradesEnabled;
    /// @notice Whether the DAO has permanently frozen this timelock's implementation.
    bool public upgradesPermanentlyDisabled;

    error TimelockSelfCallOnly();
    error TimelockUpgradesDisabled();
    error TimelockUpgradesPermanentlyDisabled();

    /// @custom:oz-upgrades-unsafe-allow constructor
    /// @notice Locks the implementation so initialization occurs only through a proxy.
    constructor() {
        _disableInitializers();
    }

    /// @notice Initializes delay, governance roles, executor policy, and temporary admin.
    function initialize(
        uint256 minDelay,
        address[] memory proposers,
        address[] memory executors,
        address admin
    ) public override initializer {
        __TimelockController_init(minDelay, proposers, executors, admin);
    }

    /// @notice Enables an upgrade only when invoked by a scheduled operation targeting itself.
    function enableUpgrades() external {
        if (msg.sender != address(this)) revert TimelockSelfCallOnly();
        if (upgradesPermanentlyDisabled)
            revert TimelockUpgradesPermanentlyDisabled();
        upgradesEnabled = true;
    }

    /// @notice Permanently freezes upgrades through a scheduled self-call.
    function disableUpgradesPermanently() external {
        if (msg.sender != address(this)) revert TimelockSelfCallOnly();
        upgradesEnabled = false;
        upgradesPermanentlyDisabled = true;
    }

    /// @dev Requires both a prior upgrade enablement and timelock self-execution.
    function _authorizeUpgrade(address) internal view override {
        if (msg.sender != address(this)) revert TimelockSelfCallOnly();
        if (!upgradesEnabled) revert TimelockUpgradesDisabled();
    }
}
