import assert from "node:assert/strict";
import hre from "hardhat";
import { Contract, parseEther, ZeroAddress } from "ethers";
import { MarketplaceSwapClient } from "../src/client/trading";
import { V4PositionClient } from "../src/client/v4Positions";
import { deployMarketplaceFromBrowser } from "../src/deployment/browser";
import { executeDeploymentTransaction } from "../src/deployment/transactionUtils";
import { deploymentOptions } from "./utils";

describe("Deployment recovery and spending boundaries", () => {
    it("checks the runner before opening a wallet request and preserves a normal wallet rejection", async () => {
        const calls: string[] = [];
        const options = {
            ...(await deploymentOptions()),
            beforeTransaction: async () => {
                calls.push("ownership");
            },
        };
        await assert.rejects(
            executeDeploymentTransaction(
                options,
                "owned step",
                {
                    to: await options.signer.getAddress(),
                    data: "0x",
                    value: 0n,
                },
                async () => {
                    calls.push("wallet");
                    throw new Error("Wallet rejected request");
                },
            ),
            /Wallet rejected request/,
        );
        assert.deepEqual(calls, ["ownership", "wallet"]);
    });

    it("does not submit a wallet transaction when the application has lost deployment ownership", async () => {
        const options = {
            ...(await deploymentOptions()),
            beforeTransaction: async () => {
                throw new Error("Deployment lease was lost");
            },
        };
        const nonce = await options.signer.getNonce();
        const submitted = { value: false };
        await assert.rejects(
            executeDeploymentTransaction(
                options,
                "guarded step",
                {
                    to: await options.signer.getAddress(),
                    data: "0x",
                    value: 0n,
                },
                async () => {
                    submitted.value = true;
                    throw new Error("Submitted without ownership");
                },
            ),
            /Deployment lease was lost/,
        );
        assert.equal(submitted.value, false);
        assert.equal(await options.signer.getNonce(), nonce);
    });

    it("refuses approvals to an edited router and to reviewed router code with Mallory as forwarder", async () => {
        const options = await deploymentOptions();
        const manifest = await deployMarketplaceFromBrowser(options);
        const mallory = (await hre.ethers.getSigners())[1];
        const implementation = await (
            await hre.ethers.getContractFactory("MarketplaceV4SwapRouter")
        ).deploy(mallory.address);
        await implementation.waitForDeployment();
        const proxy = await (
            await hre.ethers.getContractFactory("ERC1967ProxyDeployment")
        ).deploy(
            await implementation.getAddress(),
            implementation.interface.encodeFunctionData("initialize", [
                options.poolManagerAddress,
                await options.signer.getAddress(),
            ]),
        );
        await proxy.waitForDeployment();
        const pool = {
            id: manifest.swap.poolId!,
            key: {
                currency0: ZeroAddress,
                currency1: manifest.token.address,
                fee: 3000,
                tickSpacing: 60,
                hooks: ZeroAddress,
            },
            currency0: { address: ZeroAddress, symbol: "ETH", decimals: 18 },
            currency1: {
                address: manifest.token.address,
                symbol: "RCV",
                decimals: 18,
            },
        };
        const token = new Contract(
            manifest.token.address,
            options.tokenArtifact.abi,
            options.signer,
        );
        const deadline = BigInt(
            (await hre.ethers.provider.getBlock("latest"))!.timestamp + 1200,
        );
        await [mallory.address, await proxy.getAddress()].reduce(
            async (previous, router) => {
                await previous;
                const client = new MarketplaceSwapClient(
                    {
                        router,
                        poolManager: options.poolManagerAddress,
                        quoter: ZeroAddress,
                    },
                    options.signer,
                );
                await assert.rejects(
                    client.swap(
                        {
                            pool,
                            zeroForOne: false,
                            amountIn: parseEther("1"),
                            amountOut: 1n,
                            minimumOut: 1n,
                            routerFeeBps: 0,
                            slippageBps: 50,
                            quotedAt: Date.now(),
                            deadline,
                        },
                        options.signer,
                    ),
                    /Unverified swap router/,
                );
                assert.equal(
                    await token.getFunction("allowance")(
                        await options.signer.getAddress(),
                        router,
                    ),
                    0n,
                );
            },
            Promise.resolve(),
        );
    });

    it("rejects a saved transaction with different native value without sending another transaction", async () => {
        const options = await deploymentOptions();
        const request = {
            to: await options.signer.getAddress(),
            data: "0x1234",
            value: 1n,
        };
        const sent = await options.signer.sendTransaction(request);
        await sent.wait();
        const nonce = await options.signer.getNonce();
        await assert.rejects(
            executeDeploymentTransaction(
                {
                    ...options,
                    transactions: [
                        {
                            label: "value-bound step",
                            hash: sent.hash,
                            nonce: sent.nonce,
                            chainId: sent.chainId.toString(),
                        },
                    ],
                },
                "value-bound step",
                { ...request, value: 2n },
                async () => {
                    throw new Error("Must not resend");
                },
            ),
            /does not match/,
        );
        assert.equal(await options.signer.getNonce(), nonce);
    });

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
        await assert.rejects(
            client.approveCurrency(
                manifest.token.address,
                parseEther("100"),
                Math.floor(Date.now() / 1000) + 3600,
            ),
            /Unverified permit2Address/,
        );
        assert.equal(
            await token.getFunction("allowance")(
                await options.signer.getAddress(),
                mallory.address,
            ),
            0n,
        );
        await assert.rejects(
            token.getFunction("transferFrom")(
                await options.signer.getAddress(),
                mallory.address,
                parseEther("100"),
            ),
            /ERC20InsufficientAllowance/,
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
