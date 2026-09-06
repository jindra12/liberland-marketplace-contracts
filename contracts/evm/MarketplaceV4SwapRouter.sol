// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
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
    IUnlockCallback
{
    using BalanceDeltaLibrary for BalanceDelta;
    using CurrencyLibrary for Currency;
    using SafeERC20 for IERC20;

    IPoolManager public poolManager;
    address public governance;
    address public feeRecipient;
    uint256 public feeBps;
    bool public upgradesEnabled;
    bool public upgradesPermanentlyDisabled;
    uint256 private _reentrancyStatus;

    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    error InvalidPoolManager();
    error InvalidAmount();
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

        SwapRequest memory request = SwapRequest({
            key: key,
            zeroForOne: zeroForOne,
            amountIn: amountIn,
            amountOutMinimum: amountOutMinimum,
            hookData: hookData,
            payer: msg.sender
        });

        bytes memory result = poolManager.unlock(abi.encode(request));
        amountOut = abi.decode(result, (uint256));
        emit SwapExecuted(msg.sender, key, zeroForOne, amountIn, amountOut);
        _reentrancyStatus = _NOT_ENTERED;
    }

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

    function setGovernance(address governance_) external onlyOwner {
        if (governance != address(0) || governance_ == address(0))
            revert InvalidGovernance();
        governance = governance_;
        emit GovernanceUpdated(governance_);
    }

    function setFee(
        uint256 feeBps_,
        address feeRecipient_
    ) external onlyGovernance {
        if (feeBps_ > 1_000 || feeRecipient_ == address(0)) revert InvalidFee();
        feeBps = feeBps_;
        feeRecipient = feeRecipient_;
        emit FeeUpdated(feeBps_, feeRecipient_);
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

    function _authorizeUpgrade(address) internal view override onlyGovernance {
        if (!upgradesEnabled) revert UpgradesDisabled();
    }

    modifier onlyGovernance() {
        if (msg.sender != governance) revert GovernanceOnly();
        _;
    }

    receive() external payable {}
}
