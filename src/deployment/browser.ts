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
  chain: "ethereum" | "tron";
  network: string;
  poolManagerAddress: string;
  tokenName: string;
  tokenSymbol: string;
  initialSupply?: bigint;
  signer: Signer;
  tokenArtifact: DeploymentArtifact;
  swapArtifact: DeploymentArtifact;
  daoArtifact: DeploymentArtifact;
  rewardArtifact: DeploymentArtifact;
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
) => {
  const contract = await factory.deploy();
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
    options.poolManagerAddress === "0x0000000000000000000000000000000000000000"
  ) {
    throw new Error("A canonical V4 PoolManager address is required.");
  }
  const initialSupply = options.initialSupply ?? DEFAULT_INITIAL_SUPPLY;
  const onTransaction = options.onTransaction;

  const tokenImplementation = await deploy(
    new ContractFactory(
      options.tokenArtifact.abi,
      options.tokenArtifact.bytecode,
      options.signer,
    ),
    "token implementation",
    onTransaction,
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
  );
  const daoImplementation = await deploy(
    new ContractFactory(
      options.daoArtifact.abi,
      options.daoArtifact.bytecode,
      options.signer,
    ),
    "DAO implementation",
    onTransaction,
  );
  const daoInitialization = new Interface(
    options.daoArtifact.abi,
  ).encodeFunctionData("initialize", [
    await tokenProxy.getAddress(),
    deployer,
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
      token: await tokenImplementation.getAddress(),
      dao: await daoImplementation.getAddress(),
      rewardToken: await rewardImplementation.getAddress(),
      swapRouter: await swapImplementation.getAddress(),
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
    },
    dao: {
      address: daoAddress,
      rewardToken: String(rewardToken),
    },
  };
};
