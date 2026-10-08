import type { PoolKeyInput } from "./types";

export interface PoolCurrency {
    address: string;
    symbol: string;
    decimals: number;
}
export interface VenturePool {
    id: string;
    key: PoolKeyInput;
    currency0: PoolCurrency;
    currency1: PoolCurrency;
}
export interface EventPage<T> {
    items: T[];
    nextBlock: number | null;
}
export interface TradeQuote {
    pool: VenturePool;
    zeroForOne: boolean;
    amountIn: bigint;
    amountOut: bigint;
    minimumOut: bigint;
    routerFeeBps: number;
    slippageBps: number;
    quotedAt: number;
}
export interface DaoProposal {
    id: string;
    proposer: string;
    description: string;
    targets: string[];
    values: bigint[];
    calldatas: string[];
    snapshot: bigint;
    deadline: bigint;
    eta: bigint;
    timestamp: bigint;
    state: number;
    against: bigint;
    for: bigint;
    abstain: bigint;
    quorum: bigint;
    quorumIsProjected: boolean;
    hasVoted: boolean;
    votingPower: bigint;
}
export interface DaoProposalInput {
    description: string;
    kind: "reward" | "fee" | "unroot";
    amount: bigint;
    address?: string;
}
