import { Interface, type InterfaceAbi } from "ethers";
import { TronWeb } from "tronweb";
import type { DeploymentManifest } from "../client/types";
import type { DeploymentArtifact } from "./browser";

export interface BrowserTronDeploymentOptions {
  tronWeb: TronWeb;
  network: string;
  chainId: string;
  poolManagerAddress: string;
  positionManagerAddress: string;
  permit2Address: string;
  tokenName: string;
  tokenSymbol: string;
  initialSupply: bigint;
  tokenArtifact: DeploymentArtifact;
  swapArtifact: DeploymentArtifact;
  daoArtifact: DeploymentArtifact;
  rewardArtifact: DeploymentArtifact;
  forwarderArtifact: DeploymentArtifact;
  timelockArtifact: DeploymentArtifact;
  proxyArtifact: DeploymentArtifact;
  onTransaction?: (
    label: string,
    transactionId: string,
  ) => Promise<void> | void;
}

const feeLimit = 1_000_000_000;
const zeroAddressHex = `0x${"0".repeat(40)}`;

const waitForConfirmation = async (
  tronWeb: TronWeb,
  transactionId: string,
  label: string,
): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const transactionInfo = await tronWeb.trx.getTransactionInfo(transactionId);
    if (transactionInfo.id) {
      if (transactionInfo.receipt.result !== "SUCCESS") {
        throw new Error(
          `TRON transaction failed (${label}): ${transactionInfo.resMessage}`,
        );
      }
      return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 3000));
  }
  throw new Error(
    `TRON transaction did not confirm within five minutes (${label}).`,
  );
};

const toEvmAddress = (tronWeb: TronWeb, address: string): string => {
  const hexAddress = tronWeb.address.toHex(address);
  return `0x${hexAddress.slice(2)}`;
};

const encodeDeploymentArguments = (
  abi: InterfaceAbi,
  args: readonly unknown[],
): string => new Interface(abi).encodeDeploy([...args]).slice(2);

const deployArtifact = async (
  options: BrowserTronDeploymentOptions,
  artifact: DeploymentArtifact,
  label: string,
  args: readonly unknown[] = [],
): Promise<string> => {
  const address = options.tronWeb.defaultAddress.base58;
  const issuerAddress = options.tronWeb.defaultAddress.hex;
  if (!address || !issuerAddress)
    throw new Error("Connect a TRON wallet before deploying.");
  const transaction =
    await options.tronWeb.transactionBuilder.createSmartContract(
      {
        abi: JSON.stringify(artifact.abi),
        bytecode: artifact.bytecode.replace(/^0x/, ""),
        rawParameter: encodeDeploymentArguments(
          artifact.abi,
          args.map((argument) =>
            typeof argument === "string" && argument.startsWith("T")
              ? toEvmAddress(options.tronWeb, argument)
              : argument,
          ),
        ),
        feeLimit,
        name: label,
      },
      issuerAddress,
    );
  const signed = await options.tronWeb.trx.sign(transaction);
  const result = await options.tronWeb.trx.sendRawTransaction(signed);
  if (!result.result)
    throw new Error(
      `TRON deployment failed (${label}): ${JSON.stringify(result)}`,
    );
  await waitForConfirmation(options.tronWeb, result.txid, label);
  await options.onTransaction?.(label, result.txid);
  const deployedAddress = signed.contract_address;
  if (!deployedAddress)
    throw new Error(`TRON did not return the deployed address for ${label}.`);
  return options.tronWeb.address.fromHex(deployedAddress);
};

const send = async (
  options: BrowserTronDeploymentOptions,
  artifact: DeploymentArtifact,
  address: string,
  method: string,
  args: readonly unknown[],
  label: string,
): Promise<void> => {
  const contract = options.tronWeb.contract(
    JSON.parse(JSON.stringify(artifact.abi)),
    address,
  );
  const transactionId = await contract.methods[method](...args).send({
    feeLimit,
  });
  await waitForConfirmation(options.tronWeb, String(transactionId), label);
  await options.onTransaction?.(label, String(transactionId));
};

const read = async (
  options: BrowserTronDeploymentOptions,
  artifact: DeploymentArtifact,
  address: string,
  method: string,
  args: readonly unknown[] = [],
): Promise<string> => {
  const contract = options.tronWeb.contract(
    JSON.parse(JSON.stringify(artifact.abi)),
    address,
  );
  return String(await contract.methods[method](...args).call());
};

