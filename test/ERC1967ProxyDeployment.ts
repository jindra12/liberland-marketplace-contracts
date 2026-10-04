import assert from "node:assert/strict";
import hre from "hardhat";

const deployFixture = async () => {
  const [owner, mallory] = await hre.ethers.getSigners();
  const forwarder = await (
    await hre.ethers.getContractFactory("MarketplaceForwarder")
  ).deploy();
  await forwarder.waitForDeployment();
  const Token = await hre.ethers.getContractFactory("MarketplaceToken");
  const implementation = await Token.deploy(await forwarder.getAddress());
  await implementation.waitForDeployment();
  const Proxy = await hre.ethers.getContractFactory("ERC1967ProxyDeployment");
  const proxy = await Proxy.deploy(
    await implementation.getAddress(),
    Token.interface.encodeFunctionData("initialize", [
      "Atomically Initialized",
      "ATOM",
      owner.address,
      hre.ethers.parseEther("100"),
    ]),
  );
  await proxy.waitForDeployment();
  return { owner, mallory, proxy, Token };
};

describe("ERC1967ProxyDeployment", () => {
  it("deploys the implementation proxy and atomically initializes the token", async () => {
    const { owner, proxy, Token } = await deployFixture();
    const token = Token.attach(await proxy.getAddress());
    assert.equal(await token.getFunction("name")(), "Atomically Initialized");
    assert.equal(await token.getFunction("owner")(), owner.address);
    assert.equal(
      await token.getFunction("totalSupply")(),
      hre.ethers.parseEther("100"),
    );
  });

  it("prevents Mallory from claiming an already-initialized proxy", async () => {
    const { owner, mallory, proxy, Token } = await deployFixture();
    const token = Token.attach(await proxy.getAddress());
    await assert.rejects(
      token.connect(mallory).getFunction("initialize")(
        "Hijacked",
        "BAD",
        mallory.address,
        hre.ethers.parseEther("1000000"),
      ),
      /InvalidInitialization/,
    );
    assert.equal(await token.getFunction("owner")(), owner.address);
    assert.equal(await token.getFunction("balanceOf")(mallory.address), 0n);
  });
});
