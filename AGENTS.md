# Contracts Repository Instructions

## Purpose

This repository contains the smart-contract layer and chain/client tooling for the
Liberland Marketplace. It is consumed as a subproject by the frontend repository, but
contract compilation, security testing, and deployment tooling remain owned here.

The supported targets are:

- Ethereum-compatible networks, including Ethereum mainnet.

## Non-negotiable Security Rules

- Use the latest stable Solidity version supported by the selected toolchain.
- Prefer OpenZeppelin Contracts and OpenZeppelin Contracts Upgradeable primitives over
  custom implementations of access control, proxying, token standards, pausability,
  reentrancy protection, signature validation, and safe token transfers.
- Every upgradeable contract must use an explicit proxy pattern, initializer guards,
  storage-layout discipline, and a documented upgrade authority. Never use constructors
  for state initialization in an implementation contract.
- Upgrade authority must be a multisig or timelocked governance account in production;
  no deployer EOA may remain as an undocumented permanent administrator.
- Follow checks-effects-interactions, validate all external input, use safe casting and
  safe token transfer helpers, and protect every external call boundary.
- Treat signatures, permits, relayers, and meta-transactions as security-critical code.
  Include domain separation, nonce handling, expiry/deadline checks, replay protection,
  chain separation, and signer/forwarder validation.
- Gas sponsorship must be implemented using a reviewed standard such as ERC-4337
  account abstraction or ERC-2771 trusted-forwarder meta-transactions. Document which
  model each contract supports; do not invent a custom authorization protocol.
- Never commit private keys, mnemonics, RPC credentials, API tokens, or generated secret
  material. Deployment scripts must read secrets from the environment or an approved
  secret manager.
- Do not weaken tests, remove assertions, or increase timeouts to hide failures. Fix the
  contract, deployment, or test setup causing the failure.

## Testing Requirements

- Use a modern Solidity test runner, preferably Foundry, unless an existing project
  decision selects another tool.
- Every externally callable state-changing function needs success, authorization,
  invalid-input, boundary, event, and failure-path coverage where applicable.
- Test upgrade migrations and storage compatibility, not only the initial deployment.
- Test reentrancy, replayed signatures, expired signatures, wrong chain/domain,
  unauthorized upgrades, paused states, fee/rounding boundaries, malicious tokens, and
  failed external calls where the contract design permits those cases.
- Run static analysis and formatting as part of verification. Candidate tools include
  Slither, Foundry fuzzing/invariants, and a symbolic or formal-analysis tool for
  high-value flows.
- Deployment tests must verify deployed bytecode, proxy/implementation relationships,
  initialized roles, and chain-specific addresses.

## Chain and Client Boundaries

- Keep chain-independent contract interfaces and ABI exports stable and versioned.
- Ethereum client support must remain compatible with thirdweb and standard EVM
  providers/signers.
- Do not claim cross-chain behavioral equivalence until the same authorization, asset,
  upgrade, and failure semantics are tested on each target.
- Keep deployment logic deterministic and idempotent where possible. Record chain ID,
  deployment version, proxy addresses, implementation addresses, and transaction IDs.

## Frontend Contract Function Inventory

Treat this as the frontend integration checklist for the library. Keep the TypeScript
client API aligned with the deployed ABI and the actual capabilities of each chain. A
listed contract operation is not automatically available on every chain: mark it as
unsupported rather than silently routing it through an incompatible adapter.

### Existing package APIs

The package currently exports these frontend-callable APIs:

- `deployMarketplaceFromBrowser(options)`: deploys Ethereum implementations and proxies,
  initializes and wires token, DAO, reward token, swap router, timelock, and forwarder,
  reports transaction receipts through `onTransaction`, and returns a `DeploymentManifest`.
- `EvmTokenClient.balanceOf(owner)`, `transfer(recipient, amount)`,
  `approve(spender, amount)`, and `permit(owner, spender, amount, deadline)`.
- `ThirdwebTokenClient.balanceOf(owner)`, `transfer(recipient, amount)`, and
  `approve(spender, amount)`.
- `MarketplaceGasSponsor.signRequest(target, data, gas, deadline, signer, value?)` and
  `submit(request, relayer)`: Ethereum ERC-2771 signing and forwarding primitives. The
  separate relayer service, its allowlist, funding, and monitoring are not provided.
- `V4PositionClient.approveCurrency(token, amount, expiration)`,
  `mintPosition(request)`, `decreaseLiquidity(request)`, `collectFees(request)`,
  `burnEmptyPosition(tokenId, poolKey, deadline, hookData?)`, and
  `getPositionLiquidity(tokenId)`.
- `MarketplaceSwapClient.listPools(token, beforeBlock?, poolId?)`, `quote(pool,
  input, amount, slippageBps)` and `swap(quote, signer)` support fee-aware V4 trading
  on configured Ethereum networks. No pool liquidity is created by deployment.