export const deployMarketplaceOnTron = async (
  options: BrowserTronDeploymentOptions,
): Promise<DeploymentManifest> => {
  if (
    !options.poolManagerAddress ||
    !options.positionManagerAddress ||
    !options.permit2Address
  ) {
    throw new Error(
      "TRON V4 PoolManager, PositionManager, and Permit2 addresses are required.",
    );
  }
  const deployer = options.tronWeb.defaultAddress.base58;
  const deployerHex = options.tronWeb.defaultAddress.hex;
  if (!deployer || !deployerHex)
    throw new Error("Connect a TRON wallet before deploying.");

  const forwarder = await deployArtifact(
    options,
    options.forwarderArtifact,
    "ERC-2771 forwarder",
  );
  const tokenImplementation = await deployArtifact(
    options,
    options.tokenArtifact,
    "token implementation",
    [forwarder],
  );
  const tokenInitialization = new Interface(
    options.tokenArtifact.abi,
  ).encodeFunctionData("initialize", [
    options.tokenName,
    options.tokenSymbol,
    toEvmAddress(options.tronWeb, deployer),
    options.initialSupply,
  ]);
  const tokenProxy = await deployArtifact(
    options,
    options.proxyArtifact,
    "token proxy",
    [tokenImplementation, tokenInitialization],
  );

  const swapImplementation = await deployArtifact(
    options,
    options.swapArtifact,
    "swap implementation",
    [forwarder],
  );
  const swapProxy = await deployArtifact(
    options,
    options.proxyArtifact,
    "swap proxy",
    [
      swapImplementation,
      new Interface(options.swapArtifact.abi).encodeFunctionData("initialize", [
        toEvmAddress(options.tronWeb, options.poolManagerAddress),
        toEvmAddress(options.tronWeb, deployer),
      ]),
    ],
  );
  const rewardImplementation = await deployArtifact(
    options,
    options.rewardArtifact,
    "reward implementation",
    [forwarder],
  );
  const timelockImplementation = await deployArtifact(
    options,
    options.timelockArtifact,
    "timelock implementation",
  );
  const timelockProxy = await deployArtifact(
    options,
    options.proxyArtifact,
    "timelock proxy",
    [
      timelockImplementation,
      new Interface(options.timelockArtifact.abi).encodeFunctionData(
        "initialize",
        [172800, [], [zeroAddressHex], toEvmAddress(options.tronWeb, deployer)],
      ),
    ],
  );
  const daoImplementation = await deployArtifact(
    options,
    options.daoArtifact,
    "DAO implementation",
    [forwarder],
  );
  const daoProxy = await deployArtifact(
    options,
    options.proxyArtifact,
    "DAO proxy",
    [
      daoImplementation,
      new Interface(options.daoArtifact.abi).encodeFunctionData("initialize", [
        toEvmAddress(options.tronWeb, tokenProxy),
        toEvmAddress(options.tronWeb, timelockProxy),
        toEvmAddress(options.tronWeb, rewardImplementation),
      ]),
    ],
  );

  await send(
    options,
    options.tokenArtifact,
    tokenProxy,
    "setGovernance",
    [daoProxy],
    "token governance",
  );
  await send(
    options,
    options.swapArtifact,
    swapProxy,
    "setGovernance",
    [daoProxy],
    "swap governance",
  );
  const proposerRole = await read(
    options,
    options.timelockArtifact,
    timelockProxy,
    "PROPOSER_ROLE",
  );
  const cancellerRole = await read(
    options,
    options.timelockArtifact,
    timelockProxy,
    "CANCELLER_ROLE",
  );
  const adminRole = await read(
    options,
    options.timelockArtifact,
    timelockProxy,
    "DEFAULT_ADMIN_ROLE",
  );
  await send(
    options,
    options.timelockArtifact,
    timelockProxy,
    "grantRole",
    [proposerRole, daoProxy],
    "Governor proposer role",
  );
  await send(
    options,
    options.timelockArtifact,
    timelockProxy,
    "grantRole",
    [cancellerRole, daoProxy],
    "Governor canceller role",
  );
  await send(
    options,
    options.timelockArtifact,
    timelockProxy,
    "renounceRole",
    [adminRole, deployer],
    "renounce deployer timelock admin",
  );
  await send(
    options,
    options.tokenArtifact,
    tokenProxy,
    "transferOwnership",
    [daoProxy],
    "token ownership",
  );
  await send(
    options,
    options.swapArtifact,
    swapProxy,
    "transferOwnership",
    [daoProxy],
    "swap ownership",
  );
  const rewardToken = await read(
    options,
    options.daoArtifact,
    daoProxy,
    "rewardToken",
  );

  return {
    chain: "tron",
    network: options.network,
    chainId: options.chainId,
    deployedAt: new Date().toISOString(),
    deployer,
    implementations: {
      forwarder,
      token: tokenImplementation,
      dao: daoImplementation,
      rewardToken: rewardImplementation,
      swapRouter: swapImplementation,
      timelock: timelockImplementation,
    },
    token: {
      address: tokenProxy,
      name: options.tokenName,
      symbol: options.tokenSymbol,
      decimals: 18,
      initialSupply: options.initialSupply.toString(),
    },
    swap: {
      address: swapProxy,
      poolManager: options.poolManagerAddress,
      positionManager: options.positionManagerAddress,
      permit2: options.permit2Address,
    },
    dao: { address: daoProxy, timelock: timelockProxy, rewardToken },
  };
};
