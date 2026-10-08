# Liberland Marketplace Contracts

Smart contracts, security-focused tests, deployment tooling, and client-compatible
artifacts for the Liberland Marketplace.

## Scope

The project is designed to provide updateable contracts with thoroughly tested security
properties and stable interfaces for marketplace clients. The initial chain targets are:

- Ethereum mainnet and other EVM-compatible networks.

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

### Browser exchange and DAO clients

`MarketplaceSwapClient` (`/client/trading`) discovers initialized pools containing
the venture token through PoolManager events. Discovery uses bounded 2,000-block
pages with an explicit older-history cursor. `quote` uses the canonical network
V4 quoter configured in `/deployment/networks`, deducts the DAO router fee and
returns a slippage-protected output minimum. `swap` checks the quote again, approves
only the required ERC-20 input amount, and submits through the venture router.
Native ETH input is passed as transaction value. No initialized/liquid pool means
no executable exchange quote; token deployment alone does not supply liquidity.

`MarketplaceDaoClient` (`/client/governance`) discovers ProposalCreated events in
bounded pages, reads snapshot voting power, quorum, votes, state and timelock ETA,
and supports `vote`, `queue`, `execute` and typed `propose` actions for monthly
rewards, router fees and token unrooting. Router/token changes are encoded through
Governor relay and cannot bypass voting or the timelock. Anonymous readers can
inspect markets and proposals; transactions require a connected wallet.

These clients support Ethereum, Sepolia and the local mainnet fork.

Deployment tooling will produce chain-specific records containing the chain/network,
contract version, proxy and implementation addresses where relevant, and deployment
transaction IDs. The client layer will provide TypeScript-compatible interfaces for:

- thirdweb and standard EVM providers/signers on Ethereum-compatible networks.

Cross-chain support means compatible documented behavior, not identical bytecode. Each
target must be tested independently before being advertised as supported.

## Current Implementation

The current implementation contains:

- `MarketplaceToken`, an upgradeable ERC-20 with EIP-2612 Permit, configurable name,
  symbol, and initial supply, defaulting to 21 million tokens with 18 decimals;
- `MarketplaceDAO`, an OpenZeppelin Governor using checkpointed soulbound token voting,
  a 4% quorum, a one-day voting delay, seven-day voting period, and a two-day timelock;
- `MarketplaceTimelock`, a DAO-operated UUPS timelock. Its own upgrades can only be
  authorized by a queued self-call, and can be permanently disabled through governance;
- `MarketplaceLPToken`, a DAO-minted reward token with a configurable, reserve-backed
  redemption path to the underlying marketplace token. Claims require 30 continuous
  days of soulbound balance; removing the entire bound balance resets eligibility;
- `MarketplaceV4SwapRouter`, an upgrade-safe exact-input single-hop adapter that uses
  the V4 `PoolManager.unlock` callback, settles the input currency, and takes the output;
- configuration-driven Ethereum deployment through UUPS proxies;
- browser-compatible Ethereum deployment orchestration;
- `MarketplaceGasSponsor`, an ERC-2771 typed-data client for a separately operated,
  funded relayer; and
- V4 position client operations for minting, reducing, collecting, and burning standard
  Uniswap V4 NFT positions.

The router deliberately does not reimplement V4 pool accounting. V4 positions are
standard PositionManager NFTs. The monthly `MarketplaceLPToken` reward is not a V4
position share: it is a redeemable incentive token, backed by the redemption assets
funded into its reserve. Governance must fund the reserve and set a nonzero redemption
rate before users can redeem.

The ERC-2771 forwarder is deployed with the contracts, but gas sponsorship also requires
an off-chain relayer that validates allowed targets/selectors and pays transaction gas.
The library provides request signing/submission primitives; it does not operate or fund
that relayer service.

## Commands

```bash
yarn install
yarn build
yarn test
yarn typecheck
```

