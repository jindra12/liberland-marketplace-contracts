// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IMarketplaceDAO {
    /// @notice Returns the DAO-minted reward token address.
    function rewardToken() external view returns (address);

    /// @notice Claims the caller's earned reward after the required rooted period.
    function claimReward() external;
}
