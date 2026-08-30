// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {ERC20PermitUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

contract MarketplaceToken is
    Initializable,
    ERC20Upgradeable,
    ERC20PermitUpgradeable,
    OwnableUpgradeable,
    UUPSUpgradeable
{
    uint256 public constant DEFAULT_INITIAL_SUPPLY = 21_000_000 ether;

    bool public upgradesEnabled;
    bool public upgradesPermanentlyDisabled;

    error UpgradesDisabled();
    error UpgradesAlreadyDisabled();
    error UpgradesPermanentlyDisabledError();
    error InvalidInitialSupply();
    error InvalidOwner();

    event UpgradesEnabled();
    event UpgradesPermanentlyDisabled();

    /// @notice Initializes the fixed-supply token and assigns all supply to the deployer-selected owner.
    function initialize(
        string calldata name_,
        string calldata symbol_,
        address initialOwner,
        uint256 initialSupply
    ) external initializer {
        if (initialSupply == 0) revert InvalidInitialSupply();
        if (initialOwner == address(0)) revert InvalidOwner();

        __ERC20_init(name_, symbol_);
        __ERC20Permit_init(name_);
        __Ownable_init(initialOwner);
        _mint(initialOwner, initialSupply);
    }

    function enableUpgrades() external onlyOwner {
        if (upgradesPermanentlyDisabled)
            revert UpgradesPermanentlyDisabledError();
        upgradesEnabled = true;
        emit UpgradesEnabled();
    }

    function disableUpgradesPermanently() external onlyOwner {
        if (upgradesPermanentlyDisabled || !upgradesEnabled)
            revert UpgradesAlreadyDisabled();
        upgradesEnabled = false;
        upgradesPermanentlyDisabled = true;
        emit UpgradesPermanentlyDisabled();
    }

    function _authorizeUpgrade(address) internal view override onlyOwner {
        if (!upgradesEnabled) revert UpgradesDisabled();
    }

    function decimals() public pure override returns (uint8) {
        return 18;
    }
}
