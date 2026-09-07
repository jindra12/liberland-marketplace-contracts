import { Contract, JsonRpcProvider, parseUnits } from "ethers";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import hre from "hardhat";
import { deployMarketplaceFromBrowser } from "../src/deployment/browser";

const ETHEREUM_CHAIN_ID = 1;
const THIRDWEB_ENVIRONMENT_KEY = "REACT_APP_THIRDWEB";
const UNISWAP_V3_ETH_USDC_POOL = "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640";
const USDC_MAINNET_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const WETH_MAINNET_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

const requiredEnvironment = (name: string): string => {
  const environmentFile = resolve(process.cwd(), "../../../.env");
  const environmentFileValue = readFileSync(environmentFile, "utf8")
    .split(/\r?\n/)
    .find((line) => line.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  const value = process.env[name] ?? environmentFileValue;
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
};

const uniswapV3PoolAbi = [
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
];

const erc20Abi = ["function decimals() view returns (uint8)"];

type MainnetMarketData = {
  blockNumber: number;
  gasPriceWei: bigint;
  maxFeePerGasWei: bigint;
  ethUsd: number;
};

const readMainnetMarketData = async (
  thirdwebClientId: string,
): Promise<MainnetMarketData> => {
  const provider = new JsonRpcProvider(
    `https://${ETHEREUM_CHAIN_ID}.rpc.thirdweb.com/${thirdwebClientId}`,
  );
  const [network, blockNumber, feeData] = await Promise.all([
    provider.getNetwork(),
    provider.getBlockNumber(),
    provider.getFeeData(),
  ]);
  if (network.chainId !== BigInt(ETHEREUM_CHAIN_ID)) {
    throw new Error(
      `Thirdweb RPC returned chain ${network.chainId}, not Ethereum mainnet.`,
    );
  }
  const gasPriceWei = feeData.gasPrice ?? feeData.maxFeePerGas;
  const maxFeePerGasWei = feeData.maxFeePerGas ?? gasPriceWei;
  if (!gasPriceWei || !maxFeePerGasWei) {
    throw new Error("Ethereum fee data did not include a usable gas price.");
  }

  const pool = new Contract(
    UNISWAP_V3_ETH_USDC_POOL,
    uniswapV3PoolAbi,
    provider,
  );
  const [slot0, token0, token1] = await Promise.all([
    pool.slot0(),
    pool.token0(),
    pool.token1(),
  ]);
  const normalizedToken0 = String(token0).toLowerCase();
  const normalizedToken1 = String(token1).toLowerCase();
  if (
    normalizedToken0 !== USDC_MAINNET_ADDRESS.toLowerCase() ||
    normalizedToken1 !== WETH_MAINNET_ADDRESS.toLowerCase()
  ) {
    throw new Error(
      "The configured Uniswap pool does not contain USDC/WETH in the expected order.",
    );
  }
  const [token0Decimals, token1Decimals] = await Promise.all([
    new Contract(token0, erc20Abi, provider).decimals(),
    new Contract(token1, erc20Abi, provider).decimals(),
  ]);
  const sqrtPrice = Number(slot0.sqrtPriceX96) / 2 ** 96;
  const rawToken1PerToken0 = sqrtPrice ** 2;
  const token1PerToken0 =
    (rawToken1PerToken0 * 10 ** Number(token0Decimals)) /
    10 ** Number(token1Decimals);
  const ethUsd = 1 / token1PerToken0;
  if (!Number.isFinite(ethUsd) || ethUsd <= 0) {
    throw new Error("Uniswap returned an invalid ETH/USD spot price.");
  }

  return { blockNumber, gasPriceWei, maxFeePerGasWei, ethUsd };
};

const main = async (): Promise<void> => {
  if (hre.network.name !== "hardhat") {
    throw new Error(
      "The deployment estimator only runs on Hardhat's in-memory network.",
    );
  }

  const [deployer] = await hre.ethers.getSigners();
  const artifacts = await Promise.all([
    hre.artifacts.readArtifact("MarketplaceToken"),
    hre.artifacts.readArtifact("MarketplaceV4SwapRouter"),
    hre.artifacts.readArtifact("MarketplaceDAO"),
    hre.artifacts.readArtifact("MarketplaceLPToken"),
    hre.artifacts.readArtifact("ERC1967ProxyDeployment"),
  ]);
  const [
    tokenArtifact,
    swapArtifact,
    daoArtifact,
    rewardArtifact,
    proxyArtifact,
  ] = artifacts;
  const PoolManager = await hre.ethers.getContractFactory("MockPoolManager");
  const poolManager = await PoolManager.deploy(0);
  await poolManager.waitForDeployment();
  const gasByStep = new Map<string, bigint>();

  await deployMarketplaceFromBrowser({
    chain: "ethereum",
    network: hre.network.name,
    poolManagerAddress: await poolManager.getAddress(),
    tokenName: requiredEnvironment("TOKEN_NAME"),
    tokenSymbol: requiredEnvironment("TOKEN_SYMBOL"),
    initialSupply: parseUnits(
      process.env.TOKEN_INITIAL_SUPPLY ?? "21000000",
      18,
    ),
    signer: deployer,
    tokenArtifact,
    swapArtifact,
    daoArtifact,
    rewardArtifact,
    proxyArtifact,
    onTransaction: (label, receipt) => {
      gasByStep.set(label, receipt.gasUsed);
    },
  });

  const totalGas = [...gasByStep.values()].reduce(
    (total, gasUsed) => total + gasUsed,
    0n,
  );
  const mainnetMarketData = await readMainnetMarketData(
    requiredEnvironment(THIRDWEB_ENVIRONMENT_KEY),
  );
  const estimatedCostAtGasPrice = totalGas * mainnetMarketData.gasPriceWei;
  const estimatedCostAtMaxFee = totalGas * mainnetMarketData.maxFeePerGasWei;
  const estimatedCostEth = Number(estimatedCostAtMaxFee) / 1e18;
  console.log(
    JSON.stringify(
      {
        network: hre.network.name,
        mainnet: {
          chainId: ETHEREUM_CHAIN_ID,
          blockNumber: mainnetMarketData.blockNumber,
          gasPriceWei: mainnetMarketData.gasPriceWei.toString(),
          gasPriceGwei: Number(mainnetMarketData.gasPriceWei) / 1e9,
          maxFeePerGasWei: mainnetMarketData.maxFeePerGasWei.toString(),
          maxFeePerGasGwei: Number(mainnetMarketData.maxFeePerGasWei) / 1e9,
          ethUsd: mainnetMarketData.ethUsd,
          priceSource: {
            dex: "Uniswap V3",
            pool: UNISWAP_V3_ETH_USDC_POOL,
            pair: "USDC/WETH 0.05%",
          },
        },
        poolManager: "MockPoolManager used only for local estimation",
        gasByStep: Object.fromEntries(
          [...gasByStep.entries()].map(([label, gasUsed]) => [
            label,
            gasUsed.toString(),
          ]),
        ),
        totalGas: totalGas.toString(),
        estimatedCostAtGasPrice: {
          wei: estimatedCostAtGasPrice.toString(),
          eth: hre.ethers.formatEther(estimatedCostAtGasPrice),
          usd:
            (Number(estimatedCostAtGasPrice) / 1e18) * mainnetMarketData.ethUsd,
        },
        estimatedCostAtMaxFee: {
          wei: estimatedCostAtMaxFee.toString(),
          eth: estimatedCostEth,
          usd: estimatedCostEth * mainnetMarketData.ethUsd,
        },
        note: "Gas units are measured locally; fee data and ETH/USD are read from Ethereum mainnet at runtime.",
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
