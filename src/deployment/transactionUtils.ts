import {
    AbiCoder,
    Contract,
    ContractFactory,
    getAddress,
    keccak256,
    parseEther,
    ZeroAddress,
    type ContractTransactionResponse,
    type TransactionRequest,
    type TransactionReceipt,
} from "ethers";
import { sqrt } from "@uniswap/sdk-core";
import JSBI from "jsbi";
import clientAbis from "../generated/clientAbis.json";
import type { BrowserEvmDeploymentOptions } from "./browser";

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
    const previous = options.transactions?.find(
        (entry) => entry.label === label,
    );
    const provider = options.signer.provider!;
    const transaction = previous
        ? await provider.getTransaction(previous.hash)
        : await submit(await deploymentFees(options));
    if (!transaction) {
        throw new Error(
            `Cannot find the submitted ${label} transaction. Do not redeploy until it is resolved.`,
        );
    }
    if (
        getAddress(transaction.from) !==
            getAddress(await options.signer.getAddress()) ||
        transaction.data !== request.data ||
        (transaction.to ? getAddress(transaction.to) : null) !==
            (request.to ? getAddress(String(request.to)) : null)
    ) {
        throw new Error(
            `Saved transaction does not match the ${label} deployment step.`,
        );
    }
    if (!previous && options.onSubmitted) {
        await options.onSubmitted({ label, hash: transaction.hash });
    }
    const receipt = await transaction.wait();
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
    return new Contract(
        receipt.contractAddress,
        factory.interface,
        options.signer,
    );
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
    await executeDeploymentTransaction(
        options,
        "ETH/token pool initialization",
        await manager.getFunction("initialize").populateTransaction(key, price),
        (fees) => manager.getFunction("initialize")(key, price, fees),
    );
    return keccak256(
        AbiCoder.defaultAbiCoder().encode(
            ["address", "address", "uint24", "int24", "address"],
            [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks],
        ),
    );
};
