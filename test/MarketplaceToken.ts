import assert from "node:assert/strict";
import hre from "hardhat";

describe("MarketplaceToken", () => {
  it("mints the configured fixed supply to the selected initial owner", async () => {
    const [, initialOwner] = await hre.ethers.getSigners();
    const Token = await hre.ethers.getContractFactory("MarketplaceToken");
    const forwarder = await (
      await hre.ethers.getContractFactory("MarketplaceForwarder")
    ).deploy();
    await forwarder.waitForDeployment();
    const token = await hre.upgrades.deployProxy(
      Token,
      [
        "Marketplace Token",
        "MKT",
        initialOwner.address,
        hre.ethers.parseEther("21000000"),
      ],
      {
        kind: "uups",
        initializer: "initialize",
        constructorArgs: [await forwarder.getAddress()],
      },
    );

    assert.equal(await token.name(), "Marketplace Token");
    assert.equal(await token.symbol(), "MKT");
    assert.equal(await token.decimals(), 18n);
    assert.equal(await token.totalSupply(), hre.ethers.parseEther("21000000"));
    assert.equal(
      await token.balanceOf(initialOwner.address),
      hre.ethers.parseEther("21000000"),
    );
    assert.equal(await token.owner(), initialOwner.address);
  });

  it("does not permit upgrades until governance enables them", async () => {
    const [owner] = await hre.ethers.getSigners();
    const Token = await hre.ethers.getContractFactory("MarketplaceToken");
    const forwarder = await (
      await hre.ethers.getContractFactory("MarketplaceForwarder")
    ).deploy();
    await forwarder.waitForDeployment();
    const token = await hre.upgrades.deployProxy(
      Token,
      [
        "Marketplace Token",
        "MKT",
        owner.address,
        hre.ethers.parseEther("21000000"),
      ],
      {
        kind: "uups",
        initializer: "initialize",
        constructorArgs: [await forwarder.getAddress()],
      },
    );
    await token.setGovernance(owner.address);
    const TokenV2 = await hre.ethers.getContractFactory(
      "MarketplaceTokenV2Mock",
    );
    const tokenV2 = await TokenV2.deploy(await forwarder.getAddress());
    await tokenV2.waitForDeployment();

    await assert.rejects(
      token.getFunction("upgradeToAndCall")(await tokenV2.getAddress(), "0x"),
      /UpgradesDisabled/,
    );

    await token.enableUpgrades();
    await token.getFunction("upgradeToAndCall")(
      await tokenV2.getAddress(),
      "0x",
    );
    const upgraded = await hre.ethers.getContractAt(
      "MarketplaceTokenV2Mock",
      await token.getAddress(),
    );
    assert.equal(await upgraded.version(), 2n);
  });

  it("permanently disables upgrades after governance shutdown", async () => {
    const [owner] = await hre.ethers.getSigners();
    const Token = await hre.ethers.getContractFactory("MarketplaceToken");
    const forwarder = await (
      await hre.ethers.getContractFactory("MarketplaceForwarder")
    ).deploy();
    await forwarder.waitForDeployment();
    const token = await hre.upgrades.deployProxy(
      Token,
      [
        "Marketplace Token",
        "MKT",
        owner.address,
        hre.ethers.parseEther("21000000"),
      ],
      {
        kind: "uups",
        initializer: "initialize",
        constructorArgs: [await forwarder.getAddress()],
      },
    );
    await token.setGovernance(owner.address);

    await token.enableUpgrades();
    await token.disableUpgradesPermanently();

    assert.equal(await token.upgradesEnabled(), false);
    assert.equal(await token.upgradesPermanentlyDisabled(), true);
    await assert.rejects(
      token.enableUpgrades(),
      /UpgradesPermanentlyDisabledError/,
    );
  });
});
