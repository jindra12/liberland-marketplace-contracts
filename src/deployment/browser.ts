import { Contract, ContractFactory, Interface, type InterfaceAbi, type Signer } from "ethers";
import type { DeploymentManifest } from "../client/types";

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
  initialSupply: bigint;
  signer: Signer;
  tokenArtifact: DeploymentArtifact;
  swapArtifact: DeploymentArtifact;
  daoArtifact: DeploymentArtifact;
  rewardArtifact: DeploymentArtifact;
  proxyArtifact: DeploymentArtifact;
}

const deploy = async (factory: ContractFactory) => {
  const contract = await factory.deploy();
  await contract.waitForDeployment();
  return contract;
};

export const deployMarketplaceFromBrowser = async (
  options: BrowserEvmDeploymentOptions,
): Promise<DeploymentManifest> => {
  const deployer = await options.signer.getAddress();
  const provider = options.signer.provider;
  if (!provider) {
    throw new Error("The signer must be connected to a provider.");
  }

  const tokenImplementation = await deploy(
    new ContractFactory(options.tokenArtifact.abi, options.tokenArtifact.bytecode, options.signer),
  );
  const tokenInitialization = new Interface(options.tokenArtifact.abi).encodeFunctionData("initialize", [
    options.tokenName,
    options.tokenSymbol,
    deployer,
    options.initialSupply,
  ]);
  const tokenProxyFactory = new ContractFactory(
    options.proxyArtifact.abi,
    options.proxyArtifact.bytecode,
    options.signer,
  );
  const tokenProxy = await tokenProxyFactory.deploy(
    await tokenImplementation.getAddress(),
    tokenInitialization,
  );
  await tokenProxy.waitForDeployment();

  const swapImplementation = await deploy(
    new ContractFactory(options.swapArtifact.abi, options.swapArtifact.bytecode, options.signer),
  );
  const swapInitialization = new Interface(options.swapArtifact.abi).encodeFunctionData("initialize", [
    options.poolManagerAddress,
    deployer,
  ]);
  const swapProxy = await tokenProxyFactory.deploy(
    await swapImplementation.getAddress(),
    swapInitialization,
  );
  await swapProxy.waitForDeployment();

  const rewardImplementation = await deploy(
    new ContractFactory(options.rewardArtifact.abi, options.rewardArtifact.bytecode, options.signer),
  );

  const daoImplementation = await deploy(
    new ContractFactory(options.daoArtifact.abi, options.daoArtifact.bytecode, options.signer),
  );
  const daoInitialization = new Interface(options.daoArtifact.abi).encodeFunctionData("initialize", [
    await tokenProxy.getAddress(),
    deployer,
    await rewardImplementation.getAddress(),
  ]);
  const daoProxy = await tokenProxyFactory.deploy(
    await daoImplementation.getAddress(),
    daoInitialization,
  );
  await daoProxy.waitForDeployment();
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
  await (await tokenContract.getFunction("setGovernance")(await daoProxy.getAddress())).wait();
  await (await swapContract.getFunction("setGovernance")(await daoProxy.getAddress())).wait();
  const daoContract = new Contract(
    await daoProxy.getAddress(),
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
    token: {
      address: await tokenProxy.getAddress(),
      name: options.tokenName,
      symbol: options.tokenSymbol,
      decimals: 18,
      initialSupply: options.initialSupply.toString(),
    },
    swap: {
      address: await swapProxy.getAddress(),
      poolManager: options.poolManagerAddress,
    },
    dao: {
      address: await daoProxy.getAddress(),
      rewardToken: String(rewardToken),
    },
  };
};
