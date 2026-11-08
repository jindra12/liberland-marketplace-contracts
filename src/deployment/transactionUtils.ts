import {
    AbiCoder,
    Contract,
    ContractFactory,
    keccak256,
    parseEther,
    isError,
    id,
    ZeroAddress,
    type ContractTransactionResponse,
    type TransactionRequest,
    type TransactionReceipt,
    type TransactionResponse,
} from "ethers";
import { sqrt } from "@uniswap/sdk-core";
import JSBI from "jsbi";
import clientAbis from "../generated/clientAbis.json";
import type { BrowserEvmDeploymentOptions } from "./browser";
import { validateV4Infrastructure } from "../client/utils";
import {
    findReplacementTransaction,
    matchesDeploymentTransaction,
} from "./recoveryUtils";

type DeploymentArgument = string | number | bigint | boolean | string[];

/** Refresh EIP-1559 fees for every new step; never reuse a previous step's fee cap. */
const deploymentFees = async (
    options: BrowserEvmDeploymentOptions,
): Promise<TransactionRequest> => {
    const [fees, block] = await Promise.all([
        options.signer.provider!.getFeeData(),
        options.signer.provider!.getBlock("latest"),
    ]);
    if (block?.baseFeePerGas === null || !block) {
        return fees.gasPrice === null ? {} : { gasPrice: fees.gasPrice };
    }
    const priority = fees.maxPriorityFeePerGas ?? 0n;
    const minimum = block.baseFeePerGas * 2n + priority;
    return {
        maxPriorityFeePerGas: priority,
        maxFeePerGas:
            fees.maxFeePerGas && fees.maxFeePerGas > minimum
                ? fees.maxFeePerGas
                : minimum,
    };
};

/** Reuses a submitted transaction only when its sender, target and calldata match this step. */
export const executeDeploymentTransaction = async (
    options: BrowserEvmDeploymentOptions,
    label: string,
    request: TransactionRequest,
    submit: (fees: TransactionRequest) => Promise<ContractTransactionResponse>,
): Promise<TransactionReceipt> => {
    const previous = options.transactions
        ?.slice()
        .reverse()
        .find((entry) => entry.label === label);
    const provider = options.signer.provider!;
    const sender = await options.signer.getAddress();
    const chainId = (await provider.getNetwork()).chainId;
    const matches = (transaction: TransactionResponse) =>
        matchesDeploymentTransaction(
            transaction,
            request,
            sender,
            chainId,
            previous,
        );
    if (!previous && options.beforeTransaction) {
        await options.beforeTransaction();
    }
    const transaction = previous
        ? ((await provider.getTransaction(previous.hash)) ??
          (await findReplacementTransaction(provider, previous, matches)))
        : await submit(await deploymentFees(options));
    if (!transaction) {
        throw new Error(
            `Cannot find the submitted ${label} transaction. Do not redeploy until it is resolved.`,
        );
    }
    if (!matches(transaction)) {
        throw new Error(
            `Saved transaction does not match the ${label} deployment step.`,
        );
    }
    const record = async (response: TransactionResponse) => {
        if (options.onSubmitted) {
            await options.onSubmitted({
                label,
                hash: response.hash,
                nonce: response.nonce,
                chainId: response.chainId.toString(),
                submittedAtBlock: await provider.getBlockNumber(),
            });
        }
    };
    if (!previous || previous.hash !== transaction.hash) {
        await record(transaction);
    }
    const waitForReceipt = async (): Promise<TransactionReceipt | null> => {
        try {
            return await transaction
                .replaceableTransaction(
                    previous?.submittedAtBlock ??
                        Math.max(0, (await provider.getBlockNumber()) - 63),
                )
                .wait();
        } catch (error) {
            if (!isError(error, "TRANSACTION_REPLACED")) {
                throw error;
            }
            if (
                error.cancelled ||
                !matches(error.replacement) ||
                error.replacement.nonce !== transaction.nonce
            ) {
                throw new Error(
                    `Replacement does not match the ${label} deployment step. Do not redeploy until it is resolved.`,
                );
            }
            await record(error.replacement);
            return error.receipt;
        }
    };
    const receipt = await waitForReceipt();
    if (!receipt || receipt.status !== 1) {
        throw new Error(`${label} did not confirm successfully.`);
    }
    if (options.onTransaction) {
        await options.onTransaction(label, receipt);
    }
    return receipt;
};

