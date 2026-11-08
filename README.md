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
the venture token through PoolManager events. Discovery uses bounded 1,000-block
pages with an explicit older-history cursor. `quote` uses the canonical network
V4 quoter configured in `/deployment/networks`, deducts the DAO router fee and
returns a slippage-protected output minimum. `swap` checks the quote again, approves
only the required ERC-20 input amount, and submits through the venture router.
Native ETH input is passed as transaction value. No initialized/liquid pool means
no executable exchange quote; token deployment alone does not supply liquidity.

`MarketplaceDaoClient` (`/client/governance`) discovers ProposalCreated events in
bounded pages, reads snapshot voting power, quorum, votes, state and timelock ETA,
and supports `vote`, `queue`, `execute`, pending-proposer `cancel`, and typed `propose` actions for monthly
rewards, router fees, token unrooting, treasury-funded prebinding, reserve funding,
redemption rates, implementation upgrades, upgrade enablement and permanent freezes.
Voting delay, voting period, proposal threshold and quorum are also governed proposal
types. `settings()` reads their live values; durations use the Governor's seconds clock.
Router/token changes are encoded through
Governor relay and cannot bypass voting or the timelock. Anonymous readers can
inspect markets and proposals; transactions require a connected wallet.

These clients support Ethereum, Sepolia and the local mainnet fork.

The sister backend persists pool and proposal events in MongoDB through
`GET /api/startups/:id/contract-index?deploymentId=...`. It resumes from a saved,
block-hash-verified cursor instead of making every browser scan history. Pass its
proposal records to `listProposals(account, undefined, records)`. Current prices,
balances and governance states still come from chain reads.

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
  a 4% quorum of the **entire fixed ERC-20 supply** (rounded up), a one-day voting
  delay, seven-day voting period, and a two-day timelock. Only rooted, delegated
  balances vote; an early one-token rooter cannot govern a 21-million-token supply;
- `MarketplaceTimelock`, a DAO-operated UUPS timelock. Its own upgrades can only be
  authorized by a queued self-call, and can be permanently disabled through governance;
- `MarketplaceLPToken`, a DAO-minted reward token with a configurable, reserve-backed
  redemption path to the underlying marketplace token. Claims require 30 continuous
  days at an unchanged soulbound balance. Every top-up or partial/full unroot resets
  eligibility. `rewardPerPeriod` is the supply-wide monthly budget, not a per-wallet
  payment: each claim is `floor(budget * rootedBalance / totalSupply)`. Splitting stake
  across wallets cannot increase its combined reward. Claims do not accumulate missed
  periods, and a successful claim starts another 30-day wait;
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

### Security boundaries for deployment and trading

- Browser deployment validates the positive uint208 fixed supply, token identity,
  starting price, and configured canonical infrastructure before broadcasting.
- Pool initialization is idempotent only at the explicitly requested price. An existing
  pool at another price requires review; the library never silently resets or adopts it.
- Deployment checkpoints include transaction hash, nonce, chain ID and submission block.
  Recovery verifies sender, target, calldata, native value and chain. Matching wallet
  replacements are supported, but cancellation or changed intent is rejected. A missing
  old hash is searched in at most 64 recent blocks; ambiguous or older replacements
  require receipt/nonce reconciliation, never automatic duplicate deployment.
- Liquidity approvals pin Permit2 and PositionManager to the chain configuration and
  verify code/manager relationships. Swaps additionally verify the proxy and implementation
  executable bytes against generated build artifacts, and verify the trusted forwarder.
  A legitimate new router build needs a reviewed library/artifact update before approval.
- An empty pool is quoted only against its canonical `Initialize` price. Discovery returns
  `initializationBlock`, permitting a bounded single-block lookup for old pools. Without
  that field, the fallback covers 1,000 blocks and fails closed if no reference is found.
  Canonical PositionManager maximum amounts still enforce the reviewed mint on-chain if
  the price moves after quoting; a quote-time check alone is not transaction protection.
