import assert from "node:assert/strict";
import hre from "hardhat";

const deployFixture = async () => {
  const [dao, alice, mallory] = await hre.ethers.getSigners();
  const forwarder = await (
    await hre.ethers.getContractFactory("MarketplaceForwarder")
  ).deploy();
  await forwarder.waitForDeployment();
  const Token = await hre.ethers.getContractFactory("MarketplaceToken");
  const asset = await hre.upgrades.deployProxy(
    Token,
    ["Underlying", "UND", dao.address, hre.ethers.parseEther("1000")],
    {
      kind: "uups",
      initializer: "initialize",
      constructorArgs: [await forwarder.getAddress()],
    },
  );
  const LPToken = await hre.ethers.getContractFactory("MarketplaceLPToken");
  const implementation = await LPToken.deploy(await forwarder.getAddress());
  await implementation.waitForDeployment();
  const reward = await hre.upgrades.deployProxy(
    LPToken,
    [dao.address, await asset.getAddress()],
    {
      kind: "uups",
      initializer: "initialize",
      constructorArgs: [await forwarder.getAddress()],
    },
  );
  return { dao, alice, mallory, forwarder, asset, implementation, reward };
};

describe("MarketplaceLPToken adversarial API coverage", () => {
  it("mints DAO-authorized rewards and redeems them at the configured rate", async () => {
    const { dao, alice, asset, reward } = await deployFixture();
    const rewardAmount = hre.ethers.parseEther("4");
    const payout = hre.ethers.parseEther("10");
    await reward.getFunction("setRedemptionRate")(hre.ethers.parseEther("2.5"));
    await asset.getFunction("transfer")(await reward.getAddress(), payout);
    await reward.getFunction("mint")(alice.address, rewardAmount);
    assert.equal(
      await reward.getFunction("balanceOf")(alice.address),
      rewardAmount,
    );

    await reward.connect(alice).getFunction("redeem")(rewardAmount, payout);
    assert.equal(await reward.getFunction("balanceOf")(alice.address), 0n);
    assert.equal(await asset.getFunction("balanceOf")(alice.address), payout);
    assert.equal(
      await asset.getFunction("balanceOf")(await reward.getAddress()),
      0n,
    );
    assert.equal(await reward.getFunction("dao")(), dao.address);
  });

  it("rejects Mallory's mint/configuration, replay-like over-redemption, slippage, and unfunded payout", async () => {
    const { alice, mallory, asset, reward } = await deployFixture();
    await assert.rejects(
      reward.connect(mallory).getFunction("mint")(mallory.address, 1n),
      /DAOOnly/,
    );
    await assert.rejects(
      reward.connect(mallory).getFunction("setRedemptionRate")(1n),
      /DAOOnly/,
    );

    const rewardAmount = hre.ethers.parseEther("2");
    const payout = hre.ethers.parseEther("6");
    await reward.getFunction("setRedemptionRate")(hre.ethers.parseEther("3"));
    await reward.getFunction("mint")(alice.address, rewardAmount);
    await assert.rejects(
      reward.connect(alice).getFunction("redeem")(rewardAmount, payout + 1n),
      /RedemptionSlippage/,
    );
    await assert.rejects(
      reward.connect(alice).getFunction("redeem")(rewardAmount + 1n, 0n),
      /InsufficientRedemptionReserve/,
    );
    await assert.rejects(
      reward.connect(alice).getFunction("redeem")(rewardAmount, 0n),
      /InsufficientRedemptionReserve/,
    );
    await assert.rejects(
      reward.connect(alice).getFunction("redeem")(0n, 0n),
      /InvalidRedemption/,
    );
    await reward.getFunction("setRedemptionRate")(0n);
    await assert.rejects(
      reward.connect(alice).getFunction("redeem")(1n, 0n),
      /InvalidRedemption/,
    );
    await reward.getFunction("setRedemptionRate")(1n);
    await assert.rejects(
      reward.connect(alice).getFunction("redeem")(1n, 0n),
      /InvalidRedemption/,
    );
    assert.equal(
      await asset.getFunction("balanceOf")(await reward.getAddress()),
      0n,
    );
  });

  it("protects initialization and permanently frozen implementation upgrades", async () => {
    const { dao, mallory, forwarder, reward } = await deployFixture();
    await assert.rejects(
      reward.getFunction("initialize")(dao.address, dao.address),
      /InvalidInitialization/,
    );
    await assert.rejects(
      reward.connect(mallory).getFunction("enableUpgrades")(),
      /DAOOnly/,
    );
    await reward.getFunction("enableUpgrades")();
    await reward.getFunction("disableUpgradesPermanently")();
    assert.equal(await reward.getFunction("upgradesEnabled")(), false);
    assert.equal(
      await reward.getFunction("upgradesPermanentlyDisabled")(),
      true,
    );
    await assert.rejects(
      reward.getFunction("enableUpgrades")(),
      /UpgradesPermanentlyDisabledError/,
    );
    const V2 = await hre.ethers.getContractFactory("MarketplaceLPTokenV2Mock");
    const v2 = await V2.deploy(await forwarder.getAddress());
    await v2.waitForDeployment();
    await assert.rejects(
      reward.getFunction("upgradeToAndCall")(await v2.getAddress(), "0x"),
      /UpgradesPermanentlyDisabledError|UpgradesDisabled/,
    );
  });
});
