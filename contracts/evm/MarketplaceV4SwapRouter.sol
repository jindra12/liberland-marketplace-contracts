// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {ERC2771ContextUpgradeable} from "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import {ContextUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {
    BalanceDelta,
    BalanceDeltaLibrary
} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {
    Currency,
    CurrencyLibrary
} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

contract MarketplaceV4SwapRouter is
    Initializable,
    OwnableUpgradeable,
    UUPSUpgradeable,
    IUnlockCallback,
    ERC2771ContextUpgradeable
{
    using BalanceDeltaLibrary for BalanceDelta;
    using CurrencyLibrary for Currency;
    using SafeERC20 for IERC20;

    /// @notice Uniswap V4 PoolManager responsible for pool accounting and unlock callbacks.
    IPoolManager public poolManager;
    /// @notice One-time configured DAO address allowed to set fees and upgrade this router.
    address public governance;
    /// @notice Address receiving the configured swap fee.
    address public feeRecipient;
    /// @notice Swap fee in basis points, capped at ten percent.
    uint256 public feeBps;
    /// @notice Whether DAO governance currently permits implementation upgrades.
    bool public upgradesEnabled;
    /// @notice Whether DAO governance has permanently frozen implementation upgrades.
    bool public upgradesPermanentlyDisabled;
    uint256 private _reentrancyStatus;

    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    error InvalidPoolManager();
    error InvalidAmount();
    error InvalidValue();
    error InsufficientOutput(uint256 minimum, uint256 actual);
    error InvalidCallbackCaller();
    error InvalidSwapDelta();
    error UpgradesDisabled();
    error UpgradesAlreadyDisabled();
    error UpgradesPermanentlyDisabledError();
    error ReentrantCall();
    error GovernanceOnly();
    error InvalidGovernance();
    error InvalidFee();
    error FeeTransferFailed();
    error GovernanceAlreadySet();

    event SwapExecuted(
        address indexed sender,
        PoolKey poolKey,
        bool zeroForOne,
        uint256 amountIn,
        uint256 amountOut
    );
    event UpgradesEnabled();
    event UpgradesPermanentlyDisabled();
    event GovernanceUpdated(address indexed governance);
    event FeeUpdated(uint256 feeBps, address indexed recipient);

    struct SwapRequest {
        PoolKey key;
        bool zeroForOne;
        uint128 amountIn;
        uint128 amountOutMinimum;
        bytes hookData;
        address payer;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor state-variable-immutable
    /// @notice Locks the implementation and records the trusted ERC-2771 forwarder.
    constructor(
        address trustedForwarder_
    ) ERC2771ContextUpgradeable(trustedForwarder_) {
        _disableInitializers();
    }

    /// @notice Initializes the PoolManager and initial owner once behind a proxy.
    function initialize(
        IPoolManager poolManager_,
        address initialOwner
    ) external initializer {
        if (address(poolManager_) == address(0) || initialOwner == address(0))
            revert InvalidPoolManager();

        __Ownable_init(initialOwner);
        _reentrancyStatus = _NOT_ENTERED;
        poolManager = poolManager_;
    }

    /// @notice Swaps one input currency for output through V4 and enforces the caller's minimum.
    function swapExactInputSingle(
        PoolKey calldata key,
        bool zeroForOne,
        uint128 amountIn,
        uint128 amountOutMinimum,
        bytes calldata hookData
    ) external payable returns (uint256 amountOut) {
        if (_reentrancyStatus == _ENTERED) revert ReentrantCall();
        _reentrancyStatus = _ENTERED;
        if (amountIn == 0) revert InvalidAmount();
        Currency inputCurrency = zeroForOne ? key.currency0 : key.currency1;
        if (
            (inputCurrency.isAddressZero() && msg.value != amountIn) ||
            (!inputCurrency.isAddressZero() && msg.value != 0)
        ) revert InvalidValue();
        address sender = _msgSender();

        SwapRequest memory request = SwapRequest({
            key: key,
            zeroForOne: zeroForOne,
            amountIn: amountIn,
            amountOutMinimum: amountOutMinimum,
            hookData: hookData,
            payer: sender
        });

        bytes memory result = poolManager.unlock(abi.encode(request));
        amountOut = abi.decode(result, (uint256));
        emit SwapExecuted(sender, key, zeroForOne, amountIn, amountOut);
        _reentrancyStatus = _NOT_ENTERED;
    }

    /// @notice Settles the V4 unlock requested by this router; rejects every other caller.
    function unlockCallback(
        bytes calldata data
    ) external override returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert InvalidCallbackCaller();

        SwapRequest memory request = abi.decode(data, (SwapRequest));
        Currency inputCurrency =
            request.zeroForOne ? request.key.currency0 : request.key.currency1;
        Currency outputCurrency =
            request.zeroForOne ? request.key.currency1 : request.key.currency0;
        uint256 fee = (request.amountIn * feeBps) / 10_000;
        uint128 poolAmountIn = request.amountIn - uint128(fee);
        BalanceDelta delta = poolManager.swap(
            request.key,
            SwapParams(
                request.zeroForOne,
                -int256(uint256(poolAmountIn)),
                request.zeroForOne
                    ? TickMath.MIN_SQRT_PRICE + 1
                    : TickMath.MAX_SQRT_PRICE - 1
            ),
            request.hookData
        );

        int128 inputDelta =
            request.zeroForOne ? delta.amount0() : delta.amount1();
        int128 outputDelta =
            request.zeroForOne ? delta.amount1() : delta.amount0();
        if (inputDelta >= 0 || outputDelta <= 0) revert InvalidSwapDelta();

        uint256 amountIn = uint256(uint128(-inputDelta));
        uint256 amountOut = uint256(uint128(outputDelta));
        if (amountOut < request.amountOutMinimum)
            revert InsufficientOutput(request.amountOutMinimum, amountOut);

        _settle(inputCurrency, request.payer, amountIn);
        _collectFee(inputCurrency, request.payer, fee);
        poolManager.take(outputCurrency, request.payer, amountOut);

        return abi.encode(amountOut);
    }

    /// @notice Assigns the DAO exactly once before ownership is transferred to it.
    function setGovernance(address governance_) external onlyOwner {
        if (governance != address(0)) revert GovernanceAlreadySet();
        if (governance_ == address(0)) revert InvalidGovernance();
        governance = governance_;
        emit GovernanceUpdated(governance_);
    }

    /// @notice Configures the DAO-approved swap fee and recipient.
    function setFee(
        uint256 feeBps_,
        address feeRecipient_
    ) external onlyGovernance {
        if (feeBps_ > 1_000 || feeRecipient_ == address(0)) revert InvalidFee();
        feeBps = feeBps_;
        feeRecipient = feeRecipient_;
        emit FeeUpdated(feeBps_, feeRecipient_);
    }

    /// @notice Enables UUPS upgrades through the configured DAO.
    function enableUpgrades() external onlyGovernance {
        if (upgradesPermanentlyDisabled)
            revert UpgradesPermanentlyDisabledError();
        upgradesEnabled = true;
        emit UpgradesEnabled();
    }

    /// @notice Irreversibly disables future UUPS upgrades through the configured DAO.
    function disableUpgradesPermanently() external onlyGovernance {
        if (upgradesPermanentlyDisabled || !upgradesEnabled)
            revert UpgradesAlreadyDisabled();
        upgradesEnabled = false;
        upgradesPermanentlyDisabled = true;
        emit UpgradesPermanentlyDisabled();
    }

    /// @dev Settles the trader's input currency to the PoolManager.
    function _settle(
        Currency currency,
        address payer,
        uint256 amount
    ) internal {
        poolManager.sync(currency);
        if (currency.isAddressZero()) {
            if (address(this).balance < amount) revert InvalidAmount();
            poolManager.settle{value: amount}();
            return;
        }

        IERC20(Currency.unwrap(currency)).safeTransferFrom(
            payer,
            address(poolManager),
            amount
        );
        poolManager.settle();
    }

    /// @dev Transfers the computed fee directly from the trader to the configured recipient.
    function _collectFee(
        Currency currency,
        address payer,
        uint256 amount
    ) internal {
        if (amount == 0) return;
        if (currency.isAddressZero()) {
            (bool success, ) = payable(feeRecipient).call{value: amount}("");
            if (!success) revert FeeTransferFailed();
            return;
        }
        IERC20(Currency.unwrap(currency)).safeTransferFrom(
            payer,
            feeRecipient,
            amount
        );
    }

    /// @dev Allows implementation changes only when enabled by DAO governance.
    function _authorizeUpgrade(address) internal view override onlyGovernance {
        if (!upgradesEnabled) revert UpgradesDisabled();
    }

    /// @dev Limits fee and implementation controls to the configured DAO.
    modifier onlyGovernance() {
        if (_msgSender() != governance) revert GovernanceOnly();
        _;
    }

    /// @dev Resolves the signer appended by the trusted ERC-2771 forwarder.
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

    /// @dev Reports the ERC-2771 suffix length used by forwarded calls.
    function _contextSuffixLength()
        internal
        view
        override(ContextUpgradeable, ERC2771ContextUpgradeable)
        returns (uint256)
    {
        return ERC2771ContextUpgradeable._contextSuffixLength();
    }

    /// @notice Accepts native currency needed for PoolManager settlement or refunds.
    receive() external payable {}
}
