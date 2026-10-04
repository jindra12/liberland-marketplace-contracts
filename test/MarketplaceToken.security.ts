import assert from "node:assert/strict";
import hre from "hardhat";

const deployToken = async () => {
  const [owner, alice, mallory, spender] = await hre.ethers.getSigners();
  const forwarder = await (
    await hre.ethers.getContractFactory("MarketplaceForwarder")
  ).deploy();
  await forwarder.waitForDeployment();
  const Token = await hre.ethers.getContractFactory("MarketplaceToken");
  const token = await hre.upgrades.deployProxy(
    Token,
    ["Security Token", "SEC", owner.address, hre.ethers.parseEther("1000")],
    {
      kind: "uups",
      initializer: "initialize",
      constructorArgs: [await forwarder.getAddress()],
    },
  );
  return { owner, alice, mallory, spender, token, forwarder };
};

describe("MarketplaceToken adversarial API coverage", () => {
  it("supports ERC-20 transfers and allowances without allowing Mallory to spend unapproved tokens", async () => {
    const { owner, alice, mallory, token } = await deployToken();
    const amount = hre.ethers.parseEther("20");
    await token.getFunction("transfer")(alice.address, amount);
    await token.connect(alice).getFunction("approve")(
      mallory.address,
      amount / 2n,
    );
    await token.connect(mallory).getFunction("transferFrom")(
      alice.address,
      mallory.address,
      amount / 2n,
    );
    assert.equal(
      await token.getFunction("balanceOf")(mallory.address),
      amount / 2n,
    );
    assert.equal(
      await token.getFunction("allowance")(alice.address, mallory.address),
      0n,
    );
    await assert.rejects(
      token.connect(mallory).getFunction("transferFrom")(
        owner.address,
        mallory.address,
        1n,
      ),
      /ERC20InsufficientAllowance/,
    );
    await assert.rejects(
      token.connect(mallory).getFunction("transfer")(owner.address, amount),
      /InsufficientLiquidBalance/,
    );
  });

  it("accepts a valid EIP-2612 permit once and rejects Mallory's forged, replayed, and expired signatures", async () => {
    const { owner, alice, mallory, spender, token } = await deployToken();
    const network = await hre.ethers.provider.getNetwork();
    const currentBlock = await hre.ethers.provider.getBlock("latest");
    assert.ok(currentBlock);
    const deadline = BigInt(currentBlock.timestamp + 3600);
    const amount = hre.ethers.parseEther("12");
    const domain = {
      name: "Security Token",
      version: "1",
      chainId: network.chainId,
      verifyingContract: await token.getAddress(),
    };
    const types = {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    };
    const permit = {
      owner: owner.address,
      spender: spender.address,
      value: amount,
      nonce: 0n,
      deadline,
    };
    const signature = await owner.signTypedData(domain, types, permit);
    const split = hre.ethers.Signature.from(signature);
    await token.getFunction("permit")(
      owner.address,
      spender.address,
      amount,
      deadline,
      split.v,
      split.r,
      split.s,
    );
    assert.equal(
      await token.getFunction("allowance")(owner.address, spender.address),
      amount,
    );
    await assert.rejects(
      token.getFunction("permit")(
        owner.address,
        spender.address,
        amount,
        deadline,
        split.v,
        split.r,
        split.s,
      ),
      /ERC2612InvalidSigner/,
    );

    const forged = { ...permit, nonce: 1n };
    const forgedSignature = await mallory.signTypedData(domain, types, forged);
    const forgedSplit = hre.ethers.Signature.from(forgedSignature);
    await assert.rejects(
      token.connect(alice).getFunction("permit")(
        owner.address,
        spender.address,
        amount,
        deadline,
        forgedSplit.v,
        forgedSplit.r,
        forgedSplit.s,
      ),
      /ERC2612InvalidSigner/,
    );

    const expired = await owner.signTypedData(domain, types, {
      ...permit,
      nonce: 1n,
      deadline: BigInt(currentBlock.timestamp - 1),
    });
    const expiredSplit = hre.ethers.Signature.from(expired);
    await assert.rejects(
      token.getFunction("permit")(
        owner.address,
        spender.address,
        amount,
        BigInt(currentBlock.timestamp - 1),
        expiredSplit.v,
        expiredSplit.r,
        expiredSplit.s,
      ),
      /ERC2612ExpiredSignature/,
    );
  });

  it("roots liquid tokens, checkpoints only rooted votes, and only governance may unroot or prebind", async () => {
    const { owner, alice, mallory, token } = await deployToken();
    const amount = hre.ethers.parseEther("100");
    await token.getFunction("transfer")(alice.address, amount);
    await token.connect(alice).getFunction("soulbound")(
      hre.ethers.parseEther("70"),
    );
    assert.equal(
      await token.getFunction("soulboundBalanceOf")(alice.address),
      hre.ethers.parseEther("70"),
    );
    assert.equal(
      await token.getFunction("liquidBalanceOf")(alice.address),
      hre.ethers.parseEther("30"),
    );
    assert.equal(
      await token.getFunction("getVotes")(alice.address),
      hre.ethers.parseEther("70"),
    );
    assert.ok((await token.getFunction("soulboundSince")(alice.address)) > 0n);
    await assert.rejects(
      token.connect(alice).getFunction("transfer")(
        mallory.address,
        hre.ethers.parseEther("31"),
      ),
      /InsufficientLiquidBalance/,
    );
    await assert.rejects(
      token.connect(alice).getFunction("soulbound")(0n),
      /InvalidAmount/,
    );
    await assert.rejects(
      token.connect(alice).getFunction("soulbound")(
        hre.ethers.parseEther("31"),
      ),
      /InsufficientLiquidBalance/,
    );
    await assert.rejects(
      token.connect(mallory).getFunction("soulboundFor")(alice.address, 1n),
      /GovernanceOnly/,
    );
    await assert.rejects(
      token.connect(mallory).getFunction("unsoulbound")(alice.address, 1n),
      /GovernanceOnly/,
    );

    await token.getFunction("setGovernance")(owner.address);
    await assert.rejects(
      token.connect(owner).getFunction("setGovernance")(mallory.address),
      /GovernanceAlreadySet/,
    );
    await assert.rejects(
      token.connect(owner).getFunction("unsoulbound")(
        alice.address,
        hre.ethers.parseEther("71"),
      ),
      /InsufficientSoulboundBalance/,
    );
    await token.getFunction("unsoulbound")(
      alice.address,
      hre.ethers.parseEther("20"),
    );
    assert.equal(
      await token.getFunction("getVotes")(alice.address),
      hre.ethers.parseEther("50"),
    );
    await assert.rejects(
      token.connect(mallory).getFunction("unsoulbound")(alice.address, 1n),
      /GovernanceOnly/,
    );
  });

  it("keeps initialization, ownership, vote delegation, and timestamp checkpoints protected", async () => {
    const { owner, alice, mallory, token } = await deployToken();
    await assert.rejects(
      token.getFunction("initialize")("Again", "BAD", owner.address, 1n),
      /InvalidInitialization/,
    );
    await assert.rejects(
      token.connect(mallory).getFunction("setGovernance")(mallory.address),
      /OwnableUnauthorizedAccount/,
    );
    await assert.rejects(
      token.connect(owner).getFunction("setGovernance")(hre.ethers.ZeroAddress),
      /InvalidGovernance/,
    );
    assert.equal(
      await token.getFunction("clock")(),
      BigInt((await hre.ethers.provider.getBlock("latest"))!.timestamp),
    );
    assert.equal(await token.getFunction("CLOCK_MODE")(), "mode=timestamp");
    assert.equal(await token.getFunction("decimals")(), 18n);
    const beforeAliceRoots = await token.getFunction("clock")();
    await hre.network.provider.send("evm_increaseTime", [1]);
    await hre.network.provider.send("evm_mine");
    const liquidForAlice = hre.ethers.parseEther("40");
    await token.getFunction("transfer")(alice.address, liquidForAlice);
    await token.connect(alice).getFunction("soulbound")(
      hre.ethers.parseEther("25"),
    );
    await token.getFunction("transferOwnership")(alice.address);
    await assert.rejects(
      token.connect(owner).getFunction("transferOwnership")(mallory.address),
      /OwnableUnauthorizedAccount/,
    );
    await token.connect(alice).getFunction("delegate")(mallory.address);
    await assert.rejects(
      token.connect(owner).getFunction("renounceOwnership")(),
      /OwnableUnauthorizedAccount/,
    );
    assert.equal(
      await token.getFunction("delegates")(alice.address),
      mallory.address,
    );
    assert.equal(
      await token.getFunction("getVotes")(mallory.address),
      hre.ethers.parseEther("25"),
    );
    await hre.network.provider.send("evm_increaseTime", [1]);
    await hre.network.provider.send("evm_mine");
    assert.equal(
      await token.getFunction("getPastVotes")(
        mallory.address,
        beforeAliceRoots,
      ),
      0n,
    );
    assert.equal(
      await token.getFunction("getPastTotalSupply")(beforeAliceRoots),
      0n,
    );
  });
});
