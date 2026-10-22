import {
    Contract,
    EventLog,
    ZeroAddress,
    getAddress,
    type ContractRunner,
    type Signer,
} from "ethers";
import { deploymentArtifacts } from "../deployment/artifacts";
import clientAbis from "../generated/clientAbis.json";
import type {
    EventPage,
    PoolCurrency,
    TradeQuote,
    VenturePool,
} from "./marketplaceTypes";
import { confirmTransaction, eventBlockWindow } from "./utils";

export type { TradeQuote, VenturePool, PoolCurrency } from "./marketplaceTypes";

/** V4 discovery, fee-aware quotes and exact-input swaps using the deployed router. */
export class MarketplaceSwapClient {
    private readonly router: Contract;
    private readonly manager: Contract;
    private readonly quoter: Contract;

    constructor(
        private readonly addresses: {
            router: string;
            poolManager: string;
            quoter: string;
        },
        private readonly runner: ContractRunner,
    ) {
        this.router = new Contract(
            addresses.router,
            deploymentArtifacts.swapArtifact.abi,
            runner,
        );
        this.manager = new Contract(
            addresses.poolManager,
            clientAbis.poolManager,
            runner,
        );
        this.quoter = new Contract(addresses.quoter, clientAbis.quoter, runner);
    }

    /** Searches both pool currencies in a bounded log page, optionally for a saved pool ID. */
    async listPools(
        token: string,
        beforeBlock?: number,
        poolId?: string | null,
    ): Promise<EventPage<VenturePool>> {
        const window = eventBlockWindow(
            await this.runner.provider!.getBlockNumber(),
            beforeBlock,
        );
        const filters = poolId
            ? [this.manager.filters.Initialize(poolId)]
            : [
                  this.manager.filters.Initialize(null, token),
                  this.manager.filters.Initialize(null, null, token),
              ];
        const logs = (
            await Promise.all(
                filters.map((filter) =>
                    this.manager.queryFilter(
                        filter,
                        window.fromBlock,
                        window.toBlock,
                    ),
                ),
            )
        ).flat();
        const items = await Promise.all(
            logs
                .filter((log): log is EventLog => log instanceof EventLog)
                .map(async (log) => {
                    const key = {
                        currency0: log.args.currency0,
                        currency1: log.args.currency1,
                        fee: Number(log.args.fee),
                        tickSpacing: Number(log.args.tickSpacing),
                        hooks: log.args.hooks,
                    };
                    return {
                        id: String(log.args.id),
                        key,
                        currency0: await this.currency(key.currency0),
                        currency1: await this.currency(key.currency1),
                    };
                }),
        );
        return {
            items: items.filter((pool) =>
                [pool.key.currency0, pool.key.currency1].some(
                    (address) => getAddress(address) === getAddress(token),
                ),
            ),
            nextBlock: window.nextBlock,
        };
    }

    /** Simulates a V4 swap after deducting the router fee; no wallet transaction is sent. */
    async quote(
        pool: VenturePool,
        input: string,
        amountIn: bigint,
        slippageBps: number,
    ): Promise<TradeQuote> {
        if (amountIn <= 0n || amountIn >= 1n << 128n) {
            throw new Error(
                "Enter a positive amount within the router's uint128 limit.",
            );
        }
        if (
            !Number.isInteger(slippageBps) ||
            slippageBps < 1 ||
            slippageBps > 1000
        ) {
            throw new Error("Slippage must be between 0.01% and 10%.");
        }
        const zeroForOne = getAddress(input) === getAddress(pool.key.currency0);
        if (
            !zeroForOne &&
            getAddress(input) !== getAddress(pool.key.currency1)
        ) {
            throw new Error("Input currency is not part of this pool.");
        }
        const [routerManager, quoterManager] = await Promise.all([
            this.router.getFunction("poolManager")(),
            this.quoter.getFunction("poolManager")(),
        ]);
        if (
            getAddress(routerManager) !==
                getAddress(this.addresses.poolManager) ||
            getAddress(quoterManager) !== getAddress(this.addresses.poolManager)
        ) {
            throw new Error(
                "Router and quoter must use this deployment's PoolManager.",
            );
        }
        const routerFeeBps = Number(await this.router.getFunction("feeBps")());
        const exactAmount =
            amountIn - (amountIn * BigInt(routerFeeBps)) / 10000n;
        const [amountOut] = await this.quoter
            .getFunction("quoteExactInputSingle")
            .staticCall({
                poolKey: pool.key,
                zeroForOne,
                exactAmount,
                hookData: "0x",
            });
        const minimumOut = (amountOut * BigInt(10000 - slippageBps)) / 10000n;
        if (minimumOut <= 0n || amountOut >= 1n << 128n) {
            throw new Error(
                "Quote has no usable output or exceeds the router limit.",
            );
        }
        return {
            pool,
            zeroForOne,
            amountIn,
            amountOut,
            minimumOut,
            routerFeeBps,
            slippageBps,
            quotedAt: Date.now(),
        };
    }

    /** Approves only the reviewed input amount and enforces the reviewed minimum during execution. */
    async swap(quote: TradeQuote, signer: Signer): Promise<string> {
        if (quote.minimumOut <= 0n) {
            throw new Error("A positive minimum output is required.");
        }
        const input = quote.zeroForOne
            ? quote.pool.key.currency0
            : quote.pool.key.currency1;
        const fresh = await this.quote(
            quote.pool,
            input,
            quote.amountIn,
            quote.slippageBps,
        );
        if (fresh.amountOut < quote.minimumOut) {
            throw new Error(
                "The price moved beyond your slippage limit. Review a new quote.",
            );
        }
        if (input !== ZeroAddress) {
            const token = new Contract(
                input,
                deploymentArtifacts.tokenArtifact.abi,
                signer,
            );
            const allowance: bigint = await token.getFunction("allowance")(
                await signer.getAddress(),
                this.addresses.router,
            );
            if (allowance < quote.amountIn) {
                if (allowance > 0n) {
                    await confirmTransaction(
                        await token.getFunction("approve")(
                            this.addresses.router,
                            0n,
                        ),
                    );
                }
                await confirmTransaction(
                    await token.getFunction("approve")(
                        this.addresses.router,
                        quote.amountIn,
                    ),
                );
            }
        }
        return confirmTransaction(
            await this.router
                .connect(signer)
                .getFunction("swapExactInputSingle")(
                quote.pool.key,
                quote.zeroForOne,
                quote.amountIn,
                quote.minimumOut,
                "0x",
                { value: input === ZeroAddress ? quote.amountIn : 0n },
            ),
        );
    }

    private async currency(address: string): Promise<PoolCurrency> {
        if (address === ZeroAddress) {
            return { address, symbol: "ETH", decimals: 18 };
        }
        const token = new Contract(
            address,
            deploymentArtifacts.tokenArtifact.abi,
            this.runner,
        );
        const [symbol, decimals] = await Promise.all([
            token.getFunction("symbol")(),
            token.getFunction("decimals")(),
        ]);
        return { address, symbol, decimals: Number(decimals) };
    }
}
