import { TronWeb } from "tronweb";
import type { SupportedChain, TokenClient } from "./types";

export class TronTokenClient implements TokenClient {
  readonly chain: SupportedChain = "tron";
  readonly address: string;
  private readonly tronWeb: TronWeb;

  constructor(address: string, tronWeb: TronWeb) {
    this.address = address;
    this.tronWeb = tronWeb;
  }

  async balanceOf(owner: string): Promise<bigint> {
    const contract = await this.tronWeb.contract().at(this.address);
    const balance = await contract.methods.balanceOf(owner).call();
    return BigInt(balance.toString());
  }

  async transfer(recipient: string, amount: bigint): Promise<string> {
    const contract = await this.tronWeb.contract().at(this.address);
    return contract.methods.transfer(recipient, amount.toString()).send({
      from: this.tronWeb.defaultAddress.base58,
    });
  }

  async approve(spender: string, amount: bigint): Promise<string> {
    const contract = await this.tronWeb.contract().at(this.address);
    return contract.methods.approve(spender, amount.toString()).send({
      from: this.tronWeb.defaultAddress.base58,
    });
  }
}
