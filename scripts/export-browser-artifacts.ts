import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Artifact } from "hardhat/types";
import type { DeploymentArtifact } from "../src/deployment/browser";
import { readRuntimeVerification } from "./utils";

const contracts = {
  tokenArtifact: "MarketplaceToken",
  swapArtifact: "MarketplaceV4SwapRouter",
  daoArtifact: "MarketplaceDAO",
  rewardArtifact: "MarketplaceLPToken",
  forwarderArtifact: "MarketplaceForwarder",
  timelockArtifact: "MarketplaceTimelock",
  proxyArtifact: "ERC1967ProxyDeployment",
};

const main = async (): Promise<void> => {
  const entries = await Promise.all(
    Object.entries(contracts).map(async ([key, name]) => {
      const artifact: DeploymentArtifact = JSON.parse(
        await readFile(
          resolve(
            __dirname,
            `../artifacts/contracts/evm/${name}.sol/${name}.json`,
          ),
          "utf8",
        ),
      );
      return [key, { abi: artifact.abi, bytecode: artifact.bytecode }];
    }),
  );
  const directory = resolve(__dirname, "../src/generated");
  await mkdir(directory, { recursive: true });
  const routerPath = resolve(
    __dirname,
    "../artifacts/contracts/evm/MarketplaceV4SwapRouter.sol/MarketplaceV4SwapRouter.json",
  );
  const router = await readRuntimeVerification(routerPath);
  const forwarder = await readRuntimeVerification(
    resolve(
      __dirname,
      "../artifacts/contracts/evm/MarketplaceForwarder.sol/MarketplaceForwarder.json",
    ),
  );
  const proxy: Artifact = JSON.parse(
    await readFile(
      resolve(
        __dirname,
        "../artifacts/contracts/evm/ERC1967ProxyDeployment.sol/ERC1967ProxyDeployment.json",
      ),
      "utf8",
    ),
  );
  const openZeppelinProxy: Artifact = JSON.parse(
    await readFile(
      require.resolve("@openzeppelin/upgrades-core/artifacts/@openzeppelin/contracts-v5/proxy/ERC1967/ERC1967Proxy.sol/ERC1967Proxy.json"),
      "utf8",
    ),
  );
  await writeFile(
    resolve(directory, "routerVerification.json"),
    `${JSON.stringify({
      ...router,
      forwarder,
      proxyRuntimes: [
        proxy.deployedBytecode,
        openZeppelinProxy.deployedBytecode,
      ],
    })}\n`,
  );
  await writeFile(
    resolve(directory, "deploymentArtifacts.json"),
    `${JSON.stringify(Object.fromEntries(entries))}\n`,
  );
  const interfaces = {
    poolManager:
      "../artifacts/@uniswap/v4-core/src/interfaces/IPoolManager.sol/IPoolManager.json",
    quoter:
      "../node_modules/@uniswap/v4-periphery/foundry-out/IV4Quoter.sol/IV4Quoter.json",
  };
  const clientEntries = await Promise.all(
    Object.entries(interfaces).map(async ([key, path]) => {
      const artifact: DeploymentArtifact = JSON.parse(
        await readFile(resolve(__dirname, path), "utf8"),
      );
      return [key, artifact.abi];
    }),
  );
  await writeFile(
    resolve(directory, "clientAbis.json"),
    `${JSON.stringify(Object.fromEntries(clientEntries))}\n`,
  );
};

main();
