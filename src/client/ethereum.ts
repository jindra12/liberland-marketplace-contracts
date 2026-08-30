import { Contract, Signature, type Signer } from "ethers";
import type { SupportedChain, TokenClient } from "./types";

const TOKEN_ABI = [
  "function name() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
  "function nonces(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function transfer(address,uint256) returns (bool)",
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
] as const;

export class EvmTokenClient implements TokenClient {
  readonly chain: SupportedChain;
  readonly address: string;
  private readonly contract: Contract;
  private readonly signer: Signer;

  constructor(address: string, signer: Signer, chain: "ethereum" | "tron" = "ethereum") {
    this.address = address;
    this.signer = signer;
    this.chain = chain;
    this.contract = new Contract(address, TOKEN_ABI, signer);
  }

  async balanceOf(owner: string): Promise<bigint> {
    return BigInt(await this.contract.getFunction("balanceOf")(owner));
  }

  async transfer(recipient: string, amount: bigint): Promise<string> {
    const transaction = await this.contract.getFunction("transfer")(recipient, amount);
    return transaction.hash;
  }

  async approve(spender: string, amount: bigint): Promise<string> {
    const transaction = await this.contract.getFunction("approve")(spender, amount);
    return transaction.hash;
  }

  async permit(owner: string, spender: string, amount: bigint, deadline: bigint) {
    const provider = this.signer.provider;
    if (!provider || !this.signer.signTypedData) {
      throw new Error("The signer must support EIP-712 typed-data signing.");
    }

    const [name, nonce, network] = await Promise.all([
      this.contract.getFunction("name")(),
      this.contract.getFunction("nonces")(owner),
      provider.getNetwork(),
    ]);
    const signature = await this.signer.signTypedData(
      {
        name: String(name),
        version: "1",
        chainId: network.chainId,
        verifyingContract: this.address,
      },
      {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      { owner, spender, value: amount, nonce, deadline },
    );
    const split = Signature.from(signature);
    return { v: split.v, r: split.r, s: split.s };
  }
}
