import assert from "node:assert/strict";
import hre from "hardhat";

describe("MarketplaceV4SwapRouter", () => {
  const deployFixture = async () => {
    const [owner, trader] = await hre.ethers.getSigners();
    const Token = await hre.ethers.getContractFactory("MarketplaceToken");
    const tokenIn = await hre.upgrades.deployProxy(
      Token,
      ["Input Token", "IN", owner.address, hre.ethers.parseEther("21000000")],
      { kind: "uups", initializer: "initialize" },
    );
    const tokenOut = await hre.upgrades.deployProxy(
      Token,
      ["Output Token", "OUT", owner.address, hre.ethers.parseEther("21000000")],
      { kind: "uups", initializer: "initialize" },
    );
    const PoolManager = await hre.ethers.getContractFactory("MockPoolManager");
    const poolManager = await PoolManager.deploy(hre.ethers.parseEther("90"));
    const Router = await hre.ethers.getContractFactory(
      "MarketplaceV4SwapRouter",
    );
    const router = await hre.upgrades.deployProxy(
      Router,
      [await poolManager.getAddress(), owner.address],
      {
        kind: "uups",
        initializer: "initialize",
      },
    );

    await tokenIn.transfer(trader.address, hre.ethers.parseEther("100"));
    await tokenOut.transfer(
      await poolManager.getAddress(),
      hre.ethers.parseEther("90"),
    );
    await tokenIn.connect(trader).getFunction("approve")(
      await router.getAddress(),
      hre.ethers.parseEther("100"),
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
      hooks: hre.ethers.ZeroAddress,
    };

    const amountOut = await router
      .connect(trader)
      .getFunction("swapExactInputSingle")
      .staticCall(
        key,
        true,
        hre.ethers.parseEther("100"),
        hre.ethers.parseEther("89"),
        "0x",
      );
    await router.connect(trader).getFunction("swapExactInputSingle")(
      key,
      true,
      hre.ethers.parseEther("100"),
      hre.ethers.parseEther("89"),
      "0x",
    );

    assert.equal(amountOut, hre.ethers.parseEther("90"));
    assert.equal(await tokenIn.getFunction("balanceOf")(trader.address), 0n);
    assert.equal(
      await tokenOut.getFunction("balanceOf")(trader.address),
      hre.ethers.parseEther("90"),
    );
  });

  it("rejects output below the caller's minimum", async () => {
    const { trader, tokenIn, tokenOut, router } = await deployFixture();
    const key = {
      currency0: await tokenIn.getAddress(),
      currency1: await tokenOut.getAddress(),
      fee: 3000,
      tickSpacing: 60,
      hooks: hre.ethers.ZeroAddress,
    };

    await assert.rejects(
      router.connect(trader).getFunction("swapExactInputSingle")(
        key,
        true,
        hre.ethers.parseEther("100"),
        hre.ethers.parseEther("91"),
        "0x",
      ),
      /InsufficientOutput/,
    );
  });
});
