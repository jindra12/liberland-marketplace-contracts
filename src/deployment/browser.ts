import {
  Contract,
  ContractFactory,
  Interface,
  type ContractTransactionResponse,
  type InterfaceAbi,
  type Signer,
  type TransactionReceipt,
} from "ethers";
import type { DeploymentManifest } from "../client/types";

export const DEFAULT_INITIAL_SUPPLY = 21_000_000n * 10n ** 18n;

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
  signer: Signer;
  tokenArtifact: DeploymentArtifact;
  swapArtifact: DeploymentArtifact;
  daoArtifact: DeploymentArtifact;
  rewardArtifact: DeploymentArtifact;
  forwarderArtifact: DeploymentArtifact;
  timelockArtifact: DeploymentArtifact;
  proxyArtifact: DeploymentArtifact;
  onTransaction?: (
    label: string,
    receipt: TransactionReceipt,
  ) => Promise<void> | void;
}

const waitForTransaction = async (
  transaction: ContractTransactionResponse | null,
  label: string,
  onTransaction?: BrowserEvmDeploymentOptions["onTransaction"],
): Promise<void> => {
  const receipt = await transaction?.wait();
  if (receipt && onTransaction) {
    await onTransaction(label, receipt);
  }
};

const deploy = async (
  factory: ContractFactory,
  label: string,
  onTransaction?: BrowserEvmDeploymentOptions["onTransaction"],
  constructorArgs: readonly unknown[] = [],
) => {
  const contract = await factory.deploy(...constructorArgs);
  await contract.waitForDeployment();
  await waitForTransaction(
    contract.deploymentTransaction(),
    label,
    onTransaction,
  );
  return contract;
};

const deployProxy = async (
  factory: ContractFactory,
  implementation: string,
  initialization: string,
  label: string,
  onTransaction?: BrowserEvmDeploymentOptions["onTransaction"],
) => {
  const proxy = await factory.deploy(implementation, initialization);
  await proxy.waitForDeployment();
  await waitForTransaction(proxy.deploymentTransaction(), label, onTransaction);
  return proxy;
};

const setGovernanceIfNeeded = async (
  contract: Contract,
  governance: string,
  label: string,
  onTransaction?: BrowserEvmDeploymentOptions["onTransaction"],
): Promise<void> => {
  const currentGovernance = await contract.getFunction("governance")();
  if (currentGovernance === governance) {
    return;
  }
  const transaction = await contract.getFunction("setGovernance")(governance);
  await waitForTransaction(transaction, label, onTransaction);
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
  const onTransaction = options.onTransaction;
  const forwarder = await deploy(
    new ContractFactory(
      options.forwarderArtifact.abi,
      options.forwarderArtifact.bytecode,
      options.signer,
    ),
    "ERC-2771 forwarder",
    onTransaction,
  );
  const forwarderAddress = await forwarder.getAddress();

  const tokenImplementation = await deploy(
    new ContractFactory(
      options.tokenArtifact.abi,
      options.tokenArtifact.bytecode,
      options.signer,
    ),
    "token implementation",
    onTransaction,
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
    onTransaction,
  );

  const swapImplementation = await deploy(
    new ContractFactory(
      options.swapArtifact.abi,
      options.swapArtifact.bytecode,
      options.signer,
    ),
    "swap implementation",
    onTransaction,
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
    onTransaction,
  );

  const rewardImplementation = await deploy(
    new ContractFactory(
      options.rewardArtifact.abi,
      options.rewardArtifact.bytecode,
      options.signer,
    ),
    "reward implementation",
    onTransaction,
    [forwarderAddress],
  );
  const timelockImplementation = await deploy(
    new ContractFactory(
      options.timelockArtifact.abi,
      options.timelockArtifact.bytecode,
      options.signer,
    ),
    "timelock implementation",
    onTransaction,
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
    onTransaction,
  );
  const daoImplementation = await deploy(
    new ContractFactory(
      options.daoArtifact.abi,
      options.daoArtifact.bytecode,
      options.signer,
    ),
    "DAO implementation",
    onTransaction,
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
    onTransaction,
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
    onTransaction,
  );
  await setGovernanceIfNeeded(
    swapContract,
    daoAddress,
    "swap governance",
    onTransaction,
  );
  const timelockContract = new Contract(
    await timelock.getAddress(),
    options.timelockArtifact.abi,
    options.signer,
  );
  const proposerRole = await timelockContract.getFunction("PROPOSER_ROLE")();
  const cancellerRole = await timelockContract.getFunction("CANCELLER_ROLE")();
  await waitForTransaction(
    await timelockContract.getFunction("grantRole")(proposerRole, daoAddress),
    "governor proposer role",
    onTransaction,
  );
  await waitForTransaction(
    await timelockContract.getFunction("grantRole")(cancellerRole, daoAddress),
    "governor canceller role",
    onTransaction,
  );
  await waitForTransaction(
    await timelockContract.getFunction("renounceRole")(
      await timelockContract.getFunction("DEFAULT_ADMIN_ROLE")(),
      deployer,
    ),
    "timelock admin renunciation",
    onTransaction,
  );
  await waitForTransaction(
    await tokenContract.getFunction("transferOwnership")(daoAddress),
    "token governance ownership",
    onTransaction,
  );
  await waitForTransaction(
    await swapContract.getFunction("transferOwnership")(daoAddress),
    "swap governance ownership",
    onTransaction,
  );

  const daoContract = new Contract(
    daoAddress,
    options.daoArtifact.abi,
    options.signer,
  );
  const rewardToken = await daoContract.getFunction("rewardToken")();
  const network = await provider.getNetwork();

  return {
    chain: options.chain,
    network: options.network,
    chainId: network.chainId.toString(),
    deployedAt: new Date().toISOString(),
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
