import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { readFile } from "node:fs/promises";
import type { Artifact, BuildInfo } from "hardhat/types";

/** Export executable code and compiler offsets, without guessing constructor-dependent bytes. */
export const readRuntimeVerification = async (artifactPath: string) => {
  const artifact: Artifact = JSON.parse(await readFile(artifactPath, "utf8"));
  const debug: { buildInfo: string } = JSON.parse(
    await readFile(artifactPath.replace(/\.json$/, ".dbg.json"), "utf8"),
  );
  const buildInfo: BuildInfo = JSON.parse(
    await readFile(resolve(dirname(artifactPath), debug.buildInfo), "utf8"),
  );
  const runtime =
    buildInfo.output.contracts[artifact.sourceName][artifact.contractName].evm
      .deployedBytecode;
  return {
    runtime: `0x${runtime.object}`,
    immutableReferences: Object.values(
      runtime.immutableReferences ?? {},
    ).flat(),
  };
};

export const requiredEnvironment = (name: string): string => {
  const environmentFile = resolve(__dirname, "../../../../.env");
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
