import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { DeploymentArtifact } from "../src/deployment/browser";

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
    await writeFile(
        resolve(directory, "deploymentArtifacts.json"),
        `${JSON.stringify(Object.fromEntries(entries))}\n`,
    );
    const interfaces = {
        poolManager:
            "../artifacts/@uniswap/v4-core/src/interfaces/IPoolManager.sol/IPoolManager.json",
        quoter: "../node_modules/@uniswap/v4-periphery/foundry-out/IV4Quoter.sol/IV4Quoter.json",
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
