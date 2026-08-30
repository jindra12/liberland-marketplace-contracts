export type SupportedChain = "ethereum" | "tron" | "solana";

export interface PoolKeyInput {
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
}

export interface DeploymentManifest {
  chain: SupportedChain;
  network: string;
  chainId: string;
  deployedAt: string;
  deployer: string;
  token: {
    address: string;
    name: string;
    symbol: string;
    decimals: number;
    initialSupply: string;
  };
  swap: {
    address: string;
    poolManager: string;
  };
}

export interface TokenClient {
  readonly chain: SupportedChain;
  readonly address: string;
  balanceOf(owner: string): Promise<bigint>;
  transfer(recipient: string, amount: bigint): Promise<string>;
  approve(spender: string, amount: bigint): Promise<string>;
  permit?(
    owner: string,
    spender: string,
    amount: bigint,
    deadline: bigint,
  ): Promise<{ v: number; r: string; s: string }>;
}

export interface SwapClient {
  readonly chain: SupportedChain;
  readonly address: string;
  swapExactInputSingle(request: {
    poolKey: PoolKeyInput;
    zeroForOne: boolean;
    amountIn: bigint;
    amountOutMinimum: bigint;
    hookData?: string;
  }): Promise<{ transactionHash: string; amountOut: bigint }>;
}
