import {
    AbiCoder,
    Contract,
    Interface,
    getAddress,
    hexlify,
    type Signer,
    type TransactionReceipt,
    ZeroAddress,
} from "ethers";
import type { PoolKeyInput } from "./types";
import { Ether, Percent, Token } from "@uniswap/sdk-core";
import { Pool, Position } from "@uniswap/v4-sdk";
import type { LiquidityQuote, VenturePool } from "./marketplaceTypes";

export type { LiquidityQuote } from "./marketplaceTypes";

const POSITION_MANAGER_ABI = [
    "function nextTokenId() view returns (uint256)",
    "function modifyLiquidities(bytes unlockData,uint256 deadline) payable",
    "function getPositionLiquidity(uint256 tokenId) view returns (uint128)",
    "function ownerOf(uint256 tokenId) view returns (address)",
    "function poolManager() view returns (address)",
    "function getPoolAndPositionInfo(uint256 tokenId) view returns ((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks),uint256)",
    "event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)",
] as const;

const ERC20_APPROVE_ABI = [
    "function approve(address spender,uint256 amount) returns (bool)",
] as const;
const PERMIT2_ABI = [
    "function approve(address token,address spender,uint160 amount,uint48 expiration)",
] as const;
const abiCoder = AbiCoder.defaultAbiCoder();
const transferEvent = new Interface(POSITION_MANAGER_ABI).getEvent("Transfer");

export type V4MintPosition = {
    poolKey: PoolKeyInput;
    tickLower: number;
    tickUpper: number;
    liquidity: bigint;
    amount0Maximum: bigint;
    amount1Maximum: bigint;
    recipient: string;
    hookData?: string;
    deadline: bigint;
};

export type V4LiquidityChange = {
    tokenId: bigint;
    liquidity: bigint;
    amount0Limit: bigint;
    amount1Limit: bigint;
    poolKey: PoolKeyInput;
    hookData?: string;
    deadline: bigint;
};

const encodeActions = (actions: number[], params: string[]): string =>
    abiCoder.encode(
        ["bytes", "bytes[]"],
        [hexlify(Uint8Array.from(actions)), params],
    );

const decodeMintedTokenId = (receipt: TransactionReceipt | null): bigint => {
    if (!receipt) {
        throw new Error("Position mint transaction did not produce a receipt.");
    }
    const log = receipt.logs.find(
        (entry) =>
            entry.topics[0] === transferEvent?.topicHash &&
            entry.topics[1] === `0x${"0".repeat(64)}`,
    );
    if (!log?.topics[3]) {
        throw new Error("PositionManager did not emit a position mint event.");
    }
    return BigInt(log.topics[3]);
};

export class V4PositionClient {
    private readonly contract: Contract;
    private readonly signer: Signer;
    private readonly positionManagerAddress: string;
    private readonly permit2Address: string;

    constructor(
        positionManagerAddress: string,
        permit2Address: string,
        signer: Signer,
    ) {
        this.positionManagerAddress = getAddress(positionManagerAddress);
        this.permit2Address = getAddress(permit2Address);
        this.signer = signer;
        this.contract = new Contract(
            this.positionManagerAddress,
            POSITION_MANAGER_ABI,
            signer,
        );
    }

    async approveCurrency(
        tokenAddress: string,
        amount: bigint,
        expiration: number,
    ): Promise<void> {
        const token = new Contract(
            tokenAddress,
            ERC20_APPROVE_ABI,
            this.signer,
        );
        const permit2 = new Contract(
            this.permit2Address,
            PERMIT2_ABI,
            this.signer,
        );
        if (tokenAddress === ZeroAddress) {
            return;
        }
        const tokenApproval = await token.getFunction("approve")(
            this.permit2Address,
            amount,
        );
        await tokenApproval.wait();
        const permit2Approval = await permit2.getFunction("approve")(
            tokenAddress,
            this.positionManagerAddress,
            amount,
            expiration,
        );
        await permit2Approval.wait();
    }

