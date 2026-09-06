// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @notice DAO-controlled, upgradeable reward token for rooted marketplace token holders.
contract MarketplaceLPToken is
    Initializable,
    ERC20Upgradeable,
    UUPSUpgradeable
{
    address public dao;
    bool public upgradesEnabled;
    bool public upgradesPermanentlyDisabled;

    error InvalidDAO();
    error DAOOnly();
    error MinterOnly();
    error UpgradesDisabled();
    error UpgradesAlreadyDisabled();
    error UpgradesPermanentlyDisabledError();

    event GovernanceUpdated(address indexed dao);
    event UpgradesEnabled();
    event UpgradesPermanentlyDisabled();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address dao_) external initializer {
        if (dao_ == address(0)) revert InvalidDAO();
        __ERC20_init("Marketplace LP Token", "MLP");
        dao = dao_;
        emit GovernanceUpdated(dao_);
    }

    function mint(address account, uint256 amount) external onlyDAO {
        _mint(account, amount);
    }

    function enableUpgrades() external onlyDAO {
        if (upgradesPermanentlyDisabled)
            revert UpgradesPermanentlyDisabledError();
        upgradesEnabled = true;
        emit UpgradesEnabled();
    }

    function disableUpgradesPermanently() external onlyDAO {
        if (upgradesPermanentlyDisabled || !upgradesEnabled)
            revert UpgradesAlreadyDisabled();
        upgradesEnabled = false;
        upgradesPermanentlyDisabled = true;
        emit UpgradesPermanentlyDisabled();
    }

    function _authorizeUpgrade(address) internal view override onlyDAO {
        if (!upgradesEnabled) revert UpgradesDisabled();
    }

    modifier onlyDAO() {
        if (msg.sender != dao) revert DAOOnly();
        _;
    }
}
