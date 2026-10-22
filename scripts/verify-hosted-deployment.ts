import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Contract, parseEther } from "ethers";
import hre from "hardhat";
import type { DeploymentManifest } from "../src/client/types";
import { MarketplaceDaoClient } from "../src/client/governance";
import { deploymentArtifacts } from "../src/deployment/artifacts";

const verify = async () => {
    const signer = (await hre.ethers.getSigners())[0];
    assert.equal(
        (await signer.provider.getNetwork()).chainId,
        31337n,
        "Verification only runs on the disposable test fork.",
    );
    const manifest: DeploymentManifest = JSON.parse(
        await readFile("deployments/localhost.json", "utf8"),
    );
    assert.equal(manifest.chainId, "31337");
    const token = new Contract(
        manifest.token.address,
        deploymentArtifacts.tokenArtifact.abi,
        signer,
    );
    const bound = await token.getFunction("soulbound")(parseEther("100"));
    await bound.wait();
    await hre.network.provider.send("evm_mine");
    const client = new MarketplaceDaoClient(
        {
            token: manifest.token.address,
            dao: manifest.dao.address,
            router: manifest.swap.address,
        },
        signer,
    );
    await client.propose({
        kind: "reward",
        amount: parseEther("1"),
        description: "Hosted test: one monthly reward token",
    });
    const proposal = (await client.listProposals(signer.address)).items[0];
    assert.equal(proposal.proposer, signer.address);
    console.log(
        JSON.stringify({
            token: manifest.token.address,
            dao: manifest.dao.address,
            poolId: manifest.swap.poolId,
            proposalId: proposal.id,
            rootedVotes: proposal.votingPower.toString(),
        }),
    );
};

const run = async () => {
    try {
        await verify();
    } catch (error) {
        console.error(error);
        process.exitCode = 1;
    }
};

run();
