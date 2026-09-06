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
    address public governance;
    mapping(address => uint256) private _soulboundBalances;

    error UpgradesDisabled();
    error UpgradesAlreadyDisabled();
    error UpgradesPermanentlyDisabledError();
    error InvalidInitialSupply();
    error InvalidOwner();
    error InvalidGovernance();
    error InvalidAmount();
    error InsufficientLiquidBalance(uint256 available, uint256 requested);
    error InsufficientSoulboundBalance(uint256 available, uint256 requested);
    error GovernanceOnly();

    event UpgradesEnabled();
    event UpgradesPermanentlyDisabled();
    event GovernanceUpdated(address indexed governance);
    event TokensSoulbound(address indexed account, uint256 amount);
    event TokensUnsoulbound(address indexed account, uint256 amount);

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

    function setGovernance(address governance_) external onlyOwner {
        if (governance_ == address(0)) revert InvalidGovernance();
        governance = governance_;
        emit GovernanceUpdated(governance_);
    }

    function soulboundBalanceOf(
        address account
    ) external view returns (uint256) {
        return _soulboundBalances[account];
    }

    function liquidBalanceOf(address account) external view returns (uint256) {
        return balanceOf(account) - _soulboundBalances[account];
    }

    function soulbound(uint256 amount) external {
        _soulbound(msg.sender, amount);
    }

    function soulboundFor(
        address account,
        uint256 amount
    ) external onlyGovernance {
        _soulbound(account, amount);
    }

    function unsoulbound(
        address account,
        uint256 amount
    ) external onlyGovernance {
        if (amount == 0) revert InvalidAmount();
        uint256 current = _soulboundBalances[account];
        if (amount > current)
            revert InsufficientSoulboundBalance(current, amount);
        unchecked {
            _soulboundBalances[account] = current - amount;
        }
        emit TokensUnsoulbound(account, amount);
    }

    function enableUpgrades() external onlyGovernance {
        if (upgradesPermanentlyDisabled)
            revert UpgradesPermanentlyDisabledError();
        upgradesEnabled = true;
        emit UpgradesEnabled();
    }

    function disableUpgradesPermanently() external onlyGovernance {
        if (upgradesPermanentlyDisabled || !upgradesEnabled)
            revert UpgradesAlreadyDisabled();
        upgradesEnabled = false;
        upgradesPermanentlyDisabled = true;
        emit UpgradesPermanentlyDisabled();
    }

    function _authorizeUpgrade(address) internal view override onlyGovernance {
        if (!upgradesEnabled) revert UpgradesDisabled();
    }

    function _update(
        address from,
        address to,
        uint256 value
    ) internal override {
        if (from != address(0)) {
            uint256 liquidBalance = balanceOf(from) - _soulboundBalances[from];
            if (value > liquidBalance)
                revert InsufficientLiquidBalance(liquidBalance, value);
        }
        super._update(from, to, value);
    }

    modifier onlyGovernance() {
        if (msg.sender != governance) revert GovernanceOnly();
        _;
    }

    function _soulbound(address account, uint256 amount) internal {
        if (amount == 0) revert InvalidAmount();
        uint256 liquidBalance =
            balanceOf(account) - _soulboundBalances[account];
        if (amount > liquidBalance)
            revert InsufficientLiquidBalance(liquidBalance, amount);
        _soulboundBalances[account] += amount;
        emit TokensSoulbound(account, amount);
    }

    function decimals() public pure override returns (uint8) {
        return 18;
    }
}
