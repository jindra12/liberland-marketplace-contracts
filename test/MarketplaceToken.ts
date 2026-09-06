import assert from "node:assert/strict";
import hre from "hardhat";

describe("MarketplaceToken", () => {
  it("mints the configured fixed supply to the selected initial owner", async () => {
    const [, initialOwner] = await hre.ethers.getSigners();
    const Token = await hre.ethers.getContractFactory("MarketplaceToken");
    const token = await hre.upgrades.deployProxy(
      Token,
      [
        "Marketplace Token",
        "MKT",
        initialOwner.address,
        hre.ethers.parseEther("21000000"),
      ],
      { kind: "uups", initializer: "initialize" },
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
    const token = await hre.upgrades.deployProxy(
      Token,
      [
        "Marketplace Token",
        "MKT",
        owner.address,
        hre.ethers.parseEther("21000000"),
      ],
      { kind: "uups", initializer: "initialize" },
    );
    await token.setGovernance(owner.address);
    const TokenV2 = await hre.ethers.getContractFactory(
      "MarketplaceTokenV2Mock",
    );

    await assert.rejects(
      hre.upgrades.upgradeProxy(await token.getAddress(), TokenV2, {
        unsafeAllow: ["missing-initializer-call"],
      }),
      /UpgradesDisabled/,
    );

    await token.enableUpgrades();
    const upgraded = await hre.upgrades.upgradeProxy(
      await token.getAddress(),
      TokenV2,
      {
        unsafeAllow: ["missing-initializer-call"],
      },
    );
    assert.equal(await upgraded.version(), 2n);
  });

  it("permanently disables upgrades after governance shutdown", async () => {
    const [owner] = await hre.ethers.getSigners();
    const Token = await hre.ethers.getContractFactory("MarketplaceToken");
    const token = await hre.upgrades.deployProxy(
      Token,
      [
        "Marketplace Token",
        "MKT",
        owner.address,
        hre.ethers.parseEther("21000000"),
      ],
      { kind: "uups", initializer: "initialize" },
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
