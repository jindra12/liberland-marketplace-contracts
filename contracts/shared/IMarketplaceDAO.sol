// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IMarketplaceDAO {
    function rewardToken() external view returns (address);
    function claimReward() external;
}
