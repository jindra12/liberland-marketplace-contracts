import hre from "hardhat";
import type { BrowserEvmDeploymentOptions } from "../src/deployment/browser";
import { deploymentNetworks } from "../src/deployment/networks";

const installInfrastructure = async () => {
  const network = deploymentNetworks.localhost;
  const fixtures = [
    {
      address: network.poolManagerAddress,
      name: "MarketplacePoolManager",
      args: [(await hre.ethers.getSigners())[0].address],
    },
    { address: network.permit2Address, name: "Permit2Fixture", args: [] },
    {
      address: network.positionManagerAddress,
      name: "PositionManagerFixture",
      args: [network.poolManagerAddress, network.permit2Address],
    },
    {
      address: network.stateViewAddress,
      name: "StateViewFixture",
      args: [network.poolManagerAddress],
    },
  ];
  await fixtures.reduce(async (previous, fixture) => {
    await previous;
    if ((await hre.ethers.provider.getCode(fixture.address)) !== "0x") {
      return;
    }
    const contract = await (
      await hre.ethers.getContractFactory(fixture.name)
    ).deploy(...fixture.args);
    await contract.waitForDeployment();
    const code = await hre.ethers.provider.getCode(await contract.getAddress());
    const installedCode = async () => {
      if (fixture.name !== "MarketplacePoolManager") {
        return code;
      }
      // NoDelegateCall embeds its own address. Rebase only those compiler-reported
      // immutable offsets when installing the real manager at the local canonical address.
      const artifact = await hre.artifacts.readArtifact(fixture.name);
      const info = await hre.artifacts.getBuildInfo(
        `${artifact.sourceName}:${artifact.contractName}`,
      );
      const references =
        info!.output.contracts[artifact.sourceName][artifact.contractName].evm
          .deployedBytecode.immutableReferences!;
      return Object.values(references)
        .flat()
        .reduce(
          (result, reference) =>
            `${result.slice(0, 2 + reference.start * 2)}${fixture.address
              .slice(2)
              .toLowerCase()
              .padStart(
                reference.length * 2,
                "0",
              )}${result.slice(2 + (reference.start + reference.length) * 2)}`,
          code,
        );
    };
    await hre.network.provider.send("hardhat_setCode", [
      fixture.address,
      await installedCode(),
    ]);
  }, Promise.resolve());
  return network;
};

export const deploymentOptions =
  async (): Promise<BrowserEvmDeploymentOptions> => {
    const signer = (await hre.ethers.getSigners())[0];
    const network = await installInfrastructure();
    return {
      chain: "ethereum",
      network: "hardhat",
      signer,
      tokenName: "Recovered Venture",
      tokenSymbol: "RCV",
      poolTokensPerEth: hre.ethers.parseEther("2000"),
      poolManagerAddress: network.poolManagerAddress,
      positionManagerAddress: network.positionManagerAddress,
      permit2Address: network.permit2Address,
      tokenArtifact: await hre.artifacts.readArtifact("MarketplaceToken"),
      swapArtifact: await hre.artifacts.readArtifact("MarketplaceV4SwapRouter"),
      daoArtifact: await hre.artifacts.readArtifact("MarketplaceDAO"),
      rewardArtifact: await hre.artifacts.readArtifact("MarketplaceLPToken"),
      timelockArtifact: await hre.artifacts.readArtifact("MarketplaceTimelock"),
      forwarderArtifact: await hre.artifacts.readArtifact(
        "MarketplaceForwarder",
      ),
      proxyArtifact: await hre.artifacts.readArtifact("ERC1967ProxyDeployment"),
    };
  };
