import { Contract, EventLog, id, type ContractRunner } from "ethers";
import { deploymentArtifacts } from "../deployment/artifacts";
import type {
    DaoProposal,
    DaoProposalInput,
    EventPage,
} from "./marketplaceTypes";
import { confirmTransaction, eventBlockWindow } from "./utils";

export type { DaoProposal, DaoProposalInput } from "./marketplaceTypes";

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
    ): Promise<EventPage<DaoProposal>> {
        const window = eventBlockWindow(
            await this.runner.provider!.getBlockNumber(),
            beforeBlock,
        );
        const logs = await this.dao.queryFilter(
            this.dao.filters.ProposalCreated(),
            window.fromBlock,
            window.toBlock,
        );
        const timestamp: bigint = await this.dao.getFunction("clock")();
        const items = await Promise.all(
            logs
                .filter((log): log is EventLog => log instanceof EventLog)
                .map(async (log) => {
                    const proposalId = log.args.proposalId;
                    const snapshot: bigint =
                        await this.dao.getFunction("proposalSnapshot")(
                            proposalId,
                        );
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
                            ? this.dao.getFunction("hasVoted")(
                                  proposalId,
                                  account,
                              )
                            : false,
                        account
                            ? this.dao.getFunction("getVotes")(
                                  account,
                                  timepoint,
                              )
                            : 0n,
                    ]);
                    return {
                        id: String(proposalId),
                        proposer: String(log.args.proposer),
                        description: String(log.args.description),
                        targets: Array.from(log.args.targets as string[]),
                        values: Array.from(log.args[3] as bigint[]),
                        calldatas: Array.from(log.args.calldatas as string[]),
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
                    };
                }),
        );
        return { items: items.reverse(), nextBlock: window.nextBlock };
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
            }
        };
        return confirmTransaction(
            await this.dao.getFunction("propose")(
                [this.addresses.dao],
                [0n],
                [encode()],
                input.description,
            ),
        );
    }
}