Set `DEPLOY_CHAIN=ethereum`. The console runner uses Hardhat's configured EVM signer.
Never commit private keys or put them in tracked env files.

## Browser Deployment

The Ethereum browser deployment API is exported from `src/deployment/browser.ts`; it
accepts a connected EVM signer and compiled artifacts without reading secrets or
environment variables:

```ts
import { deployMarketplaceFromBrowser } from "@liberland/marketplace-contracts";

const manifest = await deployMarketplaceFromBrowser({
  chain: "ethereum",
  network: "sepolia",
  poolManagerAddress,
  positionManagerAddress,
  permit2Address,
  tokenName,
  tokenSymbol,
  initialSupply: 21_000_000n * 10n ** 18n,
  signer,
  tokenArtifact,
  swapArtifact,
  daoArtifact,
  rewardArtifact,
  forwarderArtifact,
  timelockArtifact,
  proxyArtifact,
});
```

Deployment creates the forwarder, implementations, proxies, timelock and DAO; assigns
DAO control to the token and swap router; grants the Governor proposer/canceller roles;
and renounces the deployer's timelock admin role. The DAO is the only route for
configuration and upgrade authorization. Ethereum must use the official chain-specific
Uniswap V4 addresses.

`scripts/deploy.ts` is only the console runner. It loads the same artifacts through
Hardhat, calls the browser-safe function, and writes the resulting manifest to disk.

To measure the same sequential flow locally without touching a live network:

```bash
TOKEN_NAME="Marketplace Token" TOKEN_SYMBOL="MKT" yarn estimate:deployment
```

The estimator deploys the sequence to an in-memory Hardhat network to measure gas
units. It then reads current Ethereum mainnet fee data through the frontend's
`REACT_APP_THIRDWEB` client ID using Thirdweb's documented Ethereum RPC endpoint.
It reads the ETH/USD spot price directly from the canonical Uniswap V3 USDC/WETH
0.05% pool at `0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640`. No deployment transaction
is sent to mainnet. The output includes the measured gas, current fee quotes, ETH/USD
spot price, and estimated cost in ETH and USD.

The script loads `REACT_APP_THIRDWEB` from the shell first and then from the parent
frontend `.env` file. It does not print the credential. `TOKEN_NAME` and
`TOKEN_SYMBOL` describe the locally simulated deployment and do not affect mainnet.

### Browser integration

`@liberland/marketplace-contracts/deployment/networks` owns the supported Ethereum
mainnet and Sepolia network configurations, including canonical V4 infrastructure.
It also includes a localhost mainnet fork at `http://127.0.0.1:8545`, chain ID `31337`,
with mainnet's V4 addresses. Start it from the parent repository:

```bash
yarn workspace @liberland/marketplace-contracts fork:local
```

The runner uses the existing `REACT_APP_THIRDWEB` value from the parent's `.env` or
shell environment and forks the latest mainnet block when started. Hardhat provides
20 funded development accounts. Never use these public development keys on mainnet.
Select **Local Ethereum mainnet fork** in the deployment form. If the browser runs
on your desktop while this repository runs over SSH, tunnel port 8545 to your desktop.
Local chain state is reset when the fork node restarts, unlike deployed mainnet contracts.

Applications select a configuration by key; ordinary users should never need to type
chain IDs, PoolManager, PositionManager, or Permit2 addresses.

`yarn build` compiles Solidity and runs `export:artifacts`. The generated browser
artifact bundle contains the compiled ABIs and deployment bytecode without importing
Hardhat or filesystem code at runtime.

`VentureClient` accepts an ethers provider or signer and offers account reads, rooting,
delegation, liquid transfers, reward claims, and reserve-backed redemption. It waits
for successful receipts before reporting a transaction as confirmed. Privileged DAO
configuration is not exposed as an ordinary account action.

The parent app currently exposes Ethereum deployment and these account actions.

See [`AGENTS.md`](AGENTS.md) for mandatory engineering and security rules.
