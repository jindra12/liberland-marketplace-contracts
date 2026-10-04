// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {ERC2771ContextUpgradeable} from "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import {ContextUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice DAO-controlled, upgradeable reward token for rooted marketplace token holders.
contract MarketplaceLPToken is
    Initializable,
    ERC20Upgradeable,
    UUPSUpgradeable,
    ERC2771ContextUpgradeable
{
    using SafeERC20 for IERC20;

    address public dao;
    IERC20 public redemptionToken;
    uint256 public redemptionRate;
    bool public upgradesEnabled;
    bool public upgradesPermanentlyDisabled;

    error InvalidDAO();
    error DAOOnly();
    error MinterOnly();
    error UpgradesDisabled();
    error UpgradesAlreadyDisabled();
    error UpgradesPermanentlyDisabledError();
    error InvalidRedemption();
    error InsufficientRedemptionReserve(uint256 available, uint256 required);
    error RedemptionSlippage(uint256 minimum, uint256 actual);

    event GovernanceUpdated(address indexed dao);
    event UpgradesEnabled();
    event UpgradesPermanentlyDisabled();
    event RedemptionRateUpdated(uint256 amountPerRewardToken);
    event TokensRedeemed(
        address indexed account,
        uint256 rewardAmount,
        uint256 assetAmount
    );

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(
        address trustedForwarder_
    ) ERC2771ContextUpgradeable(trustedForwarder_) {
        _disableInitializers();
    }

    function initialize(
        address dao_,
        address redemptionToken_
    ) external initializer {
        if (dao_ == address(0) || redemptionToken_ == address(0))
            revert InvalidDAO();
        __ERC20_init("Marketplace LP Token", "MLP");
        dao = dao_;
        redemptionToken = IERC20(redemptionToken_);
        emit GovernanceUpdated(dao_);
    }

    function mint(address account, uint256 amount) external onlyDAO {
        _mint(account, amount);
    }

    function setRedemptionRate(uint256 amountPerRewardToken) external onlyDAO {
        redemptionRate = amountPerRewardToken;
        emit RedemptionRateUpdated(amountPerRewardToken);
    }

    function redeem(
        uint256 rewardAmount,
        uint256 minimumAssetAmount
    ) external returns (uint256 assetAmount) {
        address account = _msgSender();
        if (rewardAmount == 0 || redemptionRate == 0)
            revert InvalidRedemption();
        assetAmount = Math.mulDiv(rewardAmount, redemptionRate, 1 ether);
        if (assetAmount < minimumAssetAmount)
            revert RedemptionSlippage(minimumAssetAmount, assetAmount);
        uint256 reserve = redemptionToken.balanceOf(address(this));
        if (assetAmount > reserve)
            revert InsufficientRedemptionReserve(reserve, assetAmount);

        _burn(account, rewardAmount);
        redemptionToken.safeTransfer(account, assetAmount);
        emit TokensRedeemed(account, rewardAmount, assetAmount);
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
        if (_msgSender() != dao) revert DAOOnly();
        _;
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
}
