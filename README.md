# Liberland Marketplace Contracts

Smart contracts, security-focused tests, deployment tooling, and client-compatible
artifacts for the Liberland Marketplace.

## Scope

The project is designed to provide updateable contracts with thoroughly tested security
properties and stable interfaces for marketplace clients. The initial chain targets are:

- Ethereum mainnet and other EVM-compatible networks.
- TRON through its Solidity-compatible toolchain and TronWeb.
- Solana through a documented compatibility implementation. Solidity EVM bytecode cannot
  simply be deployed natively to Solana, so each contract family must select one of:
  Solang compilation, an EVM compatibility layer, or a separately implemented native
  Solana program.

The repository is included as a submodule by the frontend. It keeps its own contract and
testing dependencies and exposes ABI/IDL and deployment artifacts for TypeScript clients.

## Security and Upgradeability

Contracts use OpenZeppelin primitives wherever applicable. Upgradeable contracts must
use an explicit proxy architecture, protected initialization, controlled upgrade
authority, storage-layout checks, and a documented migration process. Production upgrade
and pause authority should be held by a multisig or timelock rather than an individual
deployer account.

All signature and sponsored-transaction flows must include nonce/replay protection,
deadline checks, domain separation, chain separation, and strict signer validation.
Gas sponsorship will use a standard mechanism such as ERC-4337 account abstraction or
ERC-2771 trusted-forwarder meta-transactions, selected per contract family and documented
in its interface.

## Testing

Tests must cover normal behavior and adversarial behavior, including authorization,
invalid inputs, boundary values, events, reentrancy, replayed and expired signatures,
upgrade safety, pause behavior, malicious external tokens, failed calls, and invariant
properties. Contract changes should be verified with compilation, formatting, fuzzing or
invariant tests, and static analysis before deployment.

## Deployment and Client Integration

Deployment tooling will produce chain-specific records containing the chain/network,
contract version, proxy and implementation addresses where relevant, and deployment
transaction IDs. The client layer will provide TypeScript-compatible interfaces for:

- thirdweb and standard EVM providers/signers on Ethereum-compatible networks;
- TronWeb on TRON; and
- the applicable `@solana/*` libraries for Solang, EVM-layer, or native Solana output.

Cross-chain support means compatible documented behavior, not identical bytecode. Each
target must be tested independently before being advertised as supported.

## Current Implementation

The first implementation contains:

- `MarketplaceToken`, an upgradeable ERC-20 with EIP-2612 Permit, configurable name,
  symbol, and initial supply, defaulting to 21 million tokens with 18 decimals;
- `MarketplaceV4SwapRouter`, an upgrade-safe exact-input single-hop adapter that uses
  the V4 `PoolManager.unlock` callback, settles the input currency, and takes the output;
- configuration-driven EVM deployment through UUPS proxies; and
- regression tests for supply ownership, upgrade gates, irreversible upgrade shutdown,
  swap settlement, and minimum-output protection.

The router deliberately does not reimplement V4 pool accounting. Pool creation,
liquidity positions, and future DAO fee controls will use the V4 core/periphery boundary.
V4 liquidity positions are position NFTs rather than V2-style fungible LP tokens; any
fungible LP wrapper must be designed separately without weakening V4 position ownership.

## Commands

```bash
yarn install
yarn build
yarn test
yarn typecheck
```

Copy `.env.example` to an environment-specific configuration and select exactly one
`DEPLOY_CHAIN` per deployment. The current deployment script supports EVM-compatible
Ethereum/TRON targets and rejects Solana until the Solang artifact and deployment adapter
are added. Never put private keys in the environment file committed to Git.

## Browser Deployment

The browser-safe deployment API is exported from `src/deployment/browser.ts` and does not
import Hardhat, Node filesystem APIs, environment access, or private keys. The website
must inject a connected wallet signer and compiled ABI/bytecode artifacts:

```ts
import { deployMarketplaceFromBrowser } from "@liberland/marketplace-contracts";

const manifest = await deployMarketplaceFromBrowser({
  chain: "ethereum",
  network: "sepolia",
  poolManagerAddress,
  tokenName,
  tokenSymbol,
  initialSupply: 21_000_000n * 10n ** 18n,
  signer,
  tokenArtifact,
  swapArtifact,
  proxyArtifact,
});
```

`scripts/deploy.ts` is only the console runner. It loads the same artifacts through
Hardhat, calls the browser-safe function, and writes the resulting manifest to disk.

See [`AGENTS.md`](AGENTS.md) for mandatory engineering and security rules.