    async mintPosition(
        request: V4MintPosition,
    ): Promise<{ tokenId: bigint; transactionHash: string }> {
        const params = abiCoder.encode(
            [
                "(address,address,uint24,int24,address)",
                "int24",
                "int24",
                "uint256",
                "uint128",
                "uint128",
                "address",
                "bytes",
            ],
            [
                [
                    request.poolKey.currency0,
                    request.poolKey.currency1,
                    request.poolKey.fee,
                    request.poolKey.tickSpacing,
                    request.poolKey.hooks,
                ],
                request.tickLower,
                request.tickUpper,
                request.liquidity,
                request.amount0Maximum,
                request.amount1Maximum,
                request.recipient,
                request.hookData ?? "0x",
            ],
        );
        const settle = abiCoder.encode(
            ["address", "address"],
            [request.poolKey.currency0, request.poolKey.currency1],
        );
        const native = request.poolKey.currency0 === ZeroAddress;
        const sweep = abiCoder.encode(
            ["address", "address"],
            [ZeroAddress, await this.signer.getAddress()],
        );
        const transaction = await this.contract.getFunction(
            "modifyLiquidities",
        )(
            encodeActions(
                native ? [0x02, 0x0d, 0x14] : [0x02, 0x0d],
                native ? [params, settle, sweep] : [params, settle],
            ),
            request.deadline,
            { value: native ? request.amount0Maximum : 0n },
        );
        const receipt = await transaction.wait();
        return {
            tokenId: decodeMintedTokenId(receipt),
            transactionHash: transaction.hash,
        };
    }

    async decreaseLiquidity(request: V4LiquidityChange): Promise<string> {
        const decrease = abiCoder.encode(
            ["uint256", "uint256", "uint128", "uint128", "bytes"],
            [
                request.tokenId,
                request.liquidity,
                request.amount0Limit,
                request.amount1Limit,
                request.hookData ?? "0x",
            ],
        );
        const take = abiCoder.encode(
            ["address", "address", "address"],
            [
                request.poolKey.currency0,
                request.poolKey.currency1,
                await this.signer.getAddress(),
            ],
        );
        const transaction = await this.contract.getFunction(
            "modifyLiquidities",
        )(encodeActions([0x01, 0x11], [decrease, take]), request.deadline);
        await transaction.wait();
        return transaction.hash;
    }

    async collectFees(
        request: Omit<V4LiquidityChange, "liquidity">,
    ): Promise<string> {
        return this.decreaseLiquidity({ ...request, liquidity: 0n });
    }

    async burnEmptyPosition(
        tokenId: bigint,
        poolKey: PoolKeyInput,
        deadline: bigint,
        hookData = "0x",
    ): Promise<string> {
        const burn = abiCoder.encode(
            ["uint256", "uint128", "uint128", "bytes"],
            [tokenId, 0, 0, hookData],
        );
        const take = abiCoder.encode(
            ["address", "address", "address"],
            [
                poolKey.currency0,
                poolKey.currency1,
                await this.signer.getAddress(),
            ],
        );
        const transaction = await this.contract.getFunction(
            "modifyLiquidities",
        )(encodeActions([0x03, 0x11], [burn, take]), deadline);
        await transaction.wait();
        return transaction.hash;
    }

    async getPositionLiquidity(tokenId: bigint): Promise<bigint> {
        return BigInt(
            await this.contract.getFunction("getPositionLiquidity")(tokenId),
        );
    }

    /** Verifies current NFT ownership before presenting position-management actions. */
    async ownerOf(tokenId: bigint): Promise<string> {
        return this.contract.getFunction("ownerOf")(tokenId);
    }

