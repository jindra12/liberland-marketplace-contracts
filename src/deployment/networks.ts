import type { DeploymentNetworkConfiguration } from "../client/types";

export type DeploymentNetwork = "ethereum" | "sepolia" | "localhost";

// Canonical V4 deployments: https://developers.uniswap.org/docs/protocols/v4/deployments
const ethereumMainnet: DeploymentNetworkConfiguration = {
    label: "Ethereum mainnet",
    chain: "ethereum",
    chainId: 1,
    network: "mainnet",
    poolManagerAddress: "0x000000000004444c5dc75cB358380D2e3dE08A90",
    positionManagerAddress: "0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e",
    permit2Address: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    quoterAddress: "0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203",
};

export const deploymentNetworks: Record<
    DeploymentNetwork,
    DeploymentNetworkConfiguration
> = {
    ethereum: ethereumMainnet,
    sepolia: {
        label: "Ethereum Sepolia (testnet)",
        chain: "ethereum",
        chainId: 11155111,
        network: "sepolia",
        poolManagerAddress: "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543",
        positionManagerAddress: "0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4",
        permit2Address: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
        quoterAddress: "0x61b3f2011a92d183c7dbadbda940a7555ccf9227",
    },
    localhost: {
        ...ethereumMainnet,
        label: "Local Ethereum mainnet fork",
        chainId: 31337,
        network: "localhost",
        rpcUrl: "http://127.0.0.1:8545",
    },
};
