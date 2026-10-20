import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseEther, ZeroAddress } from "ethers";
import hre from "hardhat";
import { V4PositionClient } from "../src/client/v4Positions";
import { MarketplaceSwapClient } from "../src/client/trading";
import { deploymentNetworks } from "../src/deployment/networks";
import type { DeploymentManifest } from "../src/client/types";
import type { VenturePool } from "../src/client/marketplaceTypes";

const verify = async () => {
    assert.equal(
        hre.network.name,
        "localhost",
        "Use the explicitly selected hosted test fork.",
    );
    const [signer, mallory] = await hre.ethers.getSigners();
    assert.equal(
        (await signer.provider.getNetwork()).chainId,
        31337n,
        "Never run this verification on mainnet.",
    );
    const manifest: DeploymentManifest = JSON.parse(
        await readFile("deployments/localhost.json", "utf8"),
    );
    assert.equal(manifest.chainId, "31337");
    const pool: VenturePool = {
        id: manifest.swap.poolId!,
        key: {
            currency0: ZeroAddress,
            currency1: manifest.token.address,
            fee: 3000,
            tickSpacing: 60,
            hooks: ZeroAddress,
        },
        currency0: { address: ZeroAddress, decimals: 18, symbol: "ETH" },
        currency1: {
            address: manifest.token.address,
            decimals: 18,
            symbol: manifest.token.symbol,
        },
    };
    const client = new V4PositionClient(
        manifest.swap.positionManager,
        manifest.swap.permit2,
        signer,
    );
    const quote = await client.quoteFullRange(
        pool,
        deploymentNetworks.localhost.stateViewAddress,
        parseEther("0.1"),
        parseEther("200"),
        50,
    );
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
    await client.approveCurrency(
        pool.key.currency1,
        quote.amount1Maximum,
        Number(deadline),
    );
    const minted = await client.mintPosition({
        ...quote,
        poolKey: pool.key,
        recipient: signer.address,
        deadline,
    });
    assert.equal(await client.ownerOf(minted.tokenId), signer.address);
    assert.equal(
        await client.verifyPosition(minted.tokenId, pool.key),
        quote.liquidity,
    );
    await assert.rejects(
        new V4PositionClient(
            manifest.swap.positionManager,
            manifest.swap.permit2,
            mallory,
        ).verifyPosition(minted.tokenId, pool.key),
        /position owner/,
    );
    await assert.rejects(
        client.verifyPosition(minted.tokenId, { ...pool.key, fee: 500 }),
        /different pool/,
    );
    const request = {
        tokenId: minted.tokenId,
        poolKey: pool.key,
        deadline,
        amount0Limit: 1n,
        amount1Limit: 1n,
    };
    await assert.rejects(
        new V4PositionClient(
            manifest.swap.positionManager,
            manifest.swap.permit2,
            mallory,
        ).decreaseLiquidity({ ...request, liquidity: quote.liquidity / 2n }),
    );
    await assert.rejects(
        client.decreaseLiquidity({
            ...request,
            liquidity: quote.liquidity / 2n,
            amount0Limit: parseEther("100"),
        }),
    );
    assert.equal(
        await client.getPositionLiquidity(minted.tokenId),
        quote.liquidity,
    );
    await client.collectFees({
        ...request,
        amount0Limit: 0n,
        amount1Limit: 0n,
    });
    await client.decreaseLiquidity({
        ...request,
        liquidity: quote.liquidity / 2n,
    });
    assert.equal(
        await client.getPositionLiquidity(minted.tokenId),
        quote.liquidity - quote.liquidity / 2n,
    );
    const trading = new MarketplaceSwapClient(
        {
            router: manifest.swap.address,
            poolManager: manifest.swap.poolManager,
            quoter: deploymentNetworks.localhost.quoterAddress,
        },
        signer.provider,
    );
    const trade = await trading.quote(
        pool,
        ZeroAddress,
        parseEther("0.001"),
        50,
    );
    assert.ok(trade.amountOut > 0n);
    await client.approveCurrency(
        pool.key.currency1,
        quote.amount1Maximum,
        Number(deadline),
    );
    const closing = await client.mintPosition({
        ...quote,
        poolKey: pool.key,
        recipient: signer.address,
        deadline,
    });
    await client.decreaseLiquidity({
        ...request,
        tokenId: closing.tokenId,
        liquidity: quote.liquidity,
    });
    assert.equal(await client.getPositionLiquidity(closing.tokenId), 0n);
    await client.burnEmptyPosition(closing.tokenId, pool.key, deadline);
    await assert.rejects(client.ownerOf(closing.tokenId));
    console.log(
        JSON.stringify({
            tokenId: minted.tokenId.toString(),
            liquidity: (
                await client.getPositionLiquidity(minted.tokenId)
            ).toString(),
            buyQuote: trade.amountOut.toString(),
            transaction: minted.transactionHash,
        }),
    );
};

const run = async () => {
    try {
        await verify();
    } catch (error) {
        console.error(error);
        process.exitCode = 1;
    }
};

run();
