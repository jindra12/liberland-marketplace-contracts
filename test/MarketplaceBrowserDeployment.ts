import assert from "node:assert/strict";
import { Contract, parseEther } from "ethers";
import hre from "hardhat";
import { deployMarketplaceFromBrowser } from "../src/deployment/browser";
import type { DeploymentTransaction } from "../src/client/types";
import { getVenturePoolPrice } from "../src/deployment/transactionUtils";
import { deploymentOptions } from "./utils";

describe("Browser deployment recovery", () => {
    it("continues when Mallory initializes the pool first at the requested price", async () => {
        const options = await deploymentOptions();
        const mallory = (await hre.ethers.getSigners())[1];
        const manager = await hre.ethers.getContractAt(
            "MarketplacePoolManager",
            options.poolManagerAddress,
            mallory,
        );
        await assert.doesNotReject(
            deployMarketplaceFromBrowser({
                ...options,
                onTransaction: async (label, receipt) => {
                    if (label === "token proxy") {
                        assert.ok(receipt.contractAddress);
                        await manager.getFunction("initialize")(
                            {
                                currency0: hre.ethers.ZeroAddress,
                                currency1: receipt.contractAddress,
                                fee: 3000,
                                tickSpacing: 60,
                                hooks: hre.ethers.ZeroAddress,
                            },
                            getVenturePoolPrice(options),
                        );
                    }
                },
            }),
            "An already initialized pool at the reviewed price must not strand the deployment.",
        );
    });

    it("recovers when the pool initialized but its submission checkpoint was not saved", async () => {
        const options = await deploymentOptions();
        const transactions: DeploymentTransaction[] = [];
        await assert.rejects(
            deployMarketplaceFromBrowser({
                ...options,
                transactions,
                onSubmitted: (entry) => {
                    if (entry.label === "ETH/token pool initialization") {
                        throw new Error("Checkpoint persistence interrupted");
                    }
                    transactions.push(entry);
                },
            }),
            /Checkpoint persistence interrupted/,
        );
        assert.equal(
            transactions.some(
                (entry) => entry.label === "ETH/token pool initialization",
            ),
            false,
        );
        await assert.doesNotReject(
            deployMarketplaceFromBrowser({
                ...options,
                transactions,
                onSubmitted: (entry) => {
                    transactions.push(entry);
                },
            }),
            "Recovery must detect the confirmed pool state rather than submitting initialization again.",
        );
    });

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
