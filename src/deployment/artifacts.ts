import artifacts from "../generated/deploymentArtifacts.json";
import type { DeploymentArtifact } from "./browser";

/** Generated from the compiled contracts. No filesystem or Hardhat runtime in browsers. */
export const deploymentArtifacts: Record<
    keyof typeof artifacts,
    DeploymentArtifact
> = artifacts;