- Swaps require an on-chain deadline as well as minimum output. Old quotes without a
  deadline are rejected, and the unsafe five-argument router ABI is no longer supported.
- Typed upgrade proposals reject an unexpected trusted-forwarder change. This is not
  a sandbox for arbitrary governance code: an approved upgrade remains a powerful action
  requiring review. DAO quorum and the timelock do not replace an independent audit.

These fixes change reward economics and the swap ABI. Regenerate/consume the matching
artifacts together; do not point the new swap client at an old router. Existing deployments
would need an explicitly reviewed governance migration and reward-budget adjustment.
Cross-device deployment leases and concurrent backend deployment-record updates belong
to the application/backend and are not solved by this library's transaction journal.

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
  poolTokensPerEth: 2_000n * 10n ** 18n,
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

`poolTokensPerEth` initializes a hook-free native ETH/token pool at the user's
chosen starting price (0.3% pool fee). It does not spend liquidity funds. The
manifest includes its pool ID and deployment block. Use Uniswap's position UI on
mainnet, or `V4PositionClient` on test networks, to fund/manage standard positions.
`quoteFullRange` uses the configured canonical StateView and Uniswap V4 SDK to size
native/token deposits within maximum budgets and slippage limits. `verifyPosition`
checks NFT ownership and pool identity. The parent app provides test-network deposit,
inspection, withdrawal with explicit receipt minimums, fee collection and empty-NFT closure.

For resumable deployments, persist each `{label, hash}` in `onSubmitted` before
waiting for confirmation and supply those records as `transactions` on the next
call. The runner validates sender, destination and calldata, reuses receipts, and
skips completed ownership/role changes. Missing or mismatched transactions stop
recovery rather than triggering another deployment. The parent frontend stores
this journal locally before syncing it to the Venture owner's private backend record
at `/api/startups/:id/deployment-recovery?walletAddress=...` (GET/PUT/POST/DELETE).
The same marketplace login and wallet can resume on another device. New deployments
are blocked until the backend journal loads; failed synchronization retains the local
hash backup. Completed manifest persistence can be retried without redeployment.

The application acquires an exclusive runner identity before deployment and supplies
`beforeTransaction` to recheck journal ownership before each new wallet submission.
Recovery takeover and abandonment require explicit confirmation after all other
sessions and wallet prompts have stopped and pending nonces/hashes are reconciled.
Takeover is revision/snapshot checked; archival preserves evidence and prevents the
retired runner from restarting. Neither operation revokes already signed transactions.
Saved deployment registrations are append-only and merged atomically on the backend,
so one browser cannot overwrite another browser's deployed addresses with an old list.

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
Select **Hosted Ethereum mainnet fork (test deployment)** in the deployment form.
Local chain state is reset when the fork node restarts, unlike deployed mainnet contracts.

For a deliberately public hosted test fork, run `yarn fork:hosted`. This binds port
8545 on all interfaces. The sister backend forwards `/api/venture-test-rpc` to this node
so HTTPS browsers can connect without mixed-content requests. Anyone can mutate or
reset this development chain; never load real keys or treat its balances as real funds.

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

## Security Regressions

The deployment regressions assert safer behavior against the current unfixed client:

```bash
yarn test --no-compile test/MarketplaceDeploymentBoundaries.ts
yarn test:fork --no-compile
```

The first command uses only an isolated Hardhat chain. The fork command reads current
Ethereum state through the existing `REACT_APP_THIRDWEB` setting in the parent `.env`
or process environment. All signed transactions stay on the in-process local chain;
it does not deploy to mainnet, start the hosted fork service, or expose a port.
Run `yarn hardhat compile` first to compile Uniswap's official test swap harness.
The fork case is separate from the default unit suite and restores the local chain.

Expected failing assertions cover edited spending infrastructure, invalid supply
preflight, mined replacement recovery, and an empty canonical pool accepting a moved
price for first liquidity. These are reproductions, not application fixes or a claim
that every economic attack has been simulated profitably.
