import {
    Contract,
    ContractFactory,
    Interface,
    parseUnits,
    type InterfaceAbi,
    type Signer,
    type TransactionReceipt,
} from "ethers";
import type {
    DeploymentManifest,
    DeploymentTransaction,
} from "../client/types";
import {
    callDeploymentContract,
    deployContract,
    getVenturePoolPrice,
    initializeVenturePool,
} from "./transactionUtils";

export const DEFAULT_INITIAL_SUPPLY = parseUnits("21000000", 18);

export interface DeploymentArtifact {
    abi: InterfaceAbi;
    bytecode: string;
}

export interface BrowserEvmDeploymentOptions {
    chain: "ethereum";
    network: string;
    poolManagerAddress: string;
    positionManagerAddress: string;
    permit2Address: string;
    tokenName: string;
    tokenSymbol: string;
    initialSupply?: bigint;
    poolTokensPerEth?: bigint;
    signer: Signer;
    tokenArtifact: DeploymentArtifact;
    swapArtifact: DeploymentArtifact;
    daoArtifact: DeploymentArtifact;
    rewardArtifact: DeploymentArtifact;
    forwarderArtifact: DeploymentArtifact;
    timelockArtifact: DeploymentArtifact;
    proxyArtifact: DeploymentArtifact;
    transactions?: DeploymentTransaction[];
    onSubmitted?: (transaction: DeploymentTransaction) => Promise<void> | void;
    onTransaction?: (
        label: string,
        receipt: TransactionReceipt,
    ) => Promise<void> | void;
}

const deployProxy = async (
    factory: ContractFactory,
    implementation: string,
    initialization: string,
    label: string,
    options: BrowserEvmDeploymentOptions,
) => {
    return deployContract(factory, label, options, [
        implementation,
        initialization,
    ]);
};

const setGovernanceIfNeeded = async (
    contract: Contract,
    governance: string,
    label: string,
    options: BrowserEvmDeploymentOptions,
): Promise<void> => {
    const currentGovernance = await contract.getFunction("governance")();
    if (currentGovernance === governance) {
        return;
    }
    await callDeploymentContract(
        contract,
        "setGovernance",
        [governance],
        label,
        options,
    );
};

