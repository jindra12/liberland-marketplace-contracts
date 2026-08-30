import { Connection, PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";

export interface SolanaTransactionSigner {
  readonly publicKey: PublicKey;
  signTransaction(transaction: Transaction): Promise<Transaction>;
}

export interface SolanaProgramClientOptions {
  connection: Connection;
  programId: PublicKey;
  signer: SolanaTransactionSigner;
}

/**
 * Client boundary for Solang/native Solana programs. Instruction encoding belongs to
 * the generated Solana ABI/IDL adapter, not to the chain-independent client API.
 */
export class SolanaProgramClient {
  readonly connection: Connection;
  readonly programId: PublicKey;
  readonly signer: SolanaTransactionSigner;

  constructor(options: SolanaProgramClientOptions) {
    this.connection = options.connection;
    this.programId = options.programId;
    this.signer = options.signer;
  }

  async send(instructions: TransactionInstruction[]): Promise<string> {
    const transaction = new Transaction().add(...instructions);
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.lastValidBlockHeight = lastValidBlockHeight;
    transaction.feePayer = this.signer.publicKey;
    const signed = await this.signer.signTransaction(transaction);
    return this.connection.sendRawTransaction(signed.serialize());
  }
}
