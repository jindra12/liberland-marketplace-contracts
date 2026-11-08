import { Contract, getAddress, type ContractRunner } from "ethers";
import verification from "../generated/routerVerification.json";
import { validateV4Infrastructure } from "./utils";

/** Compiler-reported immutable offsets are normalized; executable bytes must match the reviewed build. */
const normalizedCode = (
  code: string,
  references: { start: number; length: number }[],
) =>
  references.reduce(
    (result, reference) =>
      `${result.slice(0, 2 + reference.start * 2)}${"0".repeat(reference.length * 2)}${result.slice(2 + (reference.start + reference.length) * 2)}`,
    code.toLowerCase(),
  );

/** Saved issuer addresses are not trusted spending targets: verify proxy, implementation and canonical manager. */
export const verifySwapRouter = async (
  runner: ContractRunner,
  address: string,
  poolManagerAddress: string,
) => {
  await validateV4Infrastructure(runner, { poolManagerAddress });
  const provider = runner.provider!;
  const proxyCode = (await provider.getCode(address)).toLowerCase();
  if (
    !verification.proxyRuntimes.some((code) => code.toLowerCase() === proxyCode)
  ) {
    throw new Error(
      "Unverified swap router proxy. No token approval was requested.",
    );
  }
  const slot = await provider.getStorage(
    address,
    "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
  );
  const implementation = getAddress(`0x${slot.slice(-40)}`);
  const code = await provider.getCode(implementation);
  if (
    code.length !== verification.runtime.length ||
    normalizedCode(code, verification.immutableReferences) !==
      normalizedCode(verification.runtime, verification.immutableReferences)
  ) {
    throw new Error(
      "Unverified swap router implementation. Review this upgrade before approving tokens.",
    );
  }
  const router = new Contract(
    address,
    [
      "function poolManager() view returns (address)",
      "function trustedForwarder() view returns (address)",
    ],
    runner,
  );
  const forwarderCode = await provider.getCode(
    await router.getFunction("trustedForwarder")(),
  );
  if (
    forwarderCode.length !== verification.forwarder.runtime.length ||
    normalizedCode(
      forwarderCode,
      verification.forwarder.immutableReferences,
    ) !==
      normalizedCode(
        verification.forwarder.runtime,
        verification.forwarder.immutableReferences,
      )
  ) {
    throw new Error(
      "Unverified swap router trusted forwarder. No token approval was requested.",
    );
  }
  if (
    getAddress(await router.getFunction("poolManager")()) !==
    getAddress(poolManagerAddress)
  ) {
    throw new Error("The swap router uses a different PoolManager.");
  }
};