- `MarketplaceDaoClient.listProposals(account?, beforeBlock?)`, `propose(input)`,
  `vote(id, support, reason)`, `queue(proposal)` and `execute(proposal)` support
  OpenZeppelin Governor discovery and timelocked governance on Ethereum networks.

Keep these exports and their types documented when changed. Add typed client methods
instead of making application components construct ABI strings, encode calldata, or
duplicate chain-specific transaction handling.

### Wallet and network operations the frontend must support

- Connect/disconnect a wallet using the host application's wallet integration; this
  package consumes an already-connected `Signer` or Thirdweb `Account`.
- Read the active account and network/chain ID, validate that they match the selected
  deployment manifest, and request a supported-network switch where the wallet allows it.
- Read token/native-currency balances and estimate/submit transactions using the chosen
  wallet. Show pending, confirmed, rejected, and reverted transaction states.
- Select a deployment manifest by chain and network; never infer an address from another
  chain or treat implementation addresses as user-facing proxy addresses.
- Display transaction hashes/IDs, confirmations, and links to the correct chain explorer.

### Marketplace token operations

Frontend clients and UI must be able to:

- Read `name`, `symbol`, `decimals`, `totalSupply`, `balanceOf`, `allowance`, `owner`,
  `governance`, `trustedForwarder`, `soulboundBalanceOf`, `liquidBalanceOf`, and
  `soulboundSince`.
- Transfer liquid tokens with `transfer`, approve spenders with `approve`, and use
  `transferFrom` only where the connected account has an explicit allowance.
- Create a gasless allowance with EIP-2612 `permit`, reading `nonces` and the EIP-712
  domain from the active token/network; handle expiry, signature rejection, and nonce
  changes. `ThirdwebTokenClient` does not currently implement permit.
- Root the caller's liquid balance with `soulbound(amount)`. Show liquid and rooted
  balances separately, explain that rooted units cannot be transferred, and show the
  current continuous-root timestamp used for reward eligibility.
- Read timestamp vote data using `clock`, `CLOCK_MODE`, `getVotes`, `getPastVotes`, and
  `getPastTotalSupply`; choose a delegate with `delegate` or `delegateBySig`.
- Explain that `soulboundFor`, `unsoulbound`, governance assignment, and upgrade controls
  are privileged operations and are not ordinary user actions.

### DAO and proposal operations

Provide frontend-readable typed operations for the OpenZeppelin Governor ABI, not just
the custom helper methods. The frontend needs to:

- Read DAO identity and configuration: `name`, `version`, `token`, `timelock`,
  `rewardToken`, `rewardPerPeriod`, `lastClaimAt`, `votingDelay`, `votingPeriod`,
  `proposalThreshold`, `quorum`, `quorumNumerator`, `quorumDenominator`, and
  `proposalNeedsQueuing`.
- Discover proposals and render their proposer, description, proposal ID, snapshot,
  deadline, ETA, state, quorum, and for/against/abstain totals using `hashProposal`,
  `state`, `proposalProposer`, `proposalSnapshot`, `proposalDeadline`, `proposalEta`,
  `proposalVotes`, `hasVoted`, and `getVotes` / `getVotesWithParams`.
- Create proposals with `propose`; vote with `castVote`, `castVoteWithReason`,
  `castVoteWithReasonAndParams`, or the corresponding `...BySig` methods when supported
  by the wallet; queue successful proposals with `queue`; execute ready proposals with
  `execute`; and present `cancel` only when the connected account is authorized by the
  Governor's proposal-cancellation rules.
- Encode governed calls for `setRewardPerPeriod`, `setRedemptionRate`,
  `fundRewardReserve`, `prebindTokens`, upgrade enable/freeze operations, and applicable
  OpenZeppelin Governor settings updates. These calls must be submitted as proposals and
  executed through the timelock; never expose them as direct admin transactions.
- Support `relay` for governance execution against controlled contracts where required,
  while targeting Governor `onlyGovernance` methods directly through the timelock.
- Report proposal lifecycle transitions accurately. A passed vote is not executable
  until any required timelock delay has elapsed.

### Rooted-holder rewards and LP reward token

- Read the DAO reward-token address and configuration, the account's rooted balance,
  `soulboundSince`, `lastClaimAt`, and the `CLAIM_PERIOD` before showing eligibility.
- Let eligible users call `claimReward`; show the transaction outcome and newly minted
  reward-token balance. Explain that claims require a continuous 30-day rooted period
  and another full period after each successful claim.
- Read reward-token `name`, `symbol`, `decimals`, `totalSupply`, `balanceOf`, `dao`,
  `redemptionToken`, and `redemptionRate`.
- Show the reserve-backed redemption estimate and let the holder call `redeem(rewardAmount,
  minimumAssetAmount)` with an explicit slippage/minimum-payout value. Display reserve
  insufficiency, zero-rate, rounding-to-zero, and slippage errors as actionable failures.
