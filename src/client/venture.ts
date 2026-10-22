import {
    Contract,
    type ContractRunner,
    type ContractTransactionResponse,
} from "ethers";
import { deploymentArtifacts } from "../deployment/artifacts";

export interface VentureAccountSnapshot {
    balance: bigint;
    liquid: bigint;
    rooted: bigint;
    votes: bigint;
    rewards: bigint;
    rewardPerPeriod: bigint;
    eligibleAt: bigint;
    timestamp: bigint;
}

/** Uses compiled ABIs; privileged DAO methods are deliberately not direct user actions. */
export class VentureClient {
    private readonly token: Contract;
    private readonly dao: Contract;
    private readonly rewards: Contract;

    constructor(
        addresses: { token: string; dao: string; rewards: string },
        private readonly runner: ContractRunner,
    ) {
        this.token = new Contract(
            addresses.token,
            deploymentArtifacts.tokenArtifact.abi,
            runner,
        );
        this.dao = new Contract(
            addresses.dao,
            deploymentArtifacts.daoArtifact.abi,
            runner,
        );
        this.rewards = new Contract(
            addresses.rewards,
            deploymentArtifacts.rewardArtifact.abi,
            runner,
        );
    }

    /** Reads liquid/rooted balances, delegated votes and the on-chain reward eligibility timestamp. */
    async readAccount(address: string): Promise<VentureAccountSnapshot> {
        const [
            balance,
            liquid,
            rooted,
            votes,
            rewards,
            rewardPerPeriod,
            since,
            lastClaim,
            period,
            block,
        ] = await Promise.all([
            this.token.getFunction("balanceOf")(address),
            this.token.getFunction("liquidBalanceOf")(address),
            this.token.getFunction("soulboundBalanceOf")(address),
            this.token.getFunction("getVotes")(address),
            this.rewards.getFunction("balanceOf")(address),
            this.dao.getFunction("rewardPerPeriod")(),
            this.token.getFunction("soulboundSince")(address),
            this.dao.getFunction("lastClaimAt")(address),
            this.dao.getFunction("CLAIM_PERIOD")(),
            this.runner.provider!.getBlock("latest"),
        ]);
        return {
            balance,
            liquid,
            rooted,
            votes,
            rewards,
            rewardPerPeriod,
            eligibleAt: (lastClaim > since ? lastClaim : since) + period,
            timestamp: BigInt(block!.timestamp),
        };
    }

    /** Permanently restricts transferability until the DAO authorizes unrooting. */
    async root(amount: bigint): Promise<string> {
        return this.confirm(await this.token.getFunction("soulbound")(amount));
    }

    /** Delegates the caller's rooted voting units without transferring ownership. */
    async delegate(address: string): Promise<string> {
        return this.confirm(await this.token.getFunction("delegate")(address));
    }

    /** Transfers liquid tokens; the token contract rejects transfers exceeding the liquid balance. */
    async transfer(address: string, amount: bigint): Promise<string> {
        return this.confirm(
            await this.token.getFunction("transfer")(address, amount),
        );
    }

    /** Claims DAO-configured rewards after the continuous 30-day rooting period. */
    async claim(): Promise<string> {
        return this.confirm(await this.dao.getFunction("claimReward")());
    }

    /** Burns reward tokens against funded reserves with an explicit minimum underlying payout. */
    async redeem(amount: bigint, minimum: bigint): Promise<string> {
        return this.confirm(
            await this.rewards.getFunction("redeem")(amount, minimum),
        );
    }

    private async confirm(
        transaction: ContractTransactionResponse,
    ): Promise<string> {
        const receipt = await transaction.wait();
        if (!receipt || receipt.status !== 1) {
            throw new Error("Transaction did not confirm successfully.");
        }
        return receipt.hash;
    }
}
