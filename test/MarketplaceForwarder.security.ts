import assert from "node:assert/strict";
import hre from "hardhat";

const deployFixture = async () => {
  const [owner, alice, mallory, relayer] = await hre.ethers.getSigners();
  const Forwarder = await hre.ethers.getContractFactory("MarketplaceForwarder");
  const forwarder = await Forwarder.deploy();
  await forwarder.waitForDeployment();
  const Token = await hre.ethers.getContractFactory("MarketplaceToken");
  const token = await hre.upgrades.deployProxy(
    Token,
    ["Forwarded Token", "FWD", owner.address, hre.ethers.parseEther("100")],
    {
      kind: "uups",
      initializer: "initialize",
      constructorArgs: [await forwarder.getAddress()],
    },
  );
  const latestBlock = await hre.ethers.provider.getBlock("latest");
  assert.ok(latestBlock);
  const network = await hre.ethers.provider.getNetwork();
  const deadline = BigInt(latestBlock.timestamp + 3600);
  const request = {
    from: alice.address,
    to: await token.getAddress(),
    value: 0n,
    gas: 100_000n,
    deadline,
    data: token.interface.encodeFunctionData("transfer", [
      mallory.address,
      hre.ethers.parseEther("7"),
    ]),
  };
  const signature = await alice.signTypedData(
    {
      name: "Liberland Marketplace Forwarder",
      version: "1",
      chainId: network.chainId,
      verifyingContract: await forwarder.getAddress(),
    },
    {
      ForwardRequest: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "gas", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint48" },
        { name: "data", type: "bytes" },
      ],
    },
    { ...request, nonce: 0n },
  );
  const signedRequest = { ...request, signature };
  return { owner, alice, mallory, relayer, forwarder, token, signedRequest };
};

describe("MarketplaceForwarder adversarial API coverage", () => {
  it("verifies and executes the signer's ERC-2771 transfer exactly once", async () => {
    const { owner, alice, mallory, relayer, forwarder, token, signedRequest } =
      await deployFixture();
    const amount = hre.ethers.parseEther("7");
    await token.getFunction("transfer")(alice.address, amount);
    assert.equal(await forwarder.getFunction("verify")(signedRequest), true);
    await forwarder.connect(relayer).getFunction("execute")(signedRequest);
    assert.equal(await token.getFunction("balanceOf")(mallory.address), amount);
    assert.equal(await token.getFunction("balanceOf")(alice.address), 0n);
    assert.equal(await forwarder.getFunction("nonces")(alice.address), 1n);
    await assert.rejects(
      forwarder.connect(relayer).getFunction("execute")(signedRequest),
      /ERC2771ForwarderInvalidSigner/,
    );
    assert.equal(
      await token.getFunction("balanceOf")(owner.address),
      hre.ethers.parseEther("93"),
    );
  });

  it("rejects Mallory's signer substitution, payload tampering, expired request, and mismatched value", async () => {
    const { alice, mallory, forwarder, token, signedRequest } =
      await deployFixture();
    const alteredSigner = { ...signedRequest, from: mallory.address };
    assert.equal(await forwarder.getFunction("verify")(alteredSigner), false);
    await assert.rejects(
      forwarder.getFunction("execute")(alteredSigner),
      /ERC2771ForwarderInvalidSigner/,
    );
    const tamperedPayload = {
      ...signedRequest,
      data: token.interface.encodeFunctionData("transfer", [alice.address, 1n]),
    };
    assert.equal(await forwarder.getFunction("verify")(tamperedPayload), false);
    const expiredRequest = { ...signedRequest, deadline: 1n };
    assert.equal(await forwarder.getFunction("verify")(expiredRequest), false);
    await assert.rejects(
      forwarder.getFunction("execute")(signedRequest, { value: 1n }),
      /ERC2771ForwarderMismatchedValue/,
    );
    assert.equal(await forwarder.getFunction("nonces")(alice.address), 0n);
  });
});
