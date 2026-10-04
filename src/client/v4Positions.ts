import {
  AbiCoder,
  Contract,
  Interface,
  getAddress,
  hexlify,
  type Signer,
  type TransactionReceipt,
} from "ethers";
import type { PoolKeyInput } from "./types";

const POSITION_MANAGER_ABI = [
  "function nextTokenId() view returns (uint256)",
  "function modifyLiquidities(bytes unlockData,uint256 deadline) payable",
  "function getPositionLiquidity(uint256 tokenId) view returns (uint128)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)",
] as const;

const ERC20_APPROVE_ABI = [
  "function approve(address spender,uint256 amount) returns (bool)",
] as const;
const PERMIT2_ABI = [
  "function approve(address token,address spender,uint160 amount,uint48 expiration)",
] as const;
const abiCoder = AbiCoder.defaultAbiCoder();
const transferEvent = new Interface(POSITION_MANAGER_ABI).getEvent("Transfer");

export type V4MintPosition = {
  poolKey: PoolKeyInput;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  amount0Maximum: bigint;
  amount1Maximum: bigint;
  recipient: string;
  hookData?: string;
  deadline: bigint;
};

export type V4LiquidityChange = {
  tokenId: bigint;
  liquidity: bigint;
  amount0Limit: bigint;
  amount1Limit: bigint;
  poolKey: PoolKeyInput;
  hookData?: string;
  deadline: bigint;
};

const encodeActions = (actions: number[], params: string[]): string =>
  abiCoder.encode(
    ["bytes", "bytes[]"],
    [hexlify(Uint8Array.from(actions)), params],
  );

const decodeMintedTokenId = (receipt: TransactionReceipt | null): bigint => {
  if (!receipt)
    throw new Error("Position mint transaction did not produce a receipt.");
  const log = receipt.logs.find(
    (entry) =>
      entry.topics[0] === transferEvent?.topicHash &&
      entry.topics[1] === `0x${"0".repeat(64)}`,
  );
  if (!log?.topics[3])
    throw new Error("PositionManager did not emit a position mint event.");
  return BigInt(log.topics[3]);
};

export class V4PositionClient {
  private readonly contract: Contract;
  private readonly signer: Signer;
  private readonly positionManagerAddress: string;
  private readonly permit2Address: string;

  constructor(
    positionManagerAddress: string,
    permit2Address: string,
    signer: Signer,
  ) {
    this.positionManagerAddress = getAddress(positionManagerAddress);
    this.permit2Address = getAddress(permit2Address);
    this.signer = signer;
    this.contract = new Contract(
      this.positionManagerAddress,
      POSITION_MANAGER_ABI,
      signer,
    );
  }

  async approveCurrency(
    tokenAddress: string,
    amount: bigint,
    expiration: number,
  ): Promise<void> {
    const token = new Contract(tokenAddress, ERC20_APPROVE_ABI, this.signer);
    const permit2 = new Contract(this.permit2Address, PERMIT2_ABI, this.signer);
    const [tokenApproval, permit2Approval] = await Promise.all([
      token.getFunction("approve")(this.permit2Address, amount),
      permit2.getFunction("approve")(
        tokenAddress,
        this.positionManagerAddress,
        amount,
        expiration,
      ),
    ]);
    await Promise.all([tokenApproval.wait(), permit2Approval.wait()]);
  }

  async mintPosition(
    request: V4MintPosition,
  ): Promise<{ tokenId: bigint; transactionHash: string }> {
    const params = abiCoder.encode(
      [
        "(address,address,uint24,int24,address)",
        "int24",
        "int24",
        "uint256",
        "uint128",
        "uint128",
        "address",
        "bytes",
      ],
      [
        [
          request.poolKey.currency0,
          request.poolKey.currency1,
          request.poolKey.fee,
          request.poolKey.tickSpacing,
          request.poolKey.hooks,
        ],
        request.tickLower,
        request.tickUpper,
        request.liquidity,
        request.amount0Maximum,
        request.amount1Maximum,
        request.recipient,
        request.hookData ?? "0x",
      ],
    );
    const settle = abiCoder.encode(
      ["address", "address"],
      [request.poolKey.currency0, request.poolKey.currency1],
    );
    const transaction = await this.contract.getFunction("modifyLiquidities")(
      encodeActions([0x02, 0x0d], [params, settle]),
      request.deadline,
    );
    const receipt = await transaction.wait();
    return {
      tokenId: decodeMintedTokenId(receipt),
      transactionHash: transaction.hash,
    };
  }

  async decreaseLiquidity(request: V4LiquidityChange): Promise<string> {
    const decrease = abiCoder.encode(
      ["uint256", "uint256", "uint128", "uint128", "bytes"],
      [
        request.tokenId,
        request.liquidity,
        request.amount0Limit,
        request.amount1Limit,
        request.hookData ?? "0x",
      ],
    );
    const take = abiCoder.encode(
      ["address", "address", "address"],
      [
        await this.signer.getAddress(),
        request.poolKey.currency0,
        request.poolKey.currency1,
      ],
    );
    const transaction = await this.contract.getFunction("modifyLiquidities")(
      encodeActions([0x01, 0x11], [decrease, take]),
      request.deadline,
    );
    await transaction.wait();
    return transaction.hash;
  }

  async collectFees(
    request: Omit<V4LiquidityChange, "liquidity">,
  ): Promise<string> {
    return this.decreaseLiquidity({ ...request, liquidity: 0n });
  }

  async burnEmptyPosition(
    tokenId: bigint,
    poolKey: PoolKeyInput,
    deadline: bigint,
    hookData = "0x",
  ): Promise<string> {
    const burn = abiCoder.encode(
      ["uint256", "uint128", "uint128", "bytes"],
      [tokenId, 0, 0, hookData],
    );
    const take = abiCoder.encode(
      ["address", "address", "address"],
      [await this.signer.getAddress(), poolKey.currency0, poolKey.currency1],
    );
    const transaction = await this.contract.getFunction("modifyLiquidities")(
      encodeActions([0x03, 0x11], [burn, take]),
      deadline,
    );
    await transaction.wait();
    return transaction.hash;
  }

  async getPositionLiquidity(tokenId: bigint): Promise<bigint> {
    return BigInt(
      await this.contract.getFunction("getPositionLiquidity")(tokenId),
    );
  }
}
