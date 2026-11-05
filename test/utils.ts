import hre from "hardhat";
import type { BrowserEvmDeploymentOptions } from "../src/deployment/browser";

export const deploymentOptions =
    async (): Promise<BrowserEvmDeploymentOptions> => {
        const signer = (await hre.ethers.getSigners())[0];
        const manager = await (
            await hre.ethers.getContractFactory("MarketplacePoolManager")
        ).deploy(signer.address);
        await manager.waitForDeployment();
        return {
            chain: "ethereum",
            network: "hardhat",
            signer,
            tokenName: "Recovered Venture",
            tokenSymbol: "RCV",
            poolTokensPerEth: hre.ethers.parseEther("2000"),
            poolManagerAddress: await manager.getAddress(),
            positionManagerAddress: signer.address,
            permit2Address: signer.address,
            tokenArtifact: await hre.artifacts.readArtifact("MarketplaceToken"),
            swapArtifact: await hre.artifacts.readArtifact(
                "MarketplaceV4SwapRouter",
            ),
            daoArtifact: await hre.artifacts.readArtifact("MarketplaceDAO"),
            rewardArtifact:
                await hre.artifacts.readArtifact("MarketplaceLPToken"),
            timelockArtifact: await hre.artifacts.readArtifact(
                "MarketplaceTimelock",
            ),
            forwarderArtifact: await hre.artifacts.readArtifact(
                "MarketplaceForwarder",
            ),
            proxyArtifact: await hre.artifacts.readArtifact(
                "ERC1967ProxyDeployment",
            ),
        };
    };