export const deployMarketplaceFromBrowser = async (
    options: BrowserEvmDeploymentOptions,
): Promise<DeploymentManifest> => {
    const deployer = await options.signer.getAddress();
    const provider = options.signer.provider;
    if (!provider) {
        throw new Error("The signer must be connected to a provider.");
    }
    if (
        !options.poolManagerAddress ||
        options.poolManagerAddress ===
            "0x0000000000000000000000000000000000000000" ||
        !options.positionManagerAddress ||
        options.positionManagerAddress ===
            "0x0000000000000000000000000000000000000000" ||
        !options.permit2Address ||
        options.permit2Address === "0x0000000000000000000000000000000000000000"
    ) {
        throw new Error(
            "V4 PoolManager, PositionManager, and Permit2 addresses are required.",
        );
    }
    const initialSupply = options.initialSupply ?? DEFAULT_INITIAL_SUPPLY;
    getVenturePoolPrice(options);
    const forwarder = await deployContract(
        new ContractFactory(
            options.forwarderArtifact.abi,
            options.forwarderArtifact.bytecode,
            options.signer,
        ),
        "ERC-2771 forwarder",
        options,
    );
    const forwarderAddress = await forwarder.getAddress();
    const forwarderTransaction = options.transactions?.find(
        (entry) => entry.label === "ERC-2771 forwarder",
    );
    const deploymentBlock = forwarderTransaction
        ? (await provider.getTransactionReceipt(forwarderTransaction.hash))!
              .blockNumber
        : await provider.getBlockNumber();

    const tokenImplementation = await deployContract(
        new ContractFactory(
            options.tokenArtifact.abi,
            options.tokenArtifact.bytecode,
            options.signer,
        ),
        "token implementation",
        options,
        [forwarderAddress],
    );
    const tokenInitialization = new Interface(
        options.tokenArtifact.abi,
    ).encodeFunctionData("initialize", [
        options.tokenName,
        options.tokenSymbol,
        deployer,
        initialSupply,
    ]);
    const proxyFactory = new ContractFactory(
        options.proxyArtifact.abi,
        options.proxyArtifact.bytecode,
        options.signer,
    );
    const tokenProxy = await deployProxy(
        proxyFactory,
        await tokenImplementation.getAddress(),
        tokenInitialization,
        "token proxy",
        options,
    );

    const swapImplementation = await deployContract(
        new ContractFactory(
            options.swapArtifact.abi,
            options.swapArtifact.bytecode,
            options.signer,
        ),
        "swap implementation",
        options,
        [forwarderAddress],
    );
    const swapInitialization = new Interface(
        options.swapArtifact.abi,
    ).encodeFunctionData("initialize", [options.poolManagerAddress, deployer]);
    const swapProxy = await deployProxy(
        proxyFactory,
        await swapImplementation.getAddress(),
        swapInitialization,
        "swap proxy",
        options,
    );

    const rewardImplementation = await deployContract(
        new ContractFactory(
            options.rewardArtifact.abi,
            options.rewardArtifact.bytecode,
            options.signer,
        ),
        "reward implementation",
        options,
        [forwarderAddress],
    );
    const timelockImplementation = await deployContract(
        new ContractFactory(
            options.timelockArtifact.abi,
            options.timelockArtifact.bytecode,
            options.signer,
        ),
        "timelock implementation",
        options,
    );
    const timelockInitialization = new Interface(
        options.timelockArtifact.abi,
    ).encodeFunctionData("initialize", [
        2 * 24 * 60 * 60,
        [],
        ["0x0000000000000000000000000000000000000000"],
        deployer,
    ]);
    const timelock = await deployProxy(
        proxyFactory,
        await timelockImplementation.getAddress(),
        timelockInitialization,
        "timelock proxy",
        options,
    );
    const daoImplementation = await deployContract(
        new ContractFactory(
            options.daoArtifact.abi,
            options.daoArtifact.bytecode,
            options.signer,
        ),
        "DAO implementation",
        options,
        [forwarderAddress],
    );

    const daoInitialization = new Interface(
        options.daoArtifact.abi,
    ).encodeFunctionData("initialize", [
        await tokenProxy.getAddress(),
        await timelock.getAddress(),
        await rewardImplementation.getAddress(),
    ]);
    const daoProxy = await deployProxy(
        proxyFactory,
        await daoImplementation.getAddress(),
        daoInitialization,
        "DAO proxy",
        options,
    );

    const tokenContract = new Contract(
        await tokenProxy.getAddress(),
        options.tokenArtifact.abi,
        options.signer,
    );
    const swapContract = new Contract(
        await swapProxy.getAddress(),
        options.swapArtifact.abi,
        options.signer,
    );
    const daoAddress = await daoProxy.getAddress();
    await setGovernanceIfNeeded(
        tokenContract,
        daoAddress,
        "token governance",
        options,
    );
    await setGovernanceIfNeeded(
        swapContract,
        daoAddress,
        "swap governance",
        options,
    );
    const timelockContract = new Contract(
        await timelock.getAddress(),
        options.timelockArtifact.abi,
        options.signer,
    );
    const proposerRole = await timelockContract.getFunction("PROPOSER_ROLE")();
    const cancellerRole =
        await timelockContract.getFunction("CANCELLER_ROLE")();
    if (
        !(await timelockContract.getFunction("hasRole")(
            proposerRole,
            daoAddress,
        ))
    ) {
        await callDeploymentContract(
            timelockContract,
            "grantRole",
            [proposerRole, daoAddress],
            "governor proposer role",
            options,
        );
    }
    if (
        !(await timelockContract.getFunction("hasRole")(
            cancellerRole,
            daoAddress,
        ))
    ) {
        await callDeploymentContract(
            timelockContract,
            "grantRole",
            [cancellerRole, daoAddress],
            "governor canceller role",
            options,
        );
    }
    const adminRole: string =
        await timelockContract.getFunction("DEFAULT_ADMIN_ROLE")();
    if (await timelockContract.getFunction("hasRole")(adminRole, deployer)) {
        await callDeploymentContract(
            timelockContract,
            "renounceRole",
            [adminRole, deployer],
            "timelock admin renunciation",
            options,
        );
    }
    if ((await tokenContract.getFunction("owner")()) !== daoAddress) {
        await callDeploymentContract(
            tokenContract,
            "transferOwnership",
            [daoAddress],
            "token governance ownership",
            options,
        );
    }
    if ((await swapContract.getFunction("owner")()) !== daoAddress) {
        await callDeploymentContract(
            swapContract,
            "transferOwnership",
            [daoAddress],
            "swap governance ownership",
            options,
        );
    }

    const daoContract = new Contract(
        daoAddress,
        options.daoArtifact.abi,
        options.signer,
    );
    const rewardToken = await daoContract.getFunction("rewardToken")();
    const poolId = await initializeVenturePool(
        await tokenProxy.getAddress(),
        options,
    );
    const network = await provider.getNetwork();

    return {
        chain: options.chain,
        network: options.network,
        chainId: network.chainId.toString(),
        deployedAt: new Date().toISOString(),
        deploymentBlock,
        deployer,
        implementations: {
            forwarder: forwarderAddress,
            token: await tokenImplementation.getAddress(),
            dao: await daoImplementation.getAddress(),
            rewardToken: await rewardImplementation.getAddress(),
            swapRouter: await swapImplementation.getAddress(),
            timelock: await timelockImplementation.getAddress(),
        },
        token: {
            address: await tokenProxy.getAddress(),
            name: options.tokenName,
            symbol: options.tokenSymbol,
            decimals: 18,
            initialSupply: initialSupply.toString(),
        },
        swap: {
            poolId,
            address: await swapProxy.getAddress(),
            poolManager: options.poolManagerAddress,
            positionManager: options.positionManagerAddress,
            permit2: options.permit2Address,
        },
        dao: {
            address: daoAddress,
            timelock: await timelock.getAddress(),
            rewardToken: String(rewardToken),
        },
    };
};
