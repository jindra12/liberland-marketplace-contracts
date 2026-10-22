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
    /// @notice Default fixed supply for a marketplace token deployment.
    uint256 public constant DEFAULT_INITIAL_SUPPLY = 21_000_000 ether;

    /// @notice Whether DAO governance currently permits implementation upgrades.
    bool public upgradesEnabled;
    /// @notice Whether upgrades have been irreversibly disabled by governance.
    bool public upgradesPermanentlyDisabled;
    /// @notice DAO address authorized to manage soulbound balances and upgrades.
    address public governance;
    mapping(address => uint256) private _soulboundBalances;
    /// @notice Timestamp when the account's current continuous soulbound period began.
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
    /// @notice Locks the implementation and records the sole trusted ERC-2771 forwarder.
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

    /// @notice Initializes token metadata, ownership, and the fixed initial supply once.
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

    /// @notice Sets the DAO exactly once; the owner must subsequently transfer ownership to it.
    function setGovernance(address governance_) external onlyOwner {
        if (governance != address(0)) revert GovernanceAlreadySet();
        if (governance_ == address(0)) revert InvalidGovernance();
        governance = governance_;
        emit GovernanceUpdated(governance_);
    }

    /// @notice Returns the non-transferable balance counted for governance voting.
    function soulboundBalanceOf(
        address account
    ) external view returns (uint256) {
        return _soulboundBalances[account];
    }

    /// @notice Returns the account's transferable balance, excluding its rooted tokens.
    function liquidBalanceOf(address account) external view returns (uint256) {
        return balanceOf(account) - _soulboundBalances[account];
    }

    /// @notice Roots caller-owned liquid tokens so they cannot transfer and count as votes.
    function soulbound(uint256 amount) external {
        _soulbound(_msgSender(), amount);
    }

    /// @notice Roots tokens for an account as a DAO-authorized grant or pre-bound allocation.
    function soulboundFor(
        address account,
        uint256 amount
    ) external onlyGovernance {
        _soulbound(account, amount);
    }

    /// @notice Releases rooted tokens from voting weight; only DAO execution may call this.
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

    /// @notice Temporarily enables UUPS upgrades through an authorized DAO call.
    function enableUpgrades() external onlyGovernance {
        if (upgradesPermanentlyDisabled)
            revert UpgradesPermanentlyDisabledError();
        upgradesEnabled = true;
        emit UpgradesEnabled();
    }

    /// @notice Irreversibly disables future UUPS upgrades through DAO execution.
    function disableUpgradesPermanently() external onlyGovernance {
        if (upgradesPermanentlyDisabled || !upgradesEnabled)
            revert UpgradesAlreadyDisabled();
        upgradesEnabled = false;
        upgradesPermanentlyDisabled = true;
        emit UpgradesPermanentlyDisabled();
    }

    /// @dev Restricts implementation changes to enabled DAO-authorized calls.
    function _authorizeUpgrade(address) internal view override onlyGovernance {
        if (!upgradesEnabled) revert UpgradesDisabled();
    }

    /// @dev Limits privileged token controls to the configured DAO contract.
    modifier onlyGovernance() {
        if (_msgSender() != governance) revert GovernanceOnly();
        _;
    }

    /// @dev Moves liquid units into the rooted balance and updates voting checkpoints.
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

    /// @dev Makes rooted balances, rather than liquid ERC-20 balances, govern votes.
    function _getVotingUnits(
        address account
    ) internal view override returns (uint256) {
        return _soulboundBalances[account];
    }

    /// @dev Prevents ERC-20 transfers and burns from consuming the rooted balance.
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

    /// @dev Resolves the signer appended by the configured trusted forwarder.
    function _msgSender()
        internal
        view
        override(ContextUpgradeable, ERC2771ContextUpgradeable)
        returns (address)
    {
        return ERC2771ContextUpgradeable._msgSender();
    }

    /// @dev Removes the trusted-forwarder signer suffix from forwarded calldata.
    function _msgData()
        internal
        view
        override(ContextUpgradeable, ERC2771ContextUpgradeable)
        returns (bytes calldata)
    {
        return ERC2771ContextUpgradeable._msgData();
    }

    /// @dev Reports the signer suffix length expected by ERC-2771 context handling.
    function _contextSuffixLength()
        internal
        view
        override(ContextUpgradeable, ERC2771ContextUpgradeable)
        returns (uint256)
    {
        return ERC2771ContextUpgradeable._contextSuffixLength();
    }

    /// @notice Returns the shared EIP-2612 permit and Votes delegation nonce.
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

    /// @notice Returns timestamp-based voting time used by Governor snapshots.
    function clock() public view override returns (uint48) {
        return uint48(block.timestamp);
    }

    // solhint-disable-next-line func-name-mixedcase
    /// @notice Identifies timestamp mode to Governor and other ERC-6372 consumers.
    function CLOCK_MODE() public pure override returns (string memory) {
        return "mode=timestamp";
    }

    /// @notice Returns the token's fixed 18-decimal precision.
    function decimals() public pure override returns (uint8) {
        return 18;
    }
}
