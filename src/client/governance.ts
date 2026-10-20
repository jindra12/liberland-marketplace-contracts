import {
    Contract,
    EventLog,
    id,
    isAddress,
    isHexString,
    ZeroAddress,
    type ContractRunner,
} from "ethers";
import { deploymentArtifacts } from "../deployment/artifacts";
import type {
    DaoProposal,
    DaoProposalInput,
    DaoProposalRecord,
    DaoSettings,
    EventPage,
} from "./marketplaceTypes";
import { confirmTransaction, eventBlockWindow } from "./utils";

export type {
    DaoProposal,
    DaoProposalInput,
    DaoProposalRecord,
    DaoSettings,
} from "./marketplaceTypes";

/** OpenZeppelin Governor operations; controlled calls execute only through governance. */
export class MarketplaceDaoClient {
    private readonly dao: Contract;
    constructor(
        private readonly addresses: {
            dao: string;
            token: string;
            router: string;
        },
        private readonly runner: ContractRunner,
    ) {
        this.dao = new Contract(
            addresses.dao,
            deploymentArtifacts.daoArtifact.abi,
            runner,
        );
    }

    /** Loads proposal event data plus current lifecycle, vote counts and account eligibility. */
    async listProposals(
        account?: string,
        beforeBlock?: number,
        records?: DaoProposalRecord[],
    ): Promise<EventPage<DaoProposal>> {
        const window = records
            ? null
            : eventBlockWindow(
                  await this.runner.provider!.getBlockNumber(),
                  beforeBlock,
              );
        const logs = records
            ? []
            : await this.dao.queryFilter(
                  this.dao.filters.ProposalCreated(),
                  window!.fromBlock,
                  window!.toBlock,
              );
        const timestamp: bigint = await this.dao.getFunction("clock")();
        const items = await Promise.all(
            (
                records ||
                logs
                    .filter((log): log is EventLog => log instanceof EventLog)
                    .map((log) => ({
                        id: String(log.args.proposalId),
                        proposer: String(log.args.proposer),
                        description: String(log.args.description),
                        targets: Array.from(log.args.targets as string[]),
                        values: Array.from(log.args[3] as bigint[], String),
                        calldatas: Array.from(log.args.calldatas as string[]),
                    }))
            ).map(async (record) => {
                const proposalId = record.id;
                const snapshot: bigint =
                    await this.dao.getFunction("proposalSnapshot")(proposalId);
                const timepoint =
                    snapshot < timestamp ? snapshot : timestamp - 1n;
                const [
                    state,
                    votes,
                    deadline,
                    eta,
                    quorum,
                    hasVoted,
                    votingPower,
                ] = await Promise.all([
                    this.dao.getFunction("state")(proposalId),
                    this.dao.getFunction("proposalVotes")(proposalId),
                    this.dao.getFunction("proposalDeadline")(proposalId),
                    this.dao.getFunction("proposalEta")(proposalId),
                    this.dao.getFunction("quorum")(timepoint),
                    account
                        ? this.dao.getFunction("hasVoted")(proposalId, account)
                        : false,
                    account
                        ? this.dao.getFunction("getVotes")(account, timepoint)
                        : 0n,
                ]);
                return {
                    id: String(proposalId),
                    proposer: record.proposer,
                    description: record.description,
                    targets: record.targets,
                    values: record.values.map(BigInt),
                    calldatas: record.calldatas,
                    snapshot,
                    deadline,
                    eta,
                    timestamp,
                    state: Number(state),
                    against: votes[0],
                    for: votes[1],
                    abstain: votes[2],
                    quorum,
                    quorumIsProjected: snapshot >= timestamp,
                    hasVoted,
                    votingPower,
                    canCancel:
                        Number(state) === 0 &&
                        Boolean(
                            account &&
                            account.toLowerCase() ===
                                record.proposer.toLowerCase(),
                        ),
                };
            }),
        );
        return {
            items: items.reverse(),
            nextBlock: window ? window.nextBlock : null,
        };
    }

    /** Reads the current Governor settings; changes require a successful timelocked proposal. */
    async settings(): Promise<DaoSettings> {
        const [
            votingDelay,
            votingPeriod,
            proposalThreshold,
            quorumNumerator,
            quorumDenominator,
        ] = await Promise.all([
            this.dao.getFunction("votingDelay")(),
            this.dao.getFunction("votingPeriod")(),
            this.dao.getFunction("proposalThreshold")(),
            this.dao.getFunction("quorumNumerator")(),
            this.dao.getFunction("quorumDenominator")(),
        ]);
        return {
            votingDelay,
            votingPeriod,
            proposalThreshold,
            quorumNumerator,
            quorumDenominator,
        };
    }

