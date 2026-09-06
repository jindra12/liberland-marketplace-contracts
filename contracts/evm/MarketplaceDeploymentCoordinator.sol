// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC1967ProxyDeployment} from "./ERC1967ProxyDeployment.sol";
import {MarketplaceDAO} from "./MarketplaceDAO.sol";
import {MarketplaceToken} from "./MarketplaceToken.sol";
import {MarketplaceV4SwapRouter} from "./MarketplaceV4SwapRouter.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IMarketplaceToken} from "../shared/IMarketplaceToken.sol";

/// @notice Deploys and wires one complete EVM marketplace contract set.
/// @dev The coordinator is intentionally not upgradeable. The deployed marketplace
///      contracts use their own UUPS proxies and governance controls.
contract MarketplaceDeploymentCoordinator {
    uint256 public constant DEFAULT_INITIAL_SUPPLY = 21_000_000 ether;

    struct DeploymentParameters {
        string tokenName;
        string tokenSymbol;
        uint256 initialSupply;
        address initialOwner;
        address poolManager;
        bytes tokenImplementationCode;
        bytes daoImplementationCode;
        bytes rewardImplementationCode;
        bytes swapRouterImplementationCode;
        bytes poolManagerCode;
    }

    struct DeploymentAddresses {
        address token;
        address dao;
        address rewardToken;
        address swapRouter;
        address poolManager;
        address tokenImplementation;
        address daoImplementation;
        address rewardImplementation;
        address swapRouterImplementation;
    }

    error EmptyTokenName();
    error EmptyTokenSymbol();
    error InvalidOwner();
    error InvalidPoolManager();
    error DeploymentFailed();

    event MarketplaceDeployed(
        address indexed deployer,
        address indexed owner,
        DeploymentAddresses deployed,
        string tokenName,
        string tokenSymbol,
        uint256 initialSupply
    );

    function deployMarketplace(
        DeploymentParameters calldata parameters
    ) external returns (DeploymentAddresses memory deployed) {
        if (bytes(parameters.tokenName).length == 0) revert EmptyTokenName();
        if (bytes(parameters.tokenSymbol).length == 0)
            revert EmptyTokenSymbol();

        address owner =
            parameters.initialOwner == address(0)
                ? msg.sender
                : parameters.initialOwner;
        if (owner == address(0)) revert InvalidOwner();

        uint256 initialSupply =
            parameters.initialSupply == 0
                ? DEFAULT_INITIAL_SUPPLY
                : parameters.initialSupply;

        (deployed.token, deployed.tokenImplementation) = _deployToken(
            parameters.tokenName,
            parameters.tokenSymbol,
            initialSupply,
            parameters.tokenImplementationCode
        );
        (
            deployed.dao,
            deployed.rewardToken,
            deployed.daoImplementation,
            deployed.rewardImplementation
        ) = _deployDao(
            deployed.token,
            owner,
            parameters.daoImplementationCode,
            parameters.rewardImplementationCode
        );

        deployed.poolManager = parameters.poolManager;
        if (deployed.poolManager == address(0)) {
            if (parameters.poolManagerCode.length == 0)
                revert InvalidPoolManager();
            deployed.poolManager = _deployImplementation(
                parameters.poolManagerCode
            );
        }
        (
            deployed.swapRouter,
            deployed.swapRouterImplementation
        ) = _deploySwapRouter(
            deployed.poolManager,
            parameters.swapRouterImplementationCode
        );

        MarketplaceToken(deployed.token).setGovernance(deployed.dao);
        MarketplaceToken(deployed.token).transfer(owner, initialSupply);
        MarketplaceToken(deployed.token).transferOwnership(owner);
        MarketplaceV4SwapRouter(payable(deployed.swapRouter)).setGovernance(
            deployed.dao
        );
        MarketplaceV4SwapRouter(payable(deployed.swapRouter)).transferOwnership(
            owner
        );

        emit MarketplaceDeployed(
            msg.sender,
            owner,
            deployed,
            parameters.tokenName,
            parameters.tokenSymbol,
            initialSupply
        );
    }

    function _deployToken(
        string calldata tokenName,
        string calldata tokenSymbol,
        uint256 initialSupply,
        bytes calldata implementationCode
    ) internal returns (address token, address implementation) {
        implementation = _deployImplementation(implementationCode);
        bytes memory initialization = abi.encodeCall(
            MarketplaceToken.initialize,
            (tokenName, tokenSymbol, address(this), initialSupply)
        );
        token = address(
            new ERC1967ProxyDeployment(implementation, initialization)
        );
    }

    function _deployDao(
        address token,
        address owner,
        bytes calldata daoImplementationCode,
        bytes calldata rewardImplementationCode
    )
        internal
        returns (
            address dao,
            address rewardToken,
            address daoImplementationAddress,
            address rewardImplementationAddress
        )
    {
        rewardImplementationAddress = _deployImplementation(
            rewardImplementationCode
        );
        daoImplementationAddress = _deployImplementation(daoImplementationCode);
        bytes memory initialization = abi.encodeCall(
            MarketplaceDAO.initialize,
            (IMarketplaceToken(token), owner, rewardImplementationAddress)
        );
        dao = address(
            new ERC1967ProxyDeployment(daoImplementationAddress, initialization)
        );
        rewardToken = MarketplaceDAO(dao).rewardToken();
    }

    function _deploySwapRouter(
        address poolManager,
        bytes calldata implementationCode
    ) internal returns (address swapRouter, address implementation) {
        implementation = _deployImplementation(implementationCode);
        bytes memory initialization = abi.encodeCall(
            MarketplaceV4SwapRouter.initialize,
            (IPoolManager(poolManager), address(this))
        );
        swapRouter = address(
            new ERC1967ProxyDeployment(implementation, initialization)
        );
    }

    function _deployImplementation(
        bytes calldata creationCode
    ) internal returns (address implementation) {
        uint256 pointer;
        assembly {
            pointer := mload(0x40)
            calldatacopy(pointer, creationCode.offset, creationCode.length)
            implementation := create(0, pointer, creationCode.length)
            mstore(0x40, add(pointer, creationCode.length))
        }
        if (implementation == address(0)) revert DeploymentFailed();
    }
}
