import {
  getAddress,
  getBigInt,
  type Provider,
  type TransactionRequest,
  type TransactionResponse,
} from "ethers";
import type { DeploymentTransaction } from "../client/types";

/** Recovery is bounded and never submits another transaction for an unresolved journal entry. */
export const matchesDeploymentTransaction = (
  transaction: TransactionResponse,
  request: TransactionRequest,
  sender: string,
  chainId: bigint,
  previous?: DeploymentTransaction,
) =>
  getAddress(transaction.from) === getAddress(sender) &&
  transaction.chainId === chainId &&
  (!previous?.chainId || BigInt(previous.chainId) === chainId) &&
  (previous?.nonce === undefined || transaction.nonce === previous.nonce) &&
  transaction.data === (request.data ?? "0x") &&
  transaction.value === getBigInt(request.value ?? 0n) &&
  (transaction.to ? getAddress(transaction.to) : null) ===
    (request.to ? getAddress(String(request.to)) : null);

/** Old hash-only journals need a unique mined match; newer journals also bind the nonce and chain. */
export const findReplacementTransaction = async (
  provider: Provider,
  previous: DeploymentTransaction,
  matches: (transaction: TransactionResponse) => boolean,
) => {
  const latest = await provider.getBlockNumber();
  const earliest = Math.max(0, latest - 63, previous.submittedAtBlock ?? 0);
  const search = async (end: number): Promise<TransactionResponse[]> => {
    if (end < earliest) {
      return [];
    }
    const blocks = await Promise.all(
      Array.from({ length: Math.min(4, end - earliest + 1) }, (_, index) =>
        provider.getBlock(end - index, true),
      ),
    );
    const transactions = blocks
      .flatMap((block) => block?.prefetchedTransactions ?? [])
      .filter(matches);
    return [...transactions, ...(await search(end - 4))];
  };
  const candidates = await search(latest);
  if (candidates.length !== 1) {
    throw new Error(
      `Cannot uniquely resolve the submitted ${previous.label} transaction in recent blocks. Do not redeploy until its nonce and receipt are resolved.`,
    );
  }
  return candidates[0];
};
