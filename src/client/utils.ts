import type { ContractTransactionResponse } from "ethers";

export const confirmTransaction = async (
    transaction: ContractTransactionResponse,
): Promise<string> => {
    const receipt = await transaction.wait();
    if (!receipt || receipt.status !== 1) {
        throw new Error("Transaction did not confirm successfully.");
    }
    return receipt.hash;
};

// Bounded log pages avoid unbounded RPC requests; callers can load older history.
export const eventBlockWindow = (latest: number, beforeBlock?: number) => {
    const toBlock = beforeBlock ?? latest;
    const fromBlock = Math.max(0, toBlock - 1999);
    return {
        fromBlock,
        toBlock,
        nextBlock: fromBlock > 0 ? fromBlock - 1 : null,
    };
};
