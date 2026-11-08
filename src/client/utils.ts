import {
  Contract,
  getAddress,
  type ContractRunner,
  type ContractTransactionResponse,
} from "ethers";
import { deploymentNetworks } from "../deployment/networks";
import type { V4Infrastructure } from "./types";

/** Pins spenders to the configured chain's canonical infrastructure before any approval or value transfer. */
export const validateV4Infrastructure = async (
  runner: ContractRunner,
  addresses: V4Infrastructure,
) => {
  if (!runner.provider) {
    throw new Error(
      "A connected provider is required to verify V4 infrastructure.",
    );
  }
  const chain = await runner.provider.getNetwork();
  const network = Object.values(deploymentNetworks).find(
    (entry) => BigInt(entry.chainId) === chain.chainId,
  );
  if (!network) {
    throw new Error(
      "This chain has no configured canonical V4 infrastructure.",
    );
  }
  await Promise.all(
    (Object.keys(addresses) as (keyof V4Infrastructure)[]).map(async (key) => {
      const address = addresses[key];
      if (!address || getAddress(address) !== getAddress(network[key])) {
        throw new Error(
          `Unverified ${key}: use the configured canonical address for this chain.`,
        );
      }
      if ((await runner.provider!.getCode(address)) === "0x") {
        throw new Error(
          `The configured ${key} has no deployed code on this chain.`,
        );
      }
    }),
  );
  if (addresses.positionManagerAddress) {
    const manager = new Contract(
      addresses.positionManagerAddress,
      [
        "function poolManager() view returns (address)",
        "function permit2() view returns (address)",
      ],
      runner,
    );
    const [poolManager, permit2] = await Promise.all([
      manager.getFunction("poolManager")(),
      manager.getFunction("permit2")(),
    ]);
    if (
      getAddress(poolManager) !== getAddress(network.poolManagerAddress) ||
      getAddress(permit2) !== getAddress(network.permit2Address)
    ) {
      throw new Error(
        "The PositionManager does not match its configured PoolManager and Permit2.",
      );
    }
  }
  return network;
};

export const confirmTransaction = async (
  transaction: ContractTransactionResponse,
): Promise<string> => {
  const receipt = await transaction.wait();
  if (!receipt || receipt.status !== 1) {
    throw new Error("Transaction did not confirm successfully.");
  }
  return receipt.hash;
};

// Bounded log pages avoid unbounded RPC requests; callers can load older history.
export const eventBlockWindow = (latest: number, beforeBlock?: number) => {
  const toBlock = beforeBlock ?? latest;
  const fromBlock = Math.max(0, toBlock - 999);
  return {
    fromBlock,
    toBlock,
    nextBlock: fromBlock > 0 ? fromBlock - 1 : null,
  };
};
