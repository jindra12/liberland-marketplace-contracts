import {
  Contract,
  type Signer,
  type TransactionResponse,
  type TypedDataField,
} from "ethers";

const FORWARDER_ABI = [
  "function nonces(address) view returns (uint256)",
  "function execute((address from,address to,uint256 value,uint256 gas,uint48 deadline,bytes data,bytes signature) request) payable",
] as const;

const FORWARD_REQUEST_TYPES: Record<string, TypedDataField[]> = {
  ForwardRequest: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "gas", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint48" },
    { name: "data", type: "bytes" },
  ],
};

export type GaslessRequest = {
  from: string;
  to: string;
  value: bigint;
  gas: bigint;
  nonce: bigint;
  deadline: number;
  data: string;
  signature: string;
};

export class MarketplaceGasSponsor {
  private readonly forwarder: Contract;
  private readonly address: string;

  constructor(forwarderAddress: string, signer: Signer) {
    this.forwarder = new Contract(forwarderAddress, FORWARDER_ABI, signer);
    this.address = forwarderAddress;
  }

  async signRequest(
    target: string,
    data: string,
    gas: bigint,
    deadline: number,
    signer: Signer,
    value = 0n,
  ): Promise<GaslessRequest> {
    const from = await signer.getAddress();
    const [nonce, network] = await Promise.all([
      this.forwarder.getFunction("nonces")(from),
      signer.provider?.getNetwork(),
    ]);
    if (!network)
      throw new Error("The signer must be connected to a provider.");

    const request = {
      from,
      to: target,
      value,
      gas,
      nonce: BigInt(nonce),
      deadline,
      data,
    };
    const signature = await signer.signTypedData(
      {
        name: "Liberland Marketplace Forwarder",
        version: "1",
        chainId: network.chainId,
        verifyingContract: this.address,
      },
      FORWARD_REQUEST_TYPES,
      request,
    );

    return { ...request, signature };
  }

  async submit(
    request: GaslessRequest,
    relayer: Signer,
  ): Promise<TransactionResponse> {
    const forwarder = this.forwarder.connect(relayer);
    return forwarder.getFunction("execute")(request, {
      value: request.value,
    });
  }
}
