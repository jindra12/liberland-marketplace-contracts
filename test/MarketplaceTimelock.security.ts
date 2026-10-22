import assert from "node:assert/strict";
import { id, ZeroHash } from "ethers";
import hre from "hardhat";

const deployTimelock = async () => {
  const [admin, mallory] = await hre.ethers.getSigners();
  const Timelock = await hre.ethers.getContractFactory("MarketplaceTimelock");
  const timelock = await hre.upgrades.deployProxy(
    Timelock,
    [60, [admin.address], [admin.address], admin.address],
    { kind: "uups", initializer: "initialize" },
  );
  return { admin, mallory, timelock };
};

const executeSelfCall = async (
  timelock: Awaited<ReturnType<typeof deployTimelock>>["timelock"],
  functionName: "enableUpgrades" | "disableUpgradesPermanently",
) => {
  const address = await timelock.getAddress();
  const data = timelock.interface.encodeFunctionData(functionName);
  const salt = id(functionName);
  const delay = await timelock.getMinDelay();
  await timelock.getFunction("schedule")(
    address,
    0n,
    data,
    ZeroHash,
    salt,
    delay,
  );
  await hre.network.provider.send("evm_increaseTime", [Number(delay)]);
  await hre.network.provider.send("evm_mine");
  await timelock.getFunction("execute")(address, 0n, data, ZeroHash, salt);
};

describe("MarketplaceTimelock adversarial API coverage", () => {
  it("enables upgrades only through a scheduled self-call and can permanently freeze them", async () => {
    const { timelock } = await deployTimelock();
    await executeSelfCall(timelock, "enableUpgrades");
    assert.equal(await timelock.getFunction("upgradesEnabled")(), true);
    await executeSelfCall(timelock, "disableUpgradesPermanently");
    assert.equal(await timelock.getFunction("upgradesEnabled")(), false);
    assert.equal(
      await timelock.getFunction("upgradesPermanentlyDisabled")(),
      true,
    );
    await assert.rejects(
      timelock.getFunction("enableUpgrades")(),
      /TimelockSelfCallOnly/,
    );
  });

  it("rejects Mallory's attempts to administer roles or directly toggle upgrades", async () => {
    const { admin, mallory, timelock } = await deployTimelock();
    const role = await timelock.getFunction("PROPOSER_ROLE")();
    await assert.rejects(
      timelock.connect(mallory).getFunction("grantRole")(role, mallory.address),
      /AccessControlUnauthorizedAccount/,
    );
    await assert.rejects(
      timelock.connect(mallory).getFunction("revokeRole")(role, admin.address),
      /AccessControlUnauthorizedAccount/,
    );
    await assert.rejects(
      timelock.connect(mallory).getFunction("initialize")(
        0,
        [],
        [],
        mallory.address,
      ),
      /InvalidInitialization/,
    );
    await assert.rejects(
      timelock.connect(mallory).getFunction("disableUpgradesPermanently")(),
      /TimelockSelfCallOnly/,
    );
    assert.equal(
      await timelock.getFunction("hasRole")(role, admin.address),
      true,
    );
  });
});
