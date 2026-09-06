// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IMarketplaceDAO} from "../shared/IMarketplaceDAO.sol";
import {IMarketplaceToken} from "../shared/IMarketplaceToken.sol";
import {MarketplaceLPToken} from "./MarketplaceLPToken.sol";

/// @notice Upgradeable DAO for marketplace configuration and rooted-token governance.
contract MarketplaceDAO is
    Initializable,
    OwnableUpgradeable,
    UUPSUpgradeable,
    IMarketplaceDAO
{
    uint256 public constant VOTING_PERIOD = 3 days;
    uint256 public constant CLAIM_PERIOD = 30 days;
    uint256 public constant MAX_FEE_BPS = 1_000;

    IMarketplaceToken private _token;
    MarketplaceLPToken private _rewardToken;
    bool public upgradesEnabled;
    bool public upgradesPermanentlyDisabled;
    uint256 public rewardPerPeriod;
    uint256 public proposalCount;

    struct Proposal {
        address proposer;
        address target;
        uint256 value;
        bytes data;
        uint256 start;
        uint256 end;
        uint256 yesVotes;
        uint256 noVotes;
        bool executed;
    }

    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => mapping(address => bool)) public hasVoted;
    mapping(address => uint256) public lastClaimAt;

    error InvalidAddress();
    error NoVotingPower();
    error ProposalNotActive();
    error AlreadyVoted();
    error ProposalNotPassed();
    error AlreadyExecuted();
    error CallFailed();
    error NothingToClaim();
    error InvalidReward();
    error UpgradesDisabled();
    error UpgradesAlreadyDisabled();
    error UpgradesPermanentlyDisabledError();

    event ProposalCreated(
        uint256 indexed id,
        address indexed proposer,
        address target
    );
    event VoteCast(
        uint256 indexed id,
        address indexed voter,
        bool support,
        uint256 weight
    );
    event ProposalExecuted(uint256 indexed id);
    event RewardPerPeriodUpdated(uint256 amount);
    event RewardClaimed(address indexed account, uint256 amount);
    event UpgradesEnabled();
    event UpgradesPermanentlyDisabled();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        IMarketplaceToken token_,
        address initialOwner,
        address rewardImplementation
    ) external initializer {
        if (
            address(token_) == address(0) ||
            initialOwner == address(0) ||
            rewardImplementation == address(0)
        ) revert InvalidAddress();
        __Ownable_init(initialOwner);
        _token = token_;
        bytes memory rewardInitialization = abi.encodeCall(
            MarketplaceLPToken.initialize,
            (address(this))
        );
        _rewardToken = MarketplaceLPToken(
            address(
                new ERC1967Proxy(rewardImplementation, rewardInitialization)
            )
        );
    }

    function token() external view override returns (address) {
        return address(_token);
    }

    function rewardToken() external view override returns (address) {
        return address(_rewardToken);
    }

    function propose(
        address target,
        uint256 value,
        bytes calldata data
    ) external override returns (uint256 id) {
        if (target == address(0)) revert InvalidAddress();
        if (_token.soulboundBalanceOf(msg.sender) == 0) revert NoVotingPower();
        id = proposalCount++;
        proposals[id] = Proposal({
            proposer: msg.sender,
            target: target,
            value: value,
            data: data,
            start: block.timestamp,
            end: block.timestamp + VOTING_PERIOD,
            yesVotes: 0,
            noVotes: 0,
            executed: false
        });
        emit ProposalCreated(id, msg.sender, target);
    }

    function vote(uint256 id, bool support) external override {
        Proposal storage proposal = proposals[id];
        if (block.timestamp < proposal.start || block.timestamp >= proposal.end)
            revert ProposalNotActive();
        if (hasVoted[id][msg.sender]) revert AlreadyVoted();
        uint256 weight = _token.soulboundBalanceOf(msg.sender);
        if (weight == 0) revert NoVotingPower();
        hasVoted[id][msg.sender] = true;
        if (support) proposal.yesVotes += weight;
        else proposal.noVotes += weight;
        emit VoteCast(id, msg.sender, support, weight);
    }

    function execute(uint256 id) external payable override {
        Proposal storage proposal = proposals[id];
        if (proposal.executed) revert AlreadyExecuted();
        if (
            block.timestamp < proposal.end ||
            proposal.yesVotes <= proposal.noVotes
        ) revert ProposalNotPassed();
        proposal.executed = true;
        (bool success, ) = proposal.target.call{value: proposal.value}(
            proposal.data
        );
        if (!success) revert CallFailed();
        emit ProposalExecuted(id);
    }

    function setRewardPerPeriod(uint256 amount) external {
        if (msg.sender != address(this)) revert CallFailed();
        if (amount == 0) revert InvalidReward();
        rewardPerPeriod = amount;
        emit RewardPerPeriodUpdated(amount);
    }

    function claimReward() external override {
        if (_token.soulboundBalanceOf(msg.sender) == 0) revert NoVotingPower();
        if (
            rewardPerPeriod == 0 ||
            block.timestamp < lastClaimAt[msg.sender] + CLAIM_PERIOD
        ) revert NothingToClaim();
        lastClaimAt[msg.sender] = block.timestamp;
        _rewardToken.mint(msg.sender, rewardPerPeriod);
        emit RewardClaimed(msg.sender, rewardPerPeriod);
    }

    function prebindTokens(address account, uint256 amount) external {
        if (msg.sender != address(this)) revert CallFailed();
        if (account == address(0) || amount == 0) revert InvalidAddress();
        if (!_token.transfer(account, amount)) revert CallFailed();
        _token.soulboundFor(account, amount);
    }

    function transferTreasury(address recipient, uint256 amount) external {
        if (msg.sender != address(this) || recipient == address(0))
            revert InvalidAddress();
        if (!_token.transfer(recipient, amount)) revert CallFailed();
    }

    function isProposalPassed(uint256 id) external view returns (bool) {
        Proposal memory proposal = proposals[id];
        return
            block.timestamp >= proposal.end &&
            proposal.yesVotes > proposal.noVotes &&
            !proposal.executed;
    }

    function enableUpgrades() external onlyOwner {
        if (upgradesPermanentlyDisabled)
            revert UpgradesPermanentlyDisabledError();
        upgradesEnabled = true;
        emit UpgradesEnabled();
    }

    function disableUpgradesPermanently() external onlyOwner {
        if (upgradesPermanentlyDisabled || !upgradesEnabled)
            revert UpgradesAlreadyDisabled();
        upgradesEnabled = false;
        upgradesPermanentlyDisabled = true;
        emit UpgradesPermanentlyDisabled();
    }

    function _authorizeUpgrade(address) internal override onlyOwner {
        if (!upgradesEnabled) revert UpgradesDisabled();
    }
}