- Governance-only `mint`, `setRedemptionRate`, `enableUpgrades`, and
  `disableUpgradesPermanently` must not be offered as ordinary user controls.

### V4 swap and liquidity-position operations

- For swaps, read the configured router, PoolManager and DAO fee settings; select a valid
  `PoolKeyInput`; obtain a quote from a trusted V4 quoter/pool source; compute and show
  slippage-protected `amountOutMinimum`; then call `swapExactInputSingle` with the proper
  direction, hook data, and exact native value when the input currency is native.
- Show the router fee (`feeBps`) and recipient, input/output amounts, output minimum,
  transaction state, and the `SwapExecuted` result. Never imply that this router supplies
  quotes or discovers pools: `MarketplaceSwapClient` supplies those client-side operations.
- Approve ERC-20 currency to Permit2 and Permit2 to the PositionManager through
  `V4PositionClient.approveCurrency`; surface both transaction states and do not proceed
  to mint until the required approvals are confirmed.
- Support V4 position minting with pool key, tick range, liquidity, maximum token amounts,
  recipient, hook data, and deadline; return/display the minted NFT token ID.
- Support liquidity decrease/withdrawal with minimum amount limits, fee collection, and
  burning an empty position. Read position liquidity and verify NFT ownership before
  offering owner-only actions.
- A V4 position is a standard PositionManager NFT. It is distinct from the monthly
  `MarketplaceLPToken` reward and must be displayed and described separately.

### Timelock, ownership, and upgrade operations

- For authorized governance/admin views, read timelock roles, role admins, minimum delay,
  operation hash/state/timestamp, and readiness/completion using `hasRole`, `getRoleAdmin`,
  `getMinDelay`, `hashOperation`, `hashOperationBatch`, `getOperationState`,
  `getTimestamp`, `isOperation*`, `schedule`, `scheduleBatch`, `execute`, `executeBatch`,
  `cancel`, `grantRole`, `revokeRole`, `renounceRole`, and `updateDelay` as appropriate.
- Treat role-management and timelock scheduling/execution as governance operations. Do
  not present a deployer/admin key as a bypass after deployment has renounced that role.
- Display upgrade state (`upgradesEnabled`, `upgradesPermanentlyDisabled`) but never
  expose `upgradeToAndCall` as a user action. Upgrade enablement and implementation
  changes require the documented DAO/timelock path; permanent freezes cannot be undone.

### Chain-specific support boundaries and future client work

- Ethereum contract deployments support the EVM token adapter, Thirdweb token adapter,
  ERC-2771 sponsor helper, browser deployment, DAO/timelock contracts, swap router, and
  V4 position client, plus typed DAO and swap clients, subject to configured compatible
  V4 infrastructure.
- The frontend uses `MarketplaceDaoClient` and `MarketplaceSwapClient` for governance
  and trading. Reward claims/redemption remain in `VentureClient`. Keep chain support
  explicit and use the same typed adapters with Thirdweb and standard ethers signers.
- Any new frontend workflow must be represented by a typed library operation, declared
  chain support, authorization requirements, expected events/results, and normal plus
  adversarial tests. Update this inventory and the README in the same change.

## Repository and Integration Rules

- This repository has its own minimal dependencies and is included as a submodule of the
  parent package. Do not add frontend dependencies here unless client integration is
  explicitly being implemented.
- Keep contract source, tests, deployment scripts, generated ABIs, and TypeScript client
  adapters in clearly separated directories.
- Do not hand-edit generated ABI/type artifacts; regenerate them from the contract build.
- Update the README when adding a chain, contract family, deployment flow, upgrade model,
  or client-facing interface.
- Before reporting work complete, run formatting, compilation, unit tests, static checks,
  and the relevant deployment dry-run. Report any unavailable tool explicitly.

## TypeScript Style

- Use arrow functions for TypeScript tests, scripts, callbacks, and standalone helpers.
  Reserve the `function` keyword for class methods or APIs that explicitly require a
  function declaration. Do not leave declaration-style `describe`, `it`, fixture, or
  helper functions in new or modified TypeScript files.
- Do not invent local replacement types, runtime adapters, casts, or module shims for
  third-party integrations. Verify the supported package versions and official typing
  entrypoints first, then fix dependency versions or TypeScript configuration so the
  vendor-provided types are used directly.

## Questions Before Implementation

Resolve these project decisions before writing production contracts:

- Which marketplace assets and workflows are in the first contract release?
- Should upgrades use UUPS, Transparent Proxy, or another OpenZeppelin-supported model?
- Who controls upgrades, pauses, treasury funds, and emergency recovery?
- Is gas sponsorship required through ERC-4337, ERC-2771, or both?
- Which networks, RPC providers, deployment accounts, and confirmation policies are
  supported in CI and production?
