import { ContractFactory, Interface, type InterfaceAbi, type Signer } from "ethers";
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
  };
};