export const deployContract = async (
    factory: ContractFactory,
    label: string,
    options: BrowserEvmDeploymentOptions,
    args: readonly DeploymentArgument[] = [],
) => {
    const receipt = await executeDeploymentTransaction(
        options,
        label,
        await factory.getDeployTransaction(...args),
        async (fees) =>
            (await factory.deploy(...args, fees)).deploymentTransaction()!,
    );
    if (
        !receipt.contractAddress ||
        (await options.signer.provider!.getCode(receipt.contractAddress)) ===
            "0x"
    ) {
        throw new Error(
            `The ${label} deployment has no contract code on this network.`,
        );
    }
    return {
        receipt,
        contract: new Contract(
            receipt.contractAddress,
            factory.interface,
            options.signer,
        ),
    };
};

export const callDeploymentContract = async (
    contract: Contract,
    method: string,
    args: readonly DeploymentArgument[],
    label: string,
    options: BrowserEvmDeploymentOptions,
) =>
    executeDeploymentTransaction(
        options,
        label,
        await contract.getFunction(method).populateTransaction(...args),
        (fees) => contract.getFunction(method)(...args, fees),
    );

/** Uses Uniswap's integer square root and TickMath bounds, never floating-point token prices. */
export const getVenturePoolPrice = (options: BrowserEvmDeploymentOptions) => {
    if (options.poolTokensPerEth === undefined) {
        return undefined;
    }
    if (options.poolTokensPerEth <= 0n) {
        throw new Error("The starting token price must be positive.");
    }
    const price = BigInt(
        sqrt(
            JSBI.BigInt(
                (
                    (options.poolTokensPerEth << 192n) /
                    parseEther("1")
                ).toString(),
            ),
        ).toString(),
    );
    if (
        price < 4295128739n ||
        price >= 1461446703485210103287273052203988822378723970342n
    ) {
        throw new Error(
            "The starting price is outside Uniswap's supported range.",
        );
    }
    return price;
};

/** Initializes the standard, hook-free ETH/token pool; funding remains an explicit LP action. */
export const initializeVenturePool = async (
    token: string,
    options: BrowserEvmDeploymentOptions,
) => {
    const price = getVenturePoolPrice(options);
    if (price === undefined) {
        return undefined;
    }
    const key = {
        currency0: ZeroAddress,
        currency1: token,
        fee: 3000,
        tickSpacing: 60,
        hooks: ZeroAddress,
    };
    const manager = new Contract(
        options.poolManagerAddress,
        clientAbis.poolManager,
        options.signer,
    );
    const poolId = keccak256(
        AbiCoder.defaultAbiCoder().encode(
            ["address", "address", "uint24", "int24", "address"],
            [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks],
        ),
    );
    const network = await validateV4Infrastructure(options.signer, {
        poolManagerAddress: options.poolManagerAddress,
    });
    const state = new Contract(
        network.stateViewAddress,
        [
            "function getSlot0(bytes32) view returns (uint160,int24,uint24,uint24)",
        ],
        options.signer.provider,
    );
    const initialized = async () => {
        const slot = await state.getFunction("getSlot0")(poolId);
        if (BigInt(slot[0]) === 0n) {
            return false;
        }
        if (BigInt(slot[0]) !== price) {
            throw new Error(
                "The existing pool price differs from the requested starting price. Review it before resuming deployment.",
            );
        }
        return true;
    };
    if (await initialized()) {
        return poolId;
    }
    try {
        await executeDeploymentTransaction(
            options,
            "ETH/token pool initialization",
            await manager
                .getFunction("initialize")
                .populateTransaction(key, price),
            (fees) => manager.getFunction("initialize")(key, price, fees),
        );
    } catch (error) {
        if (
            !isError(error, "CALL_EXCEPTION") ||
            error.data !== id("PoolAlreadyInitialized()").slice(0, 10) ||
            !(await initialized())
        ) {
            throw error;
        }
    }
    return poolId;
};
