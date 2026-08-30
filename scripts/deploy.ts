import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import hre from "hardhat";
import type { DeploymentManifest, SupportedChain } from "../src/client/types";
import { deployMarketplaceFromBrowser } from "../src/deployment/browser";

const supportedChains: SupportedChain[] = ["ethereum", "tron", "solana"];

const requiredEnvironment = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
};

const selectedChain = (): SupportedChain => {
  const value = requiredEnvironment("DEPLOY_CHAIN") as SupportedChain;
  if (!supportedChains.includes(value)) {
    throw new Error(
      `DEPLOY_CHAIN must be one of: ${supportedChains.join(", ")}.`,
    );
  }
  return value;
};

const main = async () => {
  const chain = selectedChain();
  if (chain === "solana") {
    throw new Error(
      "Solana deployment requires the Solang deployment command and is not an EVM Hardhat deployment.",
    );
  }

  const { ethers } = hre;
  const [deployer] = await ethers.getSigners();
  const tokenName = requiredEnvironment("TOKEN_NAME");
  const tokenSymbol = requiredEnvironment("TOKEN_SYMBOL");
  const initialSupply = ethers.parseUnits(
    process.env.TOKEN_INITIAL_SUPPLY ?? "21000000",
    18,
  );
  const poolManagerAddress = requiredEnvironment("POOL_MANAGER_ADDRESS");
  const [tokenArtifact, swapArtifact, proxyArtifact] = await Promise.all([
    hre.artifacts.readArtifact("MarketplaceToken"),
    hre.artifacts.readArtifact("MarketplaceV4SwapRouter"),
    hre.artifacts.readArtifact("ERC1967ProxyDeployment"),
  ]);
  const manifest: DeploymentManifest = await deployMarketplaceFromBrowser({
    chain,
    network: hre.network.name,
    poolManagerAddress,
    tokenName,
    tokenSymbol,
    initialSupply,
    signer: deployer,
    tokenArtifact,
    swapArtifact,
    proxyArtifact,
  });

  const outputDirectory = join(process.cwd(), "deployments");
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    join(outputDirectory, `${hre.network.name}.json`),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  console.log(JSON.stringify(manifest, null, 2));
};

const run = async () => {
  try {
    await main();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
};

run();
