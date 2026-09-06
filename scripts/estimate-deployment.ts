import hre from "hardhat";

const requiredEnvironment = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
};

const main = async (): Promise<void> => {
  const [deployer] = await hre.ethers.getSigners();
  const coordinatorFactory = await hre.ethers.getContractFactory(
    "MarketplaceDeploymentCoordinator",
  );
  const coordinatorDeployment = await coordinatorFactory.getDeployTransaction();
  if (!coordinatorDeployment.data) {
    throw new Error("The coordinator deployment transaction has no bytecode.");
  }

  const deploymentGas = await hre.ethers.provider.estimateGas({
    from: deployer.address,
    data: coordinatorDeployment.data,
  });
  const coordinator = await coordinatorFactory.deploy();
  await coordinator.waitForDeployment();
  const poolManagerFactory = await hre.ethers.getContractFactory(
    "MarketplacePoolManager",
  );
  const poolManagerDeployment = await poolManagerFactory.getDeployTransaction(
    deployer.address,
  );
  if (!poolManagerDeployment.data) {
    throw new Error("The pool manager deployment transaction has no bytecode.");
  }

  const initialSupply = hre.ethers.parseUnits(
    process.env.TOKEN_INITIAL_SUPPLY ?? "21000000",
    18,
  );
  const parameters = {
    tokenName: requiredEnvironment("TOKEN_NAME"),
    tokenSymbol: requiredEnvironment("TOKEN_SYMBOL"),
    initialSupply,
    initialOwner: deployer.address,
    poolManager: process.env.POOL_MANAGER_ADDRESS ?? hre.ethers.ZeroAddress,
    tokenImplementationCode: (
      await hre.artifacts.readArtifact("MarketplaceToken")
    ).bytecode,
    daoImplementationCode: (await hre.artifacts.readArtifact("MarketplaceDAO"))
      .bytecode,
    rewardImplementationCode: (
      await hre.artifacts.readArtifact("MarketplaceLPToken")
    ).bytecode,
    swapRouterImplementationCode: (
      await hre.artifacts.readArtifact("MarketplaceV4SwapRouter")
    ).bytecode,
    poolManagerCode: process.env.POOL_MANAGER_ADDRESS
      ? "0x"
      : poolManagerDeployment.data,
  };
  const coordinatorContract = coordinator.getFunction("deployMarketplace");
  const marketplaceGas = await coordinatorContract.estimateGas(parameters);
  const feeData = await hre.ethers.provider.getFeeData();
  const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas;
  const totalGas = deploymentGas + marketplaceGas;

  console.log(
    JSON.stringify(
      {
        network: hre.network.name,
        deployer: deployer.address,
        coordinatorDeploymentGas: deploymentGas.toString(),
        marketplaceDeploymentGas: marketplaceGas.toString(),
        totalGas: totalGas.toString(),
        gasPriceWei: gasPrice?.toString() ?? null,
        estimatedNativeCostWei: gasPrice
          ? (totalGas * gasPrice).toString()
          : null,
        note: "Uses POOL_MANAGER_ADDRESS when supplied; otherwise deploys a local V4 PoolManager from its creation bytecode.",
      },
      null,
      2,
    ),
  );
};

const run = async (): Promise<void> => {
  try {
    await main();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
};

run();
