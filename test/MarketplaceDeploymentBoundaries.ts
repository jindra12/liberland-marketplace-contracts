import assert from "node:assert/strict";
import hre from "hardhat";
import { Contract, parseEther } from "ethers";
import { V4PositionClient } from "../src/client/v4Positions";
import { deployMarketplaceFromBrowser } from "../src/deployment/browser";
import { executeDeploymentTransaction } from "../src/deployment/transactionUtils";
import { deploymentOptions } from "./utils";

describe("Deployment recovery and spending boundaries", () => {
    it("does not grant an edited Permit2 wallet enough authority to steal the holder's tokens", async () => {
        const options = await deploymentOptions();
        const mallory = (await hre.ethers.getSigners())[1];
        const manifest = await deployMarketplaceFromBrowser(options);
        const token = new Contract(
            manifest.token.address,
            options.tokenArtifact.abi,
            mallory,
        );
        const originalBalance = await token.getFunction("balanceOf")(
            await options.signer.getAddress(),
        );
        const client = new V4PositionClient(
            options.positionManagerAddress,
            mallory.address,
            options.signer,
        );
        await client.approveCurrency(
            manifest.token.address,
            parseEther("100"),
            Math.floor(Date.now() / 1000) + 3600,
        );
        await token.getFunction("transferFrom")(
            await options.signer.getAddress(),
            mallory.address,
            parseEther("100"),
        );
        assert.equal(
            await token.getFunction("balanceOf")(
                await options.signer.getAddress(),
            ),
            originalBalance,
            "An edited deployment record must not authorize an unverified spending wallet.",
        );
    });

    it("rejects an impossible voting supply before broadcasting any deployment step", async () => {
        const options = await deploymentOptions();
        const before = await options.signer.getNonce();
        await assert.rejects(
            deployMarketplaceFromBrowser({
                ...options,
                initialSupply: 1n << 208n,
            }),
        );
        assert.equal(
            await options.signer.getNonce(),
            before,
            "Known-invalid parameters must not strand paid deployment steps.",
        );
    });

    it("recovers a matching deployment transaction mined under a replacement hash", async () => {
        const options = await deploymentOptions();
        const request = {
            to: await options.signer.getAddress(),
            data: "0x1234",
            value: 0n,
        };
        await hre.network.provider.send("evm_setAutomine", [false]);
        try {
            const nonce = await options.signer.getNonce();
            const original = await options.signer.sendTransaction({
                ...request,
                nonce,
                gasPrice: 100_000_000_000n,
            });
            const replacement = await options.signer.sendTransaction({
                ...request,
                nonce,
                gasPrice: 200_000_000_000n,
            });
            await hre.network.provider.send("evm_mine");
            assert.equal((await replacement.wait())?.status, 1);
            await assert.doesNotReject(
                executeDeploymentTransaction(
                    {
                        ...options,
                        transactions: [
                            {
                                label: "replacement fixture",
                                hash: original.hash,
                            },
                        ],
                    },
                    "replacement fixture",
                    request,
                    async () => {
                        throw new Error(
                            "Recovery must never blindly send a duplicate.",
                        );
                    },
                ),
            );
        } finally {
            await hre.network.provider.send("evm_setAutomine", [true]);
        }
    });
});
