// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {ContextUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import {ERC2771ContextUpgradeable} from "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import {GovernorUpgradeable} from "@openzeppelin/contracts-upgradeable/governance/GovernorUpgradeable.sol";
import {GovernorSettingsUpgradeable} from "@openzeppelin/contracts-upgradeable/governance/extensions/GovernorSettingsUpgradeable.sol";
import {GovernorCountingSimpleUpgradeable} from "@openzeppelin/contracts-upgradeable/governance/extensions/GovernorCountingSimpleUpgradeable.sol";
import {GovernorVotesUpgradeable} from "@openzeppelin/contracts-upgradeable/governance/extensions/GovernorVotesUpgradeable.sol";
import {GovernorVotesQuorumFractionUpgradeable} from "@openzeppelin/contracts-upgradeable/governance/extensions/GovernorVotesQuorumFractionUpgradeable.sol";
import {GovernorTimelockControlUpgradeable} from "@openzeppelin/contracts-upgradeable/governance/extensions/GovernorTimelockControlUpgradeable.sol";
import {TimelockControllerUpgradeable} from "@openzeppelin/contracts-upgradeable/governance/TimelockControllerUpgradeable.sol";
import {IVotes} from "@openzeppelin/contracts/governance/utils/IVotes.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IMarketplaceDAO} from "../shared/IMarketplaceDAO.sol";
import {IMarketplaceToken} from "../shared/IMarketplaceToken.sol";
import {MarketplaceLPToken} from "./MarketplaceLPToken.sol";

