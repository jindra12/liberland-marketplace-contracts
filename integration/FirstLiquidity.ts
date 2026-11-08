import assert from "node:assert/strict";
import hre from "hardhat";
import { Contract, parseEther } from "ethers";
import { deploymentNetworks } from "../src/deployment/networks";
import { deployMarketplaceFromBrowser } from "../src/deployment/browser";
import { V4PositionClient } from "../src/client/v4Positions";
import type { VenturePool } from "../src/client/marketplaceTypes";
import { requiredEnvironment } from "../scripts/utils";
import { deploymentOptions } from "../test/utils";

describe("Canonical first-liquidity price integrity", () => {
  before(async () => {
    try {
      await hre.network.provider.send("hardhat_reset", [
        {
          forking: {
            jsonRpcUrl: `https://1.rpc.thirdweb.com/${requiredEnvironment("REACT_APP_THIRDWEB")}`,
          },
        },
      ]);
    } catch {
      // RPC exceptions can include the credential-bearing URL; never print that URL.
      throw new Error(
        "Cannot initialize the isolated mainnet fork with the configured Thirdweb RPC.",
      );
    }
  });
  after(async () => {
    await hre.network.provider.send("hardhat_reset", []);
  });

  it("does not accept a silently moved empty-pool price as the founder's initial liquidity price", async () => {
    const network = deploymentNetworks.ethereum;
    const options = {
      ...(await deploymentOptions()),
      ...network,
      network: "mainnet-fork",
    };
    const manifest = await deployMarketplaceFromBrowser(options);
    const pool: VenturePool = {
      id: manifest.swap.poolId!,
      key: {
        currency0: hre.ethers.ZeroAddress,
        currency1: manifest.token.address,
        fee: 3000,
        tickSpacing: 60,
        hooks: hre.ethers.ZeroAddress,
      },
      currency0: {
        address: hre.ethers.ZeroAddress,
        symbol: "ETH",
        decimals: 18,
      },
      currency1: {
        address: manifest.token.address,
        symbol: "RCV",
        decimals: 18,
      },
    };
    const state = new Contract(
      network.stateViewAddress,
      [
        "function getSlot0(bytes32) view returns (uint160,int24,uint24,uint24)",
        "function getLiquidity(bytes32) view returns (uint128)",
      ],
      options.signer,
    );
    const before = await state.getFunction("getSlot0")(pool.id);
    assert.equal(await state.getFunction("getLiquidity")(pool.id), 0n);
    const client = new V4PositionClient(
      network.positionManagerAddress,
      network.permit2Address,
      options.signer,
    );
    const reviewed = await client.quoteFullRange(
      pool,
      network.stateViewAddress,
      parseEther("1"),
      parseEther("2000"),
      50,
    );
    const deadline = BigInt(
      (await hre.ethers.provider.getBlock("latest"))!.timestamp + 1200,
    );
    await client.approveCurrency(
      manifest.token.address,
      reviewed.amount1Maximum,
      Number(deadline),
    );
    const recipient = await options.signer.getAddress();
    const mint = () =>
      client.mintPosition({
        ...reviewed,
        poolKey: pool.key,
        recipient,
        deadline,
      });
    const snapshot = await hre.network.provider.send("evm_snapshot");
    const minted = await mint();
    assert.equal(
      await client.ownerOf(minted.tokenId),
      await options.signer.getAddress(),
    );
    assert.ok((await client.getPositionLiquidity(minted.tokenId)) > 0n);
    await hre.network.provider.send("evm_revert", [snapshot]);
    const mallory = (await hre.ethers.getSigners())[1];
    const attack = await (
      await hre.ethers.getContractFactory("PoolSwapTest", mallory)
    ).deploy(network.poolManagerAddress);
    await attack.waitForDeployment();
    await attack.getFunction("swap")(
      pool.key,
      {
        zeroForOne: false,
        amountSpecified: -1n,
        sqrtPriceLimitX96: before[0] * 2n,
      },
      { takeClaims: false, settleUsingBurn: false },
      "0x",
    );
    const moved = await state.getFunction("getSlot0")(pool.id);
    assert.equal(
      moved[0],
      before[0] * 2n,
      "The canonical empty pool must actually move for this regression to be meaningful.",
    );
    // Even if the price moves after review, canonical mint maximums must reject the stale mint.
    await assert.rejects(mint(), /revert|MaximumAmountExceeded/i);
    assert.equal(await state.getFunction("getLiquidity")(pool.id), 0n);
    await assert.rejects(
      client.quoteFullRange(
        pool,
        network.stateViewAddress,
        parseEther("1"),
        parseEther("2000"),
        50,
      ),
      /price|reference|initial|empty/i,
      "A first mint must bind the reviewed initial price, not silently adopt Mallory's moved price.",
    );
  });
});
