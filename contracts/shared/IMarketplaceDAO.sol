// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IMarketplaceDAO {
    function token() external view returns (address);
    function rewardToken() external view returns (address);
    function propose(
        address target,
        uint256 value,
        bytes calldata data
    ) external returns (uint256);
    function vote(uint256 id, bool support) external;
    function execute(uint256 id) external payable;
    function claimReward() external;
}
