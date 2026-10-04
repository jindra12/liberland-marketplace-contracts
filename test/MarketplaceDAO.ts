import assert from "node:assert/strict";
import { id, ZeroAddress } from "ethers";
import hre from "hardhat";

const deployGovernance = async (
  voterAmount = hre.ethers.parseEther("1000000"),
  otherBoundAmount = 0n,
) => {
  const [deployer, voter, recipient] = await hre.ethers.getSigners();
  const Forwarder = await hre.ethers.getContractFactory("MarketplaceForwarder");
  const forwarder = await Forwarder.deploy();
  await forwarder.waitForDeployment();
  const forwarderAddress = await forwarder.getAddress();

  const Token = await hre.ethers.getContractFactory("MarketplaceToken");
  const token = await hre.upgrades.deployProxy(
    Token,
    [
      "Marketplace Token",
      "MKT",
      deployer.address,
      hre.ethers.parseEther("21000000"),
    ],
    {
      kind: "uups",
      initializer: "initialize",
      constructorArgs: [forwarderAddress],
    },
  );

  const Timelock = await hre.ethers.getContractFactory("MarketplaceTimelock");
  const timelock = await hre.upgrades.deployProxy(
    Timelock,
    [2 * 24 * 60 * 60, [], [ZeroAddress], deployer.address],
    { kind: "uups", initializer: "initialize" },
  );

  const LP = await hre.ethers.getContractFactory("MarketplaceLPToken");
  const rewardImplementation = await LP.deploy(forwarderAddress);
  await rewardImplementation.waitForDeployment();
  const DAO = await hre.ethers.getContractFactory("MarketplaceDAO");
  const dao = await hre.upgrades.deployProxy(
    DAO,
    [
      await token.getAddress(),
      await timelock.getAddress(),
      await rewardImplementation.getAddress(),
    ],
    {
      kind: "uups",
      initializer: "initialize",
      constructorArgs: [forwarderAddress],
    },
  );

  const daoAddress = await dao.getAddress();
  await token.setGovernance(daoAddress);
  await token.transferOwnership(daoAddress);
  await timelock.grantRole(await timelock.PROPOSER_ROLE(), daoAddress);
  await timelock.grantRole(await timelock.CANCELLER_ROLE(), daoAddress);
  await timelock.renounceRole(
    await timelock.DEFAULT_ADMIN_ROLE(),
    deployer.address,
  );
  await token.transfer(voter.address, voterAmount);
  await token.connect(voter).getFunction("soulbound")(voterAmount);
  if (otherBoundAmount > 0n) {
    await token.transfer(recipient.address, otherBoundAmount);
    await token.connect(recipient).getFunction("soulbound")(otherBoundAmount);
  }
  return {
    deployer,
    voter,
    recipient,
    token,
    dao,
    timelock,
    forwarderAddress,
  };
};

const governCall = async (
  dao: Awaited<ReturnType<typeof deployGovernance>>["dao"],
  voter: Awaited<ReturnType<typeof deployGovernance>>["voter"],
  target: string,
  data: string,
) => {
  const targets = [target];
  const values = [0n];
  const calldatas = [data];
  const description = `Governance call ${data}`;
  const descriptionHash = id(description);
  const proposalId = await dao.hashProposal(
    targets,
    values,
    calldatas,
    descriptionHash,
  );
  await dao.connect(voter).getFunction("propose")(
    targets,
    values,
    calldatas,
    description,
  );

  await hre.network.provider.send("evm_increaseTime", [
    Number(await dao.votingDelay()) + 1,
  ]);
  await hre.network.provider.send("evm_mine");
  await dao.connect(voter).getFunction("castVote")(proposalId, 1);
  await hre.network.provider.send("evm_increaseTime", [
    Number(await dao.votingPeriod()) + 1,
  ]);
  await hre.network.provider.send("evm_mine");
  await dao.queue(targets, values, calldatas, descriptionHash);
  await hre.network.provider.send("evm_increaseTime", [2 * 24 * 60 * 60 + 1]);
  await hre.network.provider.send("evm_mine");
  await dao.execute(targets, values, calldatas, descriptionHash);
};

