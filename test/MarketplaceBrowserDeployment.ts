import assert from "node:assert/strict";
import { Contract, parseEther } from "ethers";
import hre from "hardhat";
import {
    deployMarketplaceFromBrowser,
    type BrowserEvmDeploymentOptions,
} from "../src/deployment/browser";
import type { DeploymentTransaction } from "../src/client/types";

const deploymentOptions = async (): Promise<BrowserEvmDeploymentOptions> => {
    const signer = (await hre.ethers.getSigners())[0];
    const manager = await (
        await hre.ethers.getContractFactory("MarketplacePoolManager")
    ).deploy(signer.address);
    await manager.waitForDeployment();
    return {
        chain: "ethereum",
        network: "hardhat",
        signer,
        tokenName: "Recovered Venture",
        tokenSymbol: "RCV",
        poolTokensPerEth: parseEther("2000"),
        poolManagerAddress: await manager.getAddress(),
        positionManagerAddress: signer.address,
        permit2Address: signer.address,
        tokenArtifact: await hre.artifacts.readArtifact("MarketplaceToken"),
        swapArtifact: await hre.artifacts.readArtifact(
            "MarketplaceV4SwapRouter",
        ),
        daoArtifact: await hre.artifacts.readArtifact("MarketplaceDAO"),
        rewardArtifact: await hre.artifacts.readArtifact("MarketplaceLPToken"),
        timelockArtifact: await hre.artifacts.readArtifact(
            "MarketplaceTimelock",
        ),
        forwarderArtifact: await hre.artifacts.readArtifact(
            "MarketplaceForwarder",
        ),
        proxyArtifact: await hre.artifacts.readArtifact(
            "ERC1967ProxyDeployment",
        ),
    };
};

describe("Browser deployment recovery", () => {
    it("resumes submitted transactions, initializes the pool and hands control to the DAO without duplicates", async () => {
        const options = await deploymentOptions();
        const transactions: DeploymentTransaction[] = [];
        await assert.rejects(
            deployMarketplaceFromBrowser({
                ...options,
                transactions,
                onSubmitted: (entry) => {
                    transactions.push(entry);
                },
                onTransaction: (label) => {
                    if (label === "token proxy") {
                        throw new Error("Browser closed");
                    }
                },
            }),
            /Browser closed/,
        );
        const original = transactions.map((entry) => entry.hash);
        const manifest = await deployMarketplaceFromBrowser({
            ...options,
            transactions,
            onSubmitted: (entry) => {
                transactions.push(entry);
            },
        });
        assert.deepEqual(
            transactions.slice(0, original.length).map((entry) => entry.hash),
            original,
        );
        assert.equal(
            new Set(transactions.map((entry) => entry.label)).size,
            transactions.length,
        );
        const token = new Contract(
            manifest.token.address,
            options.tokenArtifact.abi,
            options.signer,
        );
        assert.equal(await token.getFunction("owner")(), manifest.dao.address);
        assert.equal(
            await token.getFunction("balanceOf")(manifest.deployer),
            parseEther("21000000"),
        );
        const manager = await hre.ethers.getContractAt(
            "MarketplacePoolManager",
            options.poolManagerAddress,
        );
        const pools = await manager.queryFilter(
            manager.filters.Initialize(manifest.swap.poolId),
        );
        assert.equal(pools.length, 1);
        const count = transactions.length;
        const repeated = await deployMarketplaceFromBrowser({
            ...options,
            transactions,
        });
        assert.equal(repeated.token.address, manifest.token.address);
        assert.equal(repeated.swap.poolId, manifest.swap.poolId);
        assert.equal(transactions.length, count);
    });

    it("rejects Mallory's wallet and modified initialization without broadcasting replacement contracts", async () => {
        const options = await deploymentOptions();
        const transactions: DeploymentTransaction[] = [];
        const manifest = await deployMarketplaceFromBrowser({
            ...options,
            transactions,
            onSubmitted: (entry) => {
                transactions.push(entry);
            },
        });
        const mallory = (await hre.ethers.getSigners())[1];
        const nonce = await mallory.getNonce();
        await assert.rejects(
            deployMarketplaceFromBrowser({
                ...options,
                transactions,
                signer: mallory,
            }),
            /does not match/,
        );
        assert.equal(await mallory.getNonce(), nonce);
        const ownerNonce = await options.signer.getNonce();
        await assert.rejects(
            deployMarketplaceFromBrowser({
                ...options,
                transactions,
                tokenSymbol: "ATTACK",
            }),
            /does not match/,
        );
        assert.equal(await options.signer.getNonce(), ownerNonce);
        assert.notEqual(manifest.token.address, mallory.address);
    });

    it("rejects an invalid starting price before deploying anything", async () => {
        const options = await deploymentOptions();
        const nonce = await options.signer.getNonce();
        await assert.rejects(
            deployMarketplaceFromBrowser({ ...options, poolTokensPerEth: 0n }),
            /must be positive/,
        );
        assert.equal(await options.signer.getNonce(), nonce);
    });
});