/// @notice OpenZeppelin Governor with soulbound-token voting and a timelocked executor.
contract MarketplaceDAO is
    Initializable,
    GovernorUpgradeable,
    GovernorSettingsUpgradeable,
    GovernorCountingSimpleUpgradeable,
    GovernorVotesUpgradeable,
    GovernorVotesQuorumFractionUpgradeable,
    GovernorTimelockControlUpgradeable,
    UUPSUpgradeable,
    ERC2771ContextUpgradeable,
    IMarketplaceDAO
{
    /// @notice Delay between proposal creation and the start of voting.
    uint48 public constant VOTING_DELAY = 1 days;
    /// @notice Voting duration; the token's timestamp clock makes this a seconds value.
    uint32 public constant VOTING_PERIOD = 7 days;
    /// @notice Minimum rooted-token votes required to submit a proposal.
    uint256 public constant PROPOSAL_THRESHOLD = 1 ether;
    /// @notice Percentage of historical rooted-token supply required for quorum.
    uint256 public constant QUORUM_PERCENT = 4;
    /// @notice Minimum time before successful Governor operations can execute.
    uint256 public constant TIMELOCK_DELAY = 2 days;
    /// @notice Minimum continuous rooted period required for each reward claim.
    uint256 public constant CLAIM_PERIOD = 30 days;

    IMarketplaceToken private _marketplaceToken;
    MarketplaceLPToken private _rewardToken;
    /// @notice Reward-token amount eligible rooted holders may claim each period.
    uint256 public rewardPerPeriod;
    /// @notice Whether DAO governance may upgrade this implementation.
    bool public upgradesEnabled;
    /// @notice Whether DAO governance has permanently frozen this implementation.
    bool public upgradesPermanentlyDisabled;
    /// @notice Timestamp of each account's most recent successful reward claim.
    mapping(address => uint256) public lastClaimAt;

    error InvalidAddress();
    error InvalidReward();
    error NothingToClaim();
    error UpgradesDisabled();
    error UpgradesAlreadyDisabled();
    error UpgradesPermanentlyDisabledError();

    event RewardPerPeriodUpdated(uint256 amount);
    event RewardClaimed(address indexed account, uint256 amount);
    event RewardReserveFunded(uint256 amount);
    event UpgradesEnabled();
    event UpgradesPermanentlyDisabled();

    /// @custom:oz-upgrades-unsafe-allow constructor state-variable-immutable
    /// @notice Locks the implementation and records the trusted meta-transaction forwarder.
    constructor(
        address trustedForwarder_
    ) ERC2771ContextUpgradeable(trustedForwarder_) {
        _disableInitializers();
    }

    /// @notice Initializes Governor modules, its timelock, vote token, and reward-token proxy.
    function initialize(
        IMarketplaceToken token_,
        address timelockAddress,
        address rewardImplementation
    ) external initializer {
        if (
            address(token_) == address(0) ||
            timelockAddress == address(0) ||
            rewardImplementation == address(0)
        ) revert InvalidAddress();

        _marketplaceToken = token_;
        __Governor_init("Marketplace DAO");
        __GovernorSettings_init(
            VOTING_DELAY,
            VOTING_PERIOD,
            PROPOSAL_THRESHOLD
        );
        __GovernorCountingSimple_init();
        __GovernorVotes_init(IVotes(address(token_)));
        __GovernorVotesQuorumFraction_init(QUORUM_PERCENT);
        __GovernorTimelockControl_init(
            TimelockControllerUpgradeable(payable(timelockAddress))
        );

        bytes memory rewardInitialization = abi.encodeCall(
            MarketplaceLPToken.initialize,
            (address(this), address(token_))
        );
        _rewardToken = MarketplaceLPToken(
            address(
                new ERC1967Proxy(rewardImplementation, rewardInitialization)
            )
        );
    }

    /// @notice Returns the DAO-deployed reward token used for rooted-holder incentives.
    function rewardToken() external view override returns (address) {
        return address(_rewardToken);
    }

    /// @notice Sets the amount minted per eligible claim; callable only through DAO execution.
    function setRewardPerPeriod(uint256 amount) external onlyGovernance {
        rewardPerPeriod = amount;
        emit RewardPerPeriodUpdated(amount);
    }

    /// @notice Sets underlying-token units paid per whole reward token through DAO execution.
    function setRedemptionRate(
        uint256 amountPerRewardToken
    ) external onlyGovernance {
        _rewardToken.setRedemptionRate(amountPerRewardToken);
    }

    /// @notice Transfers underlying assets held by the DAO into the redemption reserve.
    function fundRewardReserve(uint256 amount) external onlyGovernance {
        if (!_marketplaceToken.transfer(address(_rewardToken), amount)) {
            revert InvalidAddress();
        }
        emit RewardReserveFunded(amount);
    }

    /// @notice Transfers DAO-held tokens to an account and roots them in one governed action.
    function prebindTokens(
        address account,
        uint256 amount
    ) external onlyGovernance {
        if (account == address(0) || amount == 0) revert InvalidAddress();
        if (!_marketplaceToken.transfer(account, amount))
            revert InvalidAddress();
        _marketplaceToken.soulboundFor(account, amount);
    }

    /// @notice Mints one period of rewards after 30 continuous days rooted and the claim interval.
    function claimReward() external override {
        address account = _msgSender();
        if (_marketplaceToken.soulboundBalanceOf(account) == 0)
            revert NothingToClaim();

        uint256 boundSince = _marketplaceToken.soulboundSince(account);
        uint256 eligibleSince =
            lastClaimAt[account] > boundSince
                ? lastClaimAt[account]
                : boundSince;
        if (
            rewardPerPeriod == 0 ||
            eligibleSince == 0 ||
            block.timestamp < eligibleSince + CLAIM_PERIOD
        ) revert NothingToClaim();

        lastClaimAt[account] = block.timestamp;
        _rewardToken.mint(account, rewardPerPeriod);
        emit RewardClaimed(account, rewardPerPeriod);
    }

    /// @notice Enables DAO implementation upgrades unless permanently frozen.
    function enableUpgrades() external onlyGovernance {
        if (upgradesPermanentlyDisabled)
            revert UpgradesPermanentlyDisabledError();
        upgradesEnabled = true;
        emit UpgradesEnabled();
    }

    /// @notice Permanently freezes future DAO implementation upgrades.
    function disableUpgradesPermanently() external onlyGovernance {
        if (upgradesPermanentlyDisabled || !upgradesEnabled)
            revert UpgradesAlreadyDisabled();
        upgradesEnabled = false;
        upgradesPermanentlyDisabled = true;
        emit UpgradesPermanentlyDisabled();
    }

    /// @notice Returns the configured delay before a proposal enters Active state.
    function votingDelay()
        public
        view
        override(GovernorUpgradeable, GovernorSettingsUpgradeable)
        returns (uint256)
    {
        return super.votingDelay();
    }

    /// @notice Returns the configured timestamp duration of a proposal's voting period.
    function votingPeriod()
        public
        view
        override(GovernorUpgradeable, GovernorSettingsUpgradeable)
        returns (uint256)
    {
        return super.votingPeriod();
    }

    /// @notice Returns the rooted voting power required to create a proposal.
    function proposalThreshold()
        public
        view
        override(GovernorUpgradeable, GovernorSettingsUpgradeable)
        returns (uint256)
    {
        return super.proposalThreshold();
    }

    /// @notice Returns a proposal's Governor state, including its timelock state.
    function state(
        uint256 proposalId
    )
        public
        view
        override(GovernorUpgradeable, GovernorTimelockControlUpgradeable)
        returns (ProposalState)
    {
        return super.state(proposalId);
    }

    /// @notice Reports whether a successful proposal must be queued in the timelock.
    function proposalNeedsQueuing(
        uint256 proposalId
    )
        public
        view
        override(GovernorUpgradeable, GovernorTimelockControlUpgradeable)
        returns (bool)
    {
        return super.proposalNeedsQueuing(proposalId);
    }

    /// @dev Queues successful proposals in the configured timelock for its minimum delay.
    function _queueOperations(
        uint256 proposalId,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    )
        internal
        override(GovernorUpgradeable, GovernorTimelockControlUpgradeable)
        returns (uint48)
    {
        return
            super._queueOperations(
                proposalId,
                targets,
                values,
                calldatas,
                descriptionHash
            );
    }

    /// @dev Executes queued proposal actions only through the timelock executor.
    function _executeOperations(
        uint256 proposalId,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    )
        internal
        override(GovernorUpgradeable, GovernorTimelockControlUpgradeable)
    {
        super._executeOperations(
            proposalId,
            targets,
            values,
            calldatas,
            descriptionHash
        );
    }

    /// @dev Cancels Governor proposals and matching queued timelock operations.
    function _cancel(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    )
        internal
        override(GovernorUpgradeable, GovernorTimelockControlUpgradeable)
        returns (uint256)
    {
        return super._cancel(targets, values, calldatas, descriptionHash);
    }

    /// @dev Uses the timelock, not an EOA, as the Governor's privileged executor.
    function _executor()
        internal
        view
        override(GovernorUpgradeable, GovernorTimelockControlUpgradeable)
        returns (address)
    {
        return super._executor();
    }

    /// @dev Restricts DAO implementation upgrades to enabled timelock governance actions.
    function _authorizeUpgrade(address) internal override onlyGovernance {
        if (!upgradesEnabled) revert UpgradesDisabled();
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

    /// @dev Reports the ERC-2771 suffix length used by forwarded DAO calls.
    function _contextSuffixLength()
        internal
        view
        override(ContextUpgradeable, ERC2771ContextUpgradeable)
        returns (uint256)
    {
        return ERC2771ContextUpgradeable._contextSuffixLength();
    }
}
