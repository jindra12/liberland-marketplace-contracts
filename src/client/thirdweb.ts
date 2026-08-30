import {
  getContract,
  prepareContractCall,
  readContract,
  sendTransaction,
  type ThirdwebClient,
  type ThirdwebContract,
} from "thirdweb";
import type { Chain } from "thirdweb/chains";
import type { Account } from "thirdweb/wallets";
import type { SupportedChain, TokenClient } from "./types";

const TOKEN_ABI = [
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
  { name: "transfer", type: "function", stateMutability: "nonpayable", inputs: [{ name: "recipient", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
] as const;

export class ThirdwebTokenClient implements TokenClient {
  readonly chain: SupportedChain = "ethereum";
  readonly address: string;
  private readonly contract: ThirdwebContract<typeof TOKEN_ABI>;
  private readonly account: Account;

  constructor(address: string, chain: Chain, client: ThirdwebClient, account: Account) {
    this.address = address;
    this.account = account;
    this.contract = getContract({ address, chain, client, abi: TOKEN_ABI });
  }

  async balanceOf(owner: string): Promise<bigint> {
    return readContract({ contract: this.contract, method: "balanceOf", params: [owner] });
  }

  async transfer(recipient: string, amount: bigint): Promise<string> {
    const transaction = prepareContractCall({ contract: this.contract, method: "transfer", params: [recipient, amount] });
    return (await sendTransaction({ account: this.account, transaction })).transactionHash;
  }

  async approve(spender: string, amount: bigint): Promise<string> {
    const transaction = prepareContractCall({ contract: this.contract, method: "approve", params: [spender, amount] });
    return (await sendTransaction({ account: this.account, transaction })).transactionHash;
  }
}
