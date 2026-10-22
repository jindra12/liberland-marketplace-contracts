// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IMarketplaceToken {
    /// @notice Returns total issued ERC-20 units, whether liquid or rooted.
    function totalSupply() external view returns (uint256);

    /// @notice Returns an account's combined liquid and rooted ERC-20 balance.
    function balanceOf(address account) external view returns (uint256);

    /// @notice Approves a spender for liquid-token transfers.
    function approve(address spender, uint256 amount) external returns (bool);

    /// @notice Transfers liquid tokens while preserving the sender's rooted balance.
    function transfer(
        address recipient,
        uint256 amount
    ) external returns (bool);

    /// @notice Transfers approved liquid tokens while preserving rooted balances.
    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) external returns (bool);

    /// @notice Returns the non-transferable portion used for voting and rewards.
    function soulboundBalanceOf(
        address account
    ) external view returns (uint256);

    /// @notice Returns when the current continuous rooted period began, or zero if unrooted.
    function soulboundSince(address account) external view returns (uint256);

    /// @notice Roots tokens for an account; callable only by the DAO.
    function soulboundFor(address account, uint256 amount) external;
}
