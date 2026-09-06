import assert from "node:assert/strict";
import hre from "hardhat";

describe("MarketplaceDAO", () => {
  const deployTokenAndDao = async () => {
    const [owner, voter, recipient] = await hre.ethers.getSigners();
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
    const DAO = await hre.ethers.getContractFactory("MarketplaceDAO");
    const LP = await hre.ethers.getContractFactory("MarketplaceLPToken");
    const rewardImplementation = await LP.deploy();
    await rewardImplementation.waitForDeployment();
    const dao = await hre.upgrades.deployProxy(
      DAO,
      [
        await token.getAddress(),
        owner.address,
        await rewardImplementation.getAddress(),
      ],
      { kind: "uups", initializer: "initialize" },
    );
    await token.setGovernance(await dao.getAddress());
    await token.transfer(voter.address, hre.ethers.parseEther("100"));
    await token.connect(voter).getFunction("soulbound")(
      hre.ethers.parseEther("100"),
    );
    return { owner, voter, recipient, token, dao };
  };

  const passProposal = async (
    dao: Awaited<ReturnType<typeof deployTokenAndDao>>["dao"],
    voter: Awaited<ReturnType<typeof deployTokenAndDao>>["voter"],
    target: string,
    data: string,
  ) => {
    await dao.connect(voter).getFunction("propose")(target, 0, data);
    const id = (await dao.proposalCount()) - 1n;
    await dao.connect(voter).getFunction("vote")(id, true);
    await hre.network.provider.send("evm_increaseTime", [3 * 24 * 60 * 60 + 1]);
    await hre.network.provider.send("evm_mine");
    await dao.getFunction("execute")(id);
  };

  it("uses only soulbound balances as voting power and unbinds through DAO execution", async () => {
    const { voter, token, dao } = await deployTokenAndDao();
    const amount = hre.ethers.parseEther("40");
    await passProposal(
      dao,
      voter,
      await token.getAddress(),
      token.interface.encodeFunctionData("unsoulbound", [
        voter.address,
        amount,
      ]),
    );

    assert.equal(
      await token.soulboundBalanceOf(voter.address),
      hre.ethers.parseEther("60"),
    );
    await assert.rejects(
      token.connect(voter).getFunction("transfer")(
        voter.address,
        hre.ethers.parseEther("61"),
      ),
      /InsufficientLiquidBalance/,
    );
  });

  it("lets the DAO set router fees and routes the fee to its recipient", async () => {
    const { owner, voter, recipient, token, dao } = await deployTokenAndDao();
    const PoolManager = await hre.ethers.getContractFactory("MockPoolManager");
    const poolManager = await PoolManager.deploy(hre.ethers.parseEther("90"));
    const Router = await hre.ethers.getContractFactory(
      "MarketplaceV4SwapRouter",
    );
    const router = await hre.upgrades.deployProxy(
      Router,
      [await poolManager.getAddress(), owner.address],
      { kind: "uups", initializer: "initialize" },
    );
    await router.setGovernance(await dao.getAddress());
    await passProposal(
      dao,
      voter,
      await router.getAddress(),
      router.interface.encodeFunctionData("setFee", [100, recipient.address]),
    );

    await token.getFunction("transfer")(
      voter.address,
      hre.ethers.parseEther("100"),
    );
    const tokenOut = await hre.ethers.getContractFactory("MarketplaceToken");
    const outputToken = await hre.upgrades.deployProxy(
      tokenOut,
      ["Output Token", "OUT", owner.address, hre.ethers.parseEther("21000000")],
      { kind: "uups", initializer: "initialize" },
    );
    await outputToken.transfer(
      await poolManager.getAddress(),
      hre.ethers.parseEther("90"),
    );
    await token.connect(voter).getFunction("approve")(
      await router.getAddress(),
      hre.ethers.parseEther("100"),
    );
    const key = {
      currency0: await token.getAddress(),
      currency1: await outputToken.getAddress(),
      fee: 3000,
      tickSpacing: 60,
      hooks: hre.ethers.ZeroAddress,
    };
    await router.connect(voter).getFunction("swapExactInputSingle")(
      key,
      true,
      hre.ethers.parseEther("100"),
      hre.ethers.parseEther("90"),
      "0x",
    );
    assert.equal(
      await token.balanceOf(recipient.address),
      hre.ethers.parseEther("1"),
    );
  });

  it("allows DAO-controlled reward configuration, pre-bound grants, and monthly claims", async () => {
    const { voter, recipient, token, dao } = await deployTokenAndDao();
    const reward = hre.ethers.parseEther("5");
    await passProposal(
      dao,
      voter,
      await dao.getAddress(),
      dao.interface.encodeFunctionData("setRewardPerPeriod", [reward]),
    );
    await token.getFunction("transfer")(
      await dao.getAddress(),
      hre.ethers.parseEther("25"),
    );
    await passProposal(
      dao,
      voter,
      await dao.getAddress(),
      dao.interface.encodeFunctionData("prebindTokens", [
        recipient.address,
        hre.ethers.parseEther("25"),
      ]),
    );
    assert.equal(
      await token.soulboundBalanceOf(recipient.address),
      hre.ethers.parseEther("25"),
    );

    await dao.connect(recipient).getFunction("claimReward")();
    const rewardToken = await hre.ethers.getContractAt(
      "MarketplaceLPToken",
      await dao.rewardToken(),
    );
    assert.equal(await rewardToken.balanceOf(recipient.address), reward);
    const LPV2 = await hre.ethers.getContractFactory(
      "MarketplaceLPTokenV2Mock",
    );
    const rewardImplementation = await LPV2.deploy();
    await rewardImplementation.waitForDeployment();
    await passProposal(
      dao,
      voter,
      await rewardToken.getAddress(),
      rewardToken.interface.encodeFunctionData("enableUpgrades"),
    );
    await passProposal(
      dao,
      voter,
      await rewardToken.getAddress(),
      rewardToken.interface.encodeFunctionData("upgradeToAndCall", [
        await rewardImplementation.getAddress(),
        "0x",
      ]),
    );
    const upgradedReward = await hre.ethers.getContractAt(
      "MarketplaceLPTokenV2Mock",
      await rewardToken.getAddress(),
    );
    assert.equal(await upgradedReward.getFunction("version")(), 2n);
    await hre.network.provider.send("evm_increaseTime", [
      30 * 24 * 60 * 60 + 1,
    ]);
    await hre.network.provider.send("evm_mine");
    await dao.connect(recipient).getFunction("claimReward")();
  });

  it("allows the administrative owner to upgrade the DAO proxy", async () => {
    const { owner, dao } = await deployTokenAndDao();
    const DAOV2 = await hre.ethers.getContractFactory("MarketplaceDAOV2Mock");
    await dao.enableUpgrades();
    const upgraded = await hre.upgrades.upgradeProxy(
      await dao.getAddress(),
      DAOV2.connect(owner),
    );
    assert.equal(await upgraded.getFunction("version")(), 2n);
  });

  it("permanently freezes DAO upgrades when the owner disables them", async () => {
    const { owner, dao } = await deployTokenAndDao();
    const DAOV2 = await hre.ethers.getContractFactory("MarketplaceDAOV2Mock");
    await dao.enableUpgrades();
    await dao.disableUpgradesPermanently();
    await assert.rejects(
      hre.upgrades.upgradeProxy(await dao.getAddress(), DAOV2.connect(owner)),
      /UpgradesDisabled/,
    );
  });
});
