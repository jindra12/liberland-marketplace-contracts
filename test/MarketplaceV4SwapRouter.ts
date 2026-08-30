import assert from "node:assert/strict";
import { ethers, upgrades } from "hardhat";

describe("MarketplaceV4SwapRouter", () => {
  const deployFixture = async () => {
    const [owner, trader] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("MarketplaceToken");
    const tokenIn = await upgrades.deployProxy(
      Token,
      ["Input Token", "IN", owner.address, ethers.parseEther("21000000")],
      { kind: "uups", initializer: "initialize" },
    );
    const tokenOut = await upgrades.deployProxy(
      Token,
      ["Output Token", "OUT", owner.address, ethers.parseEther("21000000")],
      { kind: "uups", initializer: "initialize" },
    );
    const PoolManager = await ethers.getContractFactory("MockPoolManager");
    const poolManager = await PoolManager.deploy(ethers.parseEther("90"));
    const Router = await ethers.getContractFactory("MarketplaceV4SwapRouter");
    const router = await upgrades.deployProxy(
      Router,
      [await poolManager.getAddress(), owner.address],
      {
        kind: "uups",
        initializer: "initialize",
      },
    );

    await tokenIn.transfer(trader.address, ethers.parseEther("100"));
    await tokenOut.transfer(
      await poolManager.getAddress(),
      ethers.parseEther("90"),
    );
    await tokenIn.connect(trader).getFunction("approve")(
      await router.getAddress(),
      ethers.parseEther("100"),
    );

    return { owner, trader, tokenIn, tokenOut, poolManager, router };
  };

  it("settles input and takes the V4 output for the trader", async () => {
    const { trader, tokenIn, tokenOut, router } = await deployFixture();
    const key = {
      currency0: await tokenIn.getAddress(),
      currency1: await tokenOut.getAddress(),
      fee: 3000,
      tickSpacing: 60,
      hooks: ethers.ZeroAddress,
    };

    const amountOut = await router
      .connect(trader)
      .getFunction("swapExactInputSingle")
      .staticCall(
        key,
        true,
        ethers.parseEther("100"),
        ethers.parseEther("89"),
        "0x",
      );
    await router.connect(trader).getFunction("swapExactInputSingle")(
      key,
      true,
      ethers.parseEther("100"),
      ethers.parseEther("89"),
      "0x",
    );

    assert.equal(amountOut, ethers.parseEther("90"));
    assert.equal(await tokenIn.getFunction("balanceOf")(trader.address), 0n);
    assert.equal(
      await tokenOut.getFunction("balanceOf")(trader.address),
      ethers.parseEther("90"),
    );
  });

  it("rejects output below the caller's minimum", async () => {
    const { trader, tokenIn, tokenOut, router } = await deployFixture();
    const key = {
      currency0: await tokenIn.getAddress(),
      currency1: await tokenOut.getAddress(),
      fee: 3000,
      tickSpacing: 60,
      hooks: ethers.ZeroAddress,
    };

    await assert.rejects(
      router.connect(trader).getFunction("swapExactInputSingle")(
        key,
        true,
        ethers.parseEther("100"),
        ethers.parseEther("91"),
        "0x",
      ),
      /InsufficientOutput/,
    );
  });
});