    /** Cancels the caller's pending proposal; OpenZeppelin rejects other callers and started votes. */
    async cancel(proposal: DaoProposal): Promise<string> {
        return confirmTransaction(
            await this.dao.getFunction("cancel")(
                proposal.targets,
                proposal.values,
                proposal.calldatas,
                id(proposal.description),
            ),
        );
    }

    /** Records one rooted-token vote; Governor enforces snapshot power and duplicate-vote protection. */
    async vote(
        proposalId: string,
        support: number,
        reason: string,
    ): Promise<string> {
        if (![0, 1, 2].includes(support)) {
            throw new Error("Choose against, for, or abstain.");
        }
        return confirmTransaction(
            await this.dao.getFunction("castVoteWithReason")(
                proposalId,
                support,
                reason,
            ),
        );
    }

    /** Queues a successful proposal in the configured timelock. */
    async queue(proposal: DaoProposal): Promise<string> {
        return confirmTransaction(
            await this.dao.getFunction("queue")(
                proposal.targets,
                proposal.values,
                proposal.calldatas,
                id(proposal.description),
            ),
        );
    }

    /** Executes a queued proposal only after its timelock delay. */
    async execute(proposal: DaoProposal): Promise<string> {
        return confirmTransaction(
            await this.dao.getFunction("execute")(
                proposal.targets,
                proposal.values,
                proposal.calldatas,
                id(proposal.description),
                {
                    value: proposal.values.reduce(
                        (sum, value) => sum + value,
                        0n,
                    ),
                },
            ),
        );
    }

    /** Creates a reward, swap-fee, or unrooting proposal, never a privileged direct transaction. */
    async propose(input: DaoProposalInput): Promise<string> {
        if (!input.description || input.amount < 0n) {
            throw new Error(
                "Provide a proposal description and a non-negative amount.",
            );
        }
        const encode = () => {
            switch (input.kind) {
                case "reward":
                    return this.dao.interface.encodeFunctionData(
                        "setRewardPerPeriod",
                        [input.amount],
                    );
                case "redemption":
                    return this.dao.interface.encodeFunctionData(
                        "setRedemptionRate",
                        [input.amount],
                    );
                case "voting-delay":
                    if (input.amount >= 1n << 48n) {
                        throw new Error("Voting delay exceeds uint48.");
                    }
                    return this.dao.interface.encodeFunctionData(
                        "setVotingDelay",
                        [input.amount],
                    );
                case "voting-period":
                    if (input.amount === 0n || input.amount >= 1n << 32n) {
                        throw new Error(
                            "Voting period must be positive and fit uint32.",
                        );
                    }
                    return this.dao.interface.encodeFunctionData(
                        "setVotingPeriod",
                        [input.amount],
                    );
                case "proposal-threshold":
                    return this.dao.interface.encodeFunctionData(
                        "setProposalThreshold",
                        [input.amount],
                    );
                case "quorum":
                    return this.dao.interface.encodeFunctionData(
                        "updateQuorumNumerator",
                        [input.amount],
                    );
                case "reserve":
                    return this.dao.interface.encodeFunctionData(
                        "fundRewardReserve",
                        [input.amount],
                    );
                case "prebind":
                    if (
                        !input.address ||
                        !isAddress(input.address) ||
                        input.address === ZeroAddress ||
                        input.amount === 0n
                    ) {
                        throw new Error(
                            "Choose a nonzero account and a positive amount to prebind.",
                        );
                    }
                    return this.dao.interface.encodeFunctionData(
                        "prebindTokens",
                        [input.address, input.amount],
                    );
                case "fee": {
                    if (input.amount > 1000n || !input.address) {
                        throw new Error(
                            "Router fee must be at most 10% and have a recipient.",
                        );
                    }
                    const router = new Contract(
                        this.addresses.router,
                        deploymentArtifacts.swapArtifact.abi,
                    );
                    return this.dao.interface.encodeFunctionData("relay", [
                        this.addresses.router,
                        0n,
                        router.interface.encodeFunctionData("setFee", [
                            input.amount,
                            input.address,
                        ]),
                    ]);
                }
                case "unroot": {
                    if (!input.address || input.amount === 0n) {
                        throw new Error(
                            "Choose an account and a positive amount to unroot.",
                        );
                    }
                    const token = new Contract(
                        this.addresses.token,
                        deploymentArtifacts.tokenArtifact.abi,
                    );
                    return this.dao.interface.encodeFunctionData("relay", [
                        this.addresses.token,
                        0n,
                        token.interface.encodeFunctionData("unsoulbound", [
                            input.address,
                            input.amount,
                        ]),
                    ]);
                }
                default:
                    throw new Error(
                        "Upgrade proposals require a selected governed contract.",
                    );
            }
        };
        if (
            ["enable-upgrades", "freeze-upgrades", "upgrade"].includes(
                input.kind,
            )
        ) {
            return this.proposeUpgrade(input);
        }
        if (
            input.kind === "quorum" &&
            (input.amount === 0n ||
                input.amount >
                    (await this.dao.getFunction("quorumDenominator")()))
        ) {
            throw new Error(
                "Quorum must be greater than zero and no more than the quorum denominator.",
            );
        }
        return confirmTransaction(
            await this.dao.getFunction("propose")(
                [this.addresses.dao],
                [0n],
                [encode()],
                input.description,
            ),
        );
    }