describe("MarketplaceDAO", () => {
  it("uses soulbound balances for votes and executes changes only through its timelock", async () => {
    const { deployer, voter, recipient, token, dao, forwarderAddress } =
      await deployGovernance();
    assert.equal(await dao.quorumNumerator(), 4n);
    assert.equal(await dao.votingDelay(), 24n * 60n * 60n);
    assert.equal(await dao.votingPeriod(), 7n * 24n * 60n * 60n);
    assert.equal(await dao.proposalThreshold(), hre.ethers.parseEther("1"));
    assert.notEqual(await dao.rewardToken(), ZeroAddress);
    assert.equal(
      await token.getVotes(voter.address),
      hre.ethers.parseEther("1000000"),
    );
    assert.equal(
      await token.getVotes((await hre.ethers.getSigners())[0].address),
      0n,
    );

    const amount = hre.ethers.parseEther("40");
    const unsoulboundData = token.interface.encodeFunctionData("unsoulbound", [
      voter.address,
      amount,
    ]);
    await governCall(
      dao,
      voter,
      await dao.getAddress(),
      dao.interface.encodeFunctionData("relay", [
        await token.getAddress(),
        0,
        unsoulboundData,
      ]),
    );
    assert.equal(
      await token.soulboundBalanceOf(voter.address),
      hre.ethers.parseEther("999960"),
    );
    await assert.rejects(
      token.connect(voter).getFunction("transfer")(
        voter.address,
        hre.ethers.parseEther("41"),
      ),
      /InsufficientLiquidBalance/,
    );
    await assert.rejects(
      dao.connect(voter).getFunction("setRewardPerPeriod")(1),
      /GovernorOnlyExecutor/,
    );

    const PoolManager = await hre.ethers.getContractFactory("MockPoolManager");
    const poolManager = await PoolManager.deploy(0);
    const Router = await hre.ethers.getContractFactory(
      "MarketplaceV4SwapRouter",
    );
    const router = await hre.upgrades.deployProxy(
      Router,
      [await poolManager.getAddress(), deployer.address],
      {
        kind: "uups",
        initializer: "initialize",
        constructorArgs: [forwarderAddress],
      },
    );
    await router.getFunction("setGovernance")(await dao.getAddress());
    await router.getFunction("transferOwnership")(await dao.getAddress());
    const feeData = router.interface.encodeFunctionData("setFee", [
      75,
      recipient.address,
    ]);
    await governCall(
      dao,
      voter,
      await dao.getAddress(),
      dao.interface.encodeFunctionData("relay", [
        await router.getAddress(),
        0,
        feeData,
      ]),
    );
    assert.equal(await router.getFunction("feeBps")(), 75n);
    assert.equal(await router.getFunction("feeRecipient")(), recipient.address);
    await assert.rejects(
      router.connect(voter).getFunction("setFee")(10, recipient.address),
      /GovernanceOnly/,
    );
  });

  it("prebinds DAO-funded tokens only through an approved proposal", async () => {
    const { deployer, voter, recipient, token, dao } = await deployGovernance();
    const preboundAmount = hre.ethers.parseEther("12");
    await token.connect(deployer).getFunction("transfer")(
      await dao.getAddress(),
      preboundAmount,
    );
    await assert.rejects(
      dao.connect(voter).getFunction("prebindTokens")(
        recipient.address,
        preboundAmount,
      ),
      /GovernorOnlyExecutor/,
    );
    await governCall(
      dao,
      voter,
      await dao.getAddress(),
      dao.interface.encodeFunctionData("prebindTokens", [
        recipient.address,
        preboundAmount,
      ]),
    );
    assert.equal(
      await token.getFunction("balanceOf")(recipient.address),
      preboundAmount,
    );
    assert.equal(
      await token.getFunction("soulboundBalanceOf")(recipient.address),
      preboundAmount,
    );
    assert.equal(
      await token.getFunction("getVotes")(recipient.address),
      preboundAmount,
    );
    assert.ok(
      (await token.getFunction("soulboundSince")(recipient.address)) > 0n,
    );
  });

  it("rejects proposals that fail the 4 percent quorum", async () => {
    const { voter, dao } = await deployGovernance(
      hre.ethers.parseEther("10000"),
      hre.ethers.parseEther("1000000"),
    );
    const targets = [await dao.getAddress()];
    const values = [0n];
    const calldatas = [
      dao.interface.encodeFunctionData("setRewardPerPeriod", [1]),
    ];
    const description = "Proposal below quorum";
    const proposalId = await dao.hashProposal(
      targets,
      values,
      calldatas,
      id(description),
    );
    await dao.connect(voter).getFunction("propose")(
      targets,
      values,
      calldatas,
      description,
    );
    await hre.network.provider.send("evm_increaseTime", [
      Number(await dao.votingDelay()) + 1,
    ]);
    await hre.network.provider.send("evm_mine");
    await dao.connect(voter).getFunction("castVote")(proposalId, 1);
    await hre.network.provider.send("evm_increaseTime", [
      Number(await dao.votingPeriod()) + 1,
    ]);
    await hre.network.provider.send("evm_mine");
    assert.equal(await dao.state(proposalId), 3n);
  });

  it("requires the full 30-day binding period, mints rewards, and redeems them for funded assets", async () => {
    const { voter, recipient, token, dao } = await deployGovernance();
    await assert.rejects(
      dao.connect(voter).getFunction("claimReward")(),
      /NothingToClaim/,
    );
    const rewardAmount = hre.ethers.parseEther("5");
    const redeemRate = hre.ethers.parseEther("2");
    await governCall(
      dao,
      voter,
      await dao.getAddress(),
      dao.interface.encodeFunctionData("setRewardPerPeriod", [rewardAmount]),
    );
    await governCall(
      dao,
      voter,
      await dao.getAddress(),
      dao.interface.encodeFunctionData("setRedemptionRate", [redeemRate]),
    );
    const reserveAmount = hre.ethers.parseEther("100");
    await token.transfer(await dao.getAddress(), reserveAmount);
    await governCall(
      dao,
      voter,
      await dao.getAddress(),
      dao.interface.encodeFunctionData("fundRewardReserve", [reserveAmount]),
    );

    await hre.network.provider.send("evm_increaseTime", [
      30 * 24 * 60 * 60 + 1,
    ]);
    await hre.network.provider.send("evm_mine");
    await dao.connect(voter).getFunction("claimReward")();
    const rewardToken = await hre.ethers.getContractAt(
      "MarketplaceLPToken",
      await dao.rewardToken(),
    );
    await rewardToken.connect(voter).getFunction("redeem")(
      rewardAmount,
      hre.ethers.parseEther("10"),
    );
    assert.equal(await rewardToken.balanceOf(voter.address), 0n);
    assert.equal(
      await token.balanceOf(voter.address),
      hre.ethers.parseEther("1000010"),
    );

    await token.transfer(recipient.address, 1n);
    await token.connect(recipient).getFunction("soulbound")(1n);
    await assert.rejects(
      dao.connect(recipient).getFunction("claimReward")(),
      /NothingToClaim/,
    );
  });

  it("blocks deployer-controlled governance and only upgrades by DAO execution", async () => {
    const { deployer, voter, dao, token, timelock, forwarderAddress } =
      await deployGovernance();
    const tokenV2 = await (
      await hre.ethers.getContractFactory("MarketplaceTokenV2Mock")
    ).deploy(forwarderAddress);
    await tokenV2.waitForDeployment();
    await assert.rejects(
      token.connect(deployer).getFunction("enableUpgrades")(),
      /GovernanceOnly/,
    );

    const enableData = token.interface.encodeFunctionData("enableUpgrades");
    await governCall(
      dao,
      voter,
      await dao.getAddress(),
      dao.interface.encodeFunctionData("relay", [
        await token.getAddress(),
        0,
        enableData,
      ]),
    );
    const upgradeData = token.interface.encodeFunctionData("upgradeToAndCall", [
      await tokenV2.getAddress(),
      "0x",
    ]);
    await governCall(
      dao,
      voter,
      await dao.getAddress(),
      dao.interface.encodeFunctionData("relay", [
        await token.getAddress(),
        0,
        upgradeData,
      ]),
    );
    const upgradedToken = await hre.ethers.getContractAt(
      "MarketplaceTokenV2Mock",
      await token.getAddress(),
    );
    assert.equal(await upgradedToken.version(), 2n);
    await assert.rejects(
      timelock.connect(deployer).getFunction("enableUpgrades")(),
      /TimelockSelfCallOnly/,
    );
    await governCall(
      dao,
      voter,
      await timelock.getAddress(),
      timelock.interface.encodeFunctionData("enableUpgrades"),
    );
    assert.equal(await timelock.upgradesEnabled(), true);

    await assert.rejects(
      dao.connect(deployer).getFunction("enableUpgrades")(),
      /GovernorOnlyExecutor/,
    );
    await assert.rejects(
      dao.getFunction("initialize")(
        await token.getAddress(),
        await timelock.getAddress(),
        await tokenV2.getAddress(),
      ),
      /InvalidInitialization/,
    );
    await governCall(
      dao,
      voter,
      await dao.getAddress(),
      dao.interface.encodeFunctionData("enableUpgrades"),
    );
    assert.equal(await dao.getFunction("upgradesEnabled")(), true);

    const daoV2 = await (
      await hre.ethers.getContractFactory("MarketplaceDAOV2Mock")
    ).deploy(forwarderAddress);
    await daoV2.waitForDeployment();
    await governCall(
      dao,
      voter,
      await dao.getAddress(),
      dao.interface.encodeFunctionData("upgradeToAndCall", [
        await daoV2.getAddress(),
        "0x",
      ]),
    );
    const upgradedDAO = await hre.ethers.getContractAt(
      "MarketplaceDAOV2Mock",
      await dao.getAddress(),
    );
    assert.equal(await upgradedDAO.getFunction("implementationVersion")(), 2n);
    await governCall(
      dao,
      voter,
      await dao.getAddress(),
      dao.interface.encodeFunctionData("disableUpgradesPermanently"),
    );
    assert.equal(
      await upgradedDAO.getFunction("upgradesPermanentlyDisabled")(),
      true,
    );
    await assert.rejects(
      upgradedDAO.connect(deployer).getFunction("enableUpgrades")(),
      /GovernorOnlyExecutor/,
    );
  });
});
