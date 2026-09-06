import assert from "node:assert/strict";
import type { LogDescription } from "ethers";
import hre from "hardhat";

describe("MarketplaceDeploymentCoordinator", () => {
  const implementationCode = async (owner: string) => {
    const [token, dao, reward, swapRouter] = await Promise.all([
      hre.artifacts.readArtifact("MarketplaceToken"),
      hre.artifacts.readArtifact("MarketplaceDAO"),
      hre.artifacts.readArtifact("MarketplaceLPToken"),
      hre.artifacts.readArtifact("MarketplaceV4SwapRouter"),
    ]);
    const PoolManager = await hre.ethers.getContractFactory(
      "MarketplacePoolManager",
    );
    const poolManagerDeployment = await PoolManager.getDeployTransaction(owner);
    if (!poolManagerDeployment.data) {
      throw new Error("The pool manager deployment has no bytecode.");
    }
    return {
      tokenImplementationCode: token.bytecode,
      daoImplementationCode: dao.bytecode,
      rewardImplementationCode: reward.bytecode,
      swapRouterImplementationCode: swapRouter.bytecode,
      poolManagerCode: poolManagerDeployment.data,
    };
  };

  it("deploys, wires, and reports the complete marketplace set", async () => {
    const [owner] = await hre.ethers.getSigners();
    const Coordinator = await hre.ethers.getContractFactory(
      "MarketplaceDeploymentCoordinator",
    );
    const coordinator = await Coordinator.deploy();
    await coordinator.waitForDeployment();
    const code = await implementationCode(owner.address);

    const parameters = {
      tokenName: "Marketplace Token",
      tokenSymbol: "MKT",
      initialSupply: hre.ethers.parseEther("21000000"),
      initialOwner: owner.address,
      poolManager: hre.ethers.ZeroAddress,
      ...code,
    };
    const transaction = await coordinator.deployMarketplace(parameters);
    const receipt = await transaction.wait();
    assert.ok(receipt);
    const deploymentEvent = receipt.logs
      .map((log: (typeof receipt.logs)[number]): LogDescription | null => {
        try {
          return coordinator.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find(
        (event: LogDescription | null): event is LogDescription =>
          event?.name === "MarketplaceDeployed",
      );
    assert.ok(deploymentEvent);

    const addresses = deploymentEvent.args.deployed;
    const tokenAddress = addresses.token as string;
    const daoAddress = addresses.dao as string;
    const rewardAddress = addresses.rewardToken as string;
    const routerAddress = addresses.swapRouter as string;
    const poolManagerAddress = addresses.poolManager as string;
    const token = await hre.ethers.getContractAt(
      "MarketplaceToken",
      tokenAddress,
    );
    const dao = await hre.ethers.getContractAt("MarketplaceDAO", daoAddress);
    const router = await hre.ethers.getContractAt(
      "MarketplaceV4SwapRouter",
      routerAddress,
    );

    assert.equal(await token.owner(), owner.address);
    assert.equal(await token.governance(), daoAddress);
    assert.equal(await token.totalSupply(), parameters.initialSupply);
    assert.equal(
      await token.balanceOf(owner.address),
      parameters.initialSupply,
    );
    assert.equal(await dao.owner(), owner.address);
    assert.equal(await dao.rewardToken(), rewardAddress);
    assert.equal(await router.owner(), owner.address);
    assert.equal(await router.governance(), daoAddress);
    assert.equal(await router.poolManager(), poolManagerAddress);
    assert.equal(deploymentEvent.args.tokenName, parameters.tokenName);
    assert.equal(deploymentEvent.args.tokenSymbol, parameters.tokenSymbol);
    assert.equal(deploymentEvent.args.initialSupply, parameters.initialSupply);
  });

  it("uses the caller and defaults the supply when omitted", async () => {
    const [owner] = await hre.ethers.getSigners();
    const Coordinator = await hre.ethers.getContractFactory(
      "MarketplaceDeploymentCoordinator",
    );
    const coordinator = await Coordinator.deploy();
    await coordinator.waitForDeployment();
    const code = await implementationCode(owner.address);

    const transaction = await coordinator.deployMarketplace({
      tokenName: "Default Token",
      tokenSymbol: "DFT",
      initialSupply: 0,
      initialOwner: hre.ethers.ZeroAddress,
      poolManager: hre.ethers.ZeroAddress,
      ...code,
    });
    const receipt = await transaction.wait();
    assert.ok(receipt);
    const deploymentEvent = receipt.logs
      .map((log: (typeof receipt.logs)[number]): LogDescription | null => {
        try {
          return coordinator.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find(
        (event: LogDescription | null): event is LogDescription =>
          event?.name === "MarketplaceDeployed",
      );
    assert.ok(deploymentEvent);
    assert.equal(deploymentEvent.args.owner, owner.address);
    assert.equal(
      deploymentEvent.args.initialSupply,
      hre.ethers.parseEther("21000000"),
    );
  });
});
