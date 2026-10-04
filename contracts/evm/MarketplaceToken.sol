// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {ERC20PermitUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {VotesUpgradeable} from "@openzeppelin/contracts-upgradeable/governance/utils/VotesUpgradeable.sol";
import {ERC2771ContextUpgradeable} from "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import {ContextUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import {NoncesUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/NoncesUpgradeable.sol";

contract MarketplaceToken is
    Initializable,
    ERC20Upgradeable,
    ERC20PermitUpgradeable,
    VotesUpgradeable,
    OwnableUpgradeable,
    UUPSUpgradeable,
    ERC2771ContextUpgradeable
{
    uint256 public constant DEFAULT_INITIAL_SUPPLY = 21_000_000 ether;

    bool public upgradesEnabled;
    bool public upgradesPermanentlyDisabled;
    address public governance;
    mapping(address => uint256) private _soulboundBalances;
    mapping(address => uint256) public soulboundSince;

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
    error GovernanceAlreadySet();
    error VotingSupplyTooLarge();

    /// @custom:oz-upgrades-unsafe-allow constructor state-variable-immutable
    constructor(
        address trustedForwarder_
    ) ERC2771ContextUpgradeable(trustedForwarder_) {
        _disableInitializers();
    }

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
        if (initialSupply > type(uint208).max) revert VotingSupplyTooLarge();
        if (initialOwner == address(0)) revert InvalidOwner();

        __ERC20_init(name_, symbol_);
        __ERC20Permit_init(name_);
        __Votes_init();
        __Ownable_init(initialOwner);
        _mint(initialOwner, initialSupply);
    }

    function setGovernance(address governance_) external onlyOwner {
        if (governance != address(0)) revert GovernanceAlreadySet();
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
        _soulbound(_msgSender(), amount);
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
        if (_soulboundBalances[account] == 0) soulboundSince[account] = 0;
        _transferVotingUnits(account, address(0), amount);
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

    modifier onlyGovernance() {
        if (_msgSender() != governance) revert GovernanceOnly();
        _;
    }

    function _soulbound(address account, uint256 amount) internal {
        if (amount == 0) revert InvalidAmount();
        uint256 liquidBalance =
            balanceOf(account) - _soulboundBalances[account];
        if (amount > liquidBalance)
            revert InsufficientLiquidBalance(liquidBalance, amount);
        _soulboundBalances[account] += amount;
        if (soulboundSince[account] == 0)
            soulboundSince[account] = block.timestamp;
        _transferVotingUnits(address(0), account, amount);
        if (delegates(account) == address(0)) {
            _delegate(account, account);
        }
        emit TokensSoulbound(account, amount);
    }

    function _getVotingUnits(
        address account
    ) internal view override returns (uint256) {
        return _soulboundBalances[account];
    }

    function _update(
        address from,
        address to,
        uint256 value
    ) internal override(ERC20Upgradeable) {
        if (from != address(0)) {
            uint256 liquidBalance = balanceOf(from) - _soulboundBalances[from];
            if (value > liquidBalance)
                revert InsufficientLiquidBalance(liquidBalance, value);
        }
        ERC20Upgradeable._update(from, to, value);
    }

    function _msgSender()
        internal
        view
        override(ContextUpgradeable, ERC2771ContextUpgradeable)
        returns (address)
    {
        return ERC2771ContextUpgradeable._msgSender();
    }

    function _msgData()
        internal
        view
        override(ContextUpgradeable, ERC2771ContextUpgradeable)
        returns (bytes calldata)
    {
        return ERC2771ContextUpgradeable._msgData();
    }

    function _contextSuffixLength()
        internal
        view
        override(ContextUpgradeable, ERC2771ContextUpgradeable)
        returns (uint256)
    {
        return ERC2771ContextUpgradeable._contextSuffixLength();
    }

    function nonces(
        address owner
    )
        public
        view
        override(ERC20PermitUpgradeable, NoncesUpgradeable)
        returns (uint256)
    {
        return super.nonces(owner);
    }

    function clock() public view override returns (uint48) {
        return uint48(block.timestamp);
    }

    // solhint-disable-next-line func-name-mixedcase
    function CLOCK_MODE() public pure override returns (string memory) {
        return "mode=timestamp";
    }

    function decimals() public pure override returns (uint8) {
        return 18;
    }
}
