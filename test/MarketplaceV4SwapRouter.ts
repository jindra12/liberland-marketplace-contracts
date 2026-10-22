import assert from "node:assert/strict";
import type { Log, LogDescription } from "ethers";
import hre from "hardhat";
import { MarketplaceSwapClient } from "../src/client/trading";

describe("MarketplaceV4SwapRouter", () => {
  const deployFixture = async () => {
    const [owner, trader] = await hre.ethers.getSigners();
    const Forwarder = await hre.ethers.getContractFactory(
      "MarketplaceForwarder",
    );
    const forwarder = await Forwarder.deploy();
    await forwarder.waitForDeployment();
    const Token = await hre.ethers.getContractFactory("MarketplaceToken");
    const tokenIn = await hre.upgrades.deployProxy(
      Token,
      ["Input Token", "IN", owner.address, hre.ethers.parseEther("21000000")],
      {
        kind: "uups",
        initializer: "initialize",
        constructorArgs: [await forwarder.getAddress()],
      },
    );
    const tokenOut = await hre.upgrades.deployProxy(
      Token,
      ["Output Token", "OUT", owner.address, hre.ethers.parseEther("21000000")],
      {
        kind: "uups",
        initializer: "initialize",
        constructorArgs: [await forwarder.getAddress()],
      },
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
        constructorArgs: [await forwarder.getAddress()],
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
    const transaction = await router
      .connect(trader)
      .getFunction("swapExactInputSingle")(
      key,
      true,
      hre.ethers.parseEther("100"),
      hre.ethers.parseEther("89"),
      "0x",
    );
    const receipt = await transaction.wait();
    assert.ok(receipt);
    const routerEvent = receipt.logs
      .filter((log: Log) => log.address === router.target)
      .map((log: Log) => router.interface.parseLog(log))
      .find((event: LogDescription | null) => event?.name === "SwapExecuted");
    assert.equal(routerEvent?.args.sender, trader.address);

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

  it("discovers pools, quotes and trades through the typed browser client", async () => {
    const { trader, tokenIn, tokenOut, poolManager, router } =
      await deployFixture();
    const key = {
      currency0: await tokenIn.getAddress(),
      currency1: await tokenOut.getAddress(),
      fee: 3000,
      tickSpacing: 60,
      hooks: hre.ethers.ZeroAddress,
    };
    await poolManager.getFunction("announcePool")(key);
    const quoter = await (
      await hre.ethers.getContractFactory("MockV4Quoter")
    ).deploy(await poolManager.getAddress());
    const client = new MarketplaceSwapClient(
      {
        router: await router.getAddress(),
        poolManager: await poolManager.getAddress(),
        quoter: await quoter.getAddress(),
      },
      hre.ethers.provider,
    );
    const pools = await client.listPools(await tokenIn.getAddress());
    assert.equal(pools.items.length, 1);
    assert.equal(pools.items[0].currency0.symbol, "IN");
    const quote = await client.quote(
      pools.items[0],
      key.currency0,
      hre.ethers.parseEther("100"),
      100,
    );
    assert.equal(quote.amountOut, hre.ethers.parseEther("90"));
    assert.equal(quote.minimumOut, hre.ethers.parseEther("89.1"));
    await tokenIn.connect(trader).getFunction("approve")(
      await router.getAddress(),
      0,
    );
    const hash = await client.swap(quote, trader);
    assert.match(hash, /^0x[0-9a-f]{64}$/);
    assert.equal(
      await tokenOut.getFunction("balanceOf")(trader.address),
      quote.amountOut,
    );
    assert.equal(
      await tokenIn.getFunction("allowance")(
        trader.address,
        await router.getAddress(),
      ),
      0n,
    );
  });

  it("rejects malicious trade inputs and a quoter from another manager", async () => {
    const { trader, tokenIn, tokenOut, poolManager, router } =
      await deployFixture();
    const key = {
      currency0: await tokenIn.getAddress(),
      currency1: await tokenOut.getAddress(),
      fee: 3000,
      tickSpacing: 60,
      hooks: hre.ethers.ZeroAddress,
    };
    await poolManager.getFunction("announcePool")(key);
    const quoter = await (
      await hre.ethers.getContractFactory("MockV4Quoter")
    ).deploy(await poolManager.getAddress());
    const client = new MarketplaceSwapClient(
      {
        router: await router.getAddress(),
        poolManager: await poolManager.getAddress(),
        quoter: await quoter.getAddress(),
      },
      hre.ethers.provider,
    );
    const pool = (await client.listPools(key.currency0)).items[0];
    await assert.rejects(
      client.quote(pool, key.currency0, 0n, 100),
      /positive amount/,
    );
    await assert.rejects(
      client.quote(pool, key.currency0, 1n, 1001),
      /Slippage/,
    );
    await assert.rejects(
      client.quote(pool, trader.address, 1n, 100),
      /not part/,
    );
    const quote = await client.quote(
      pool,
      key.currency0,
      hre.ethers.parseEther("100"),
      100,
    );
    await assert.rejects(
      client.swap({ ...quote, minimumOut: 0n }, trader),
      /positive minimum/,
    );
    await assert.rejects(
      client.swap({ ...quote, minimumOut: quote.amountOut + 1n }, trader),
      /price moved/,
    );
    const wrongManager = await (
      await hre.ethers.getContractFactory("MockPoolManager")
    ).deploy(1);
    const wrongQuoter = await (
      await hre.ethers.getContractFactory("MockV4Quoter")
    ).deploy(await wrongManager.getAddress());
    const wrongClient = new MarketplaceSwapClient(
      {
        router: await router.getAddress(),
        poolManager: await poolManager.getAddress(),
        quoter: await wrongQuoter.getAddress(),
      },
      hre.ethers.provider,
    );
    await assert.rejects(
      wrongClient.quote(pool, key.currency0, 1n, 100),
      /PoolManager/,
    );
  });

  it("charges the configured fee once and emits the effective trader as the sender", async () => {
    const { owner, trader, tokenIn, tokenOut, router } = await deployFixture();
    const feeRecipient = (await hre.ethers.getSigners())[3];
    await router.getFunction("setGovernance")(owner.address);
    await assert.rejects(
      router.getFunction("upgradeToAndCall")(owner.address, "0x"),
      /UpgradesDisabled/,
    );
    await router.getFunction("setFee")(250, feeRecipient.address);
    const key = {
      currency0: await tokenIn.getAddress(),
      currency1: await tokenOut.getAddress(),
      fee: 3000,
      tickSpacing: 60,
      hooks: hre.ethers.ZeroAddress,
    };

    await router.connect(trader).getFunction("swapExactInputSingle")(
      key,
      true,
      hre.ethers.parseEther("100"),
      hre.ethers.parseEther("89"),
      "0x",
    );

    assert.equal(
      await tokenIn.getFunction("balanceOf")(feeRecipient.address),
      hre.ethers.parseEther("2.5"),
    );
    assert.equal(
      await tokenIn.getFunction("balanceOf")(await router.getAddress()),
      0n,
    );
    assert.equal(
      await tokenIn.getFunction("balanceOf")(await router.poolManager()),
      hre.ethers.parseEther("97.5"),
    );
    await assert.rejects(
      router.connect(trader).getFunction("setFee")(1, feeRecipient.address),
      /GovernanceOnly/,
    );
    await router.getFunction("enableUpgrades")();
    await router.getFunction("disableUpgradesPermanently")();
    assert.equal(
      await router.getFunction("upgradesPermanentlyDisabled")(),
      true,
    );
    await assert.rejects(
      router.getFunction("enableUpgrades")(),
      /UpgradesPermanentlyDisabledError/,
    );
    await assert.rejects(
      router.getFunction("upgradeToAndCall")(owner.address, "0x"),
      /UpgradesDisabled/,
    );
  });

  it("rejects malformed fees, callback spoofing, and inconsistent native value", async () => {
    const { owner, trader, tokenIn, router } = await deployFixture();
    const mallory = (await hre.ethers.getSigners())[2];
    await router.getFunction("setGovernance")(owner.address);
    await assert.rejects(
      router.getFunction("setFee")(1001, owner.address),
      /InvalidFee/,
    );
    await assert.rejects(
      router.getFunction("setFee")(1, hre.ethers.ZeroAddress),
      /InvalidFee/,
    );
    await assert.rejects(
      router.connect(mallory).getFunction("unlockCallback")("0x"),
      /InvalidCallbackCaller/,
    );
    const key = {
      currency0: await tokenIn.getAddress(),
      currency1: hre.ethers.ZeroAddress,
      fee: 3000,
      tickSpacing: 60,
      hooks: hre.ethers.ZeroAddress,
    };
    await assert.rejects(
      router.connect(trader).getFunction("swapExactInputSingle")(
        key,
        false,
        2n,
        0n,
        "0x",
        { value: 1n },
      ),
      /InvalidValue/,
    );
    await assert.rejects(
      router.connect(trader).getFunction("swapExactInputSingle")(
        key,
        true,
        1n,
        0n,
        "0x",
        { value: 1n },
      ),
      /InvalidValue/,
    );
  });
});
