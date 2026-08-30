import assert from "node:assert/strict";
import { ethers, upgrades } from "hardhat";

describe("MarketplaceToken", () => {
  it("mints the configured fixed supply to the selected initial owner", async () => {
    const [, initialOwner] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("MarketplaceToken");
    const token = await upgrades.deployProxy(
      Token,
      [
        "Marketplace Token",
        "MKT",
        initialOwner.address,
        ethers.parseEther("21000000"),
      ],
      { kind: "uups", initializer: "initialize" },
    );

    assert.equal(await token.name(), "Marketplace Token");
    assert.equal(await token.symbol(), "MKT");
    assert.equal(await token.decimals(), 18n);
    assert.equal(await token.totalSupply(), ethers.parseEther("21000000"));
    assert.equal(
      await token.balanceOf(initialOwner.address),
      ethers.parseEther("21000000"),
    );
    assert.equal(await token.owner(), initialOwner.address);
  });

  it("does not permit upgrades until governance enables them", async () => {
    const [owner] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("MarketplaceToken");
    const token = await upgrades.deployProxy(
      Token,
      [
        "Marketplace Token",
        "MKT",
        owner.address,
        ethers.parseEther("21000000"),
      ],
      { kind: "uups", initializer: "initialize" },
    );
    const TokenV2 = await ethers.getContractFactory("MarketplaceTokenV2Mock");

    await assert.rejects(
      upgrades.upgradeProxy(await token.getAddress(), TokenV2, {
        unsafeAllow: ["missing-initializer-call"],
      }),
      /UpgradesDisabled/,
    );

    await token.enableUpgrades();
    const upgraded = await upgrades.upgradeProxy(
      await token.getAddress(),
      TokenV2,
      {
        unsafeAllow: ["missing-initializer-call"],
      },
    );
    assert.equal(await upgraded.version(), 2n);
  });

  it("permanently disables upgrades after governance shutdown", async () => {
    const [owner] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("MarketplaceToken");
    const token = await upgrades.deployProxy(
      Token,
      [
        "Marketplace Token",
        "MKT",
        owner.address,
        ethers.parseEther("21000000"),
      ],
      { kind: "uups", initializer: "initialize" },
    );

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
