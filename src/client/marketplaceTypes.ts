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
    canCancel?: boolean;
}
export interface DaoProposalInput {
    description: string;
    kind:
        | "reward"
        | "fee"
        | "unroot"
        | "redemption"
        | "reserve"
        | "prebind"
        | "voting-delay"
        | "voting-period"
        | "proposal-threshold"
        | "quorum"
        | "enable-upgrades"
        | "freeze-upgrades"
        | "upgrade";
    amount: bigint;
    address?: string;
    target?: "token" | "router" | "reward" | "dao" | "timelock";
    initialization?: string;
}

export interface DaoSettings {
    votingDelay: bigint;
    votingPeriod: bigint;
    proposalThreshold: bigint;
    quorumNumerator: bigint;
    quorumDenominator: bigint;
}

export interface LiquidityQuote {
    pool: VenturePool;
    tickLower: number;
    tickUpper: number;
    liquidity: bigint;
    amount0Maximum: bigint;
    amount1Maximum: bigint;
}

export type DaoProposalRecord = Pick<
    DaoProposal,
    "id" | "proposer" | "description" | "targets" | "calldatas"
> & {
    values: string[];
};