    /** Proposes audited implementation changes or upgrade controls; all calls remain timelocked. */
    private async proposeUpgrade(input: DaoProposalInput): Promise<string> {
        if (!input.target) {
            throw new Error("Select the governed contract.");
        }
        const targets = {
            token: this.addresses.token,
            router: this.addresses.router,
            dao: this.addresses.dao,
            reward: String(await this.dao.getFunction("rewardToken")()),
            timelock: String(await this.dao.getFunction("timelock")()),
        };
        const target = targets[input.target];
        const abis = {
            token: deploymentArtifacts.tokenArtifact.abi,
            router: deploymentArtifacts.swapArtifact.abi,
            dao: deploymentArtifacts.daoArtifact.abi,
            reward: deploymentArtifacts.rewardArtifact.abi,
            timelock: deploymentArtifacts.timelockArtifact.abi,
        };
        const contract = new Contract(target, abis[input.target], this.runner);
        const frozen: boolean = await contract.getFunction(
            "upgradesPermanentlyDisabled",
        )();
        if (frozen) {
            throw new Error("This contract's upgrades are permanently frozen.");
        }
        let calls: string[];
        switch (input.kind) {
            case "enable-upgrades":
                calls = [
                    contract.interface.encodeFunctionData("enableUpgrades"),
                ];
                break;
            case "freeze-upgrades": {
                const enabled: boolean =
                    await contract.getFunction("upgradesEnabled")();
                calls = [
                    ...(!enabled
                        ? [
                              contract.interface.encodeFunctionData(
                                  "enableUpgrades",
                              ),
                          ]
                        : []),
                    contract.interface.encodeFunctionData(
                        "disableUpgradesPermanently",
                    ),
                ];
                break;
            }
            case "upgrade": {
                if (
                    !input.address ||
                    !isAddress(input.address) ||
                    input.address === ZeroAddress ||
                    !isHexString(input.initialization || "0x")
                ) {
                    throw new Error(
                        "Provide an implementation address and valid initialization calldata.",
                    );
                }
                if (
                    (await this.runner.provider!.getCode(input.address)) ===
                    "0x"
                ) {
                    throw new Error(
                        "The implementation address has no deployed code.",
                    );
                }
                const implementation = new Contract(
                    input.address,
                    abis[input.target],
                    this.runner,
                );
                if (
                    (await implementation.getFunction("proxiableUUID")()) !==
                    "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"
                ) {
                    throw new Error(
                        "The implementation is not a compatible UUPS implementation.",
                    );
                }
                const enabled: boolean =
                    await contract.getFunction("upgradesEnabled")();
                calls = [
                    ...(!enabled
                        ? [
                              contract.interface.encodeFunctionData(
                                  "enableUpgrades",
                              ),
                          ]
                        : []),
                    contract.interface.encodeFunctionData("upgradeToAndCall", [
                        input.address,
                        input.initialization || "0x",
                    ]),
                ];
                break;
            }
            default:
                throw new Error("Choose an upgrade operation.");
        }
        const direct = input.target === "dao" || input.target === "timelock";
        return confirmTransaction(
            await this.dao.getFunction("propose")(
                calls.map(() => (direct ? target : this.addresses.dao)),
                calls.map(() => 0n),
                calls.map((data) =>
                    direct
                        ? data
                        : this.dao.interface.encodeFunctionData("relay", [
                              target,
                              0n,
                              data,
                          ]),
                ),
                input.description,
            ),
        );
    }
}