    /** Rejects managing another pool's NFT or another wallet's position. */
    async verifyPosition(
        tokenId: bigint,
        poolKey: PoolKeyInput,
    ): Promise<bigint> {
        const [owner, position, address] = await Promise.all([
            this.ownerOf(tokenId),
            this.contract.getFunction("getPoolAndPositionInfo")(tokenId),
            this.signer.getAddress(),
        ]);
        if (getAddress(owner) !== getAddress(address)) {
            throw new Error("Only the position owner can manage this NFT.");
        }
        const actual = position[0];
        if (
            getAddress(actual.currency0) !== getAddress(poolKey.currency0) ||
            getAddress(actual.currency1) !== getAddress(poolKey.currency1) ||
            Number(actual.fee) !== poolKey.fee ||
            Number(actual.tickSpacing) !== poolKey.tickSpacing ||
            getAddress(actual.hooks) !== getAddress(poolKey.hooks)
        ) {
            throw new Error("This NFT belongs to a different pool.");
        }
        return this.getPositionLiquidity(tokenId);
    }

    /** Sizes a full-range native/token position using live canonical StateView data and Uniswap math. */
    async quoteFullRange(
        pool: VenturePool,
        stateViewAddress: string,
        amount0: bigint,
        amount1: bigint,
        slippageBps: number,
    ): Promise<LiquidityQuote> {
        if (
            amount0 <= 0n ||
            amount1 <= 0n ||
            !Number.isInteger(slippageBps) ||
            slippageBps < 1 ||
            slippageBps > 1000
        ) {
            throw new Error(
                "Enter positive currency amounts and 0.01-10% slippage.",
            );
        }
        const state = new Contract(
            stateViewAddress,
            [
                "function poolManager() view returns (address)",
                "function getSlot0(bytes32) view returns (uint160,int24,uint24,uint24)",
                "function getLiquidity(bytes32) view returns (uint128)",
            ],
            this.signer.provider,
        );
        const [manager, stateManager, slot, liquidity, network] =
            await Promise.all([
                this.contract.getFunction("poolManager")(),
                state.getFunction("poolManager")(),
                state.getFunction("getSlot0")(pool.id),
                state.getFunction("getLiquidity")(pool.id),
                this.signer.provider!.getNetwork(),
            ]);
        if (
            getAddress(manager) !== getAddress(stateManager) ||
            pool.key.currency0 !== ZeroAddress
        ) {
            throw new Error(
                "The position manager must match this native/token pool's StateView.",
            );
        }
        const chainId = Number(network.chainId);
        const sdkPool = new Pool(
            Ether.onChain(chainId),
            new Token(chainId, pool.currency1.address, pool.currency1.decimals),
            pool.key.fee,
            pool.key.tickSpacing,
            pool.key.hooks,
            slot[0].toString(),
            liquidity.toString(),
            Number(slot[1]),
        );
        if (sdkPool.poolId.toLowerCase() !== pool.id.toLowerCase()) {
            throw new Error(
                "Pool ID does not match its currencies and configuration.",
            );
        }
        const position = Position.fromAmounts({
            pool: sdkPool,
            tickLower:
                Math.ceil(-887272 / pool.key.tickSpacing) *
                pool.key.tickSpacing,
            tickUpper:
                Math.floor(887272 / pool.key.tickSpacing) *
                pool.key.tickSpacing,
            amount0: (
                (amount0 * 10000n) /
                BigInt(10000 + slippageBps)
            ).toString(),
            amount1: (
                (amount1 * 10000n) /
                BigInt(10000 + slippageBps)
            ).toString(),
            useFullPrecision: true,
        });
        const maximum = position.mintAmountsWithSlippage(
            new Percent(slippageBps, 10000),
        );
        const result = {
            pool,
            tickLower: position.tickLower,
            tickUpper: position.tickUpper,
            liquidity: BigInt(position.liquidity.toString()),
            amount0Maximum: BigInt(maximum.amount0.toString()),
            amount1Maximum: BigInt(maximum.amount1.toString()),
        };
        if (
            result.liquidity === 0n ||
            result.amount0Maximum > amount0 ||
            result.amount1Maximum > amount1 ||
            result.amount0Maximum >= 1n << 128n ||
            result.amount1Maximum >= 1n << 128n
        ) {
            throw new Error(
                "The amounts cannot fund a usable position within these budgets.",
            );
        }
        return result;
    }
}
