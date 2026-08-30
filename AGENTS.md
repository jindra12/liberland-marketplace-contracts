# Contracts Repository Instructions

## Purpose

This repository contains the smart-contract layer and chain/client tooling for the
Liberland Marketplace. It is consumed as a subproject by the frontend repository, but
contract compilation, security testing, and deployment tooling remain owned here.

The supported targets are:

- Ethereum-compatible networks, including Ethereum mainnet.
- TRON, using the Solidity/TRON toolchain and TronWeb-compatible deployment output.
- Solana, using an explicitly documented compatibility strategy. EVM Solidity bytecode
  is not natively deployable to Solana; use a supported compiler/runtime such as Solang
  or an EVM compatibility layer, or provide a separately implemented native Solana
  program when the feature cannot be represented safely.

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
- TRON deployment and interaction output must be usable by TronWeb, including TRON
  address/transaction conventions.
- Solana output must be usable by the relevant `@solana/*` client libraries. Document
  whether a deployment is a Solang-compiled program, an EVM compatibility deployment,
  or a native Solana program with a separate ABI/IDL.
- Do not claim cross-chain behavioral equivalence until the same authorization, asset,
  upgrade, and failure semantics are tested on each target.
- Keep deployment logic deterministic and idempotent where possible. Record chain ID,
  deployment version, proxy addresses, implementation addresses, and transaction IDs.

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

## Questions Before Implementation

Resolve these project decisions before writing production contracts:

- Which marketplace assets and workflows are in the first contract release?
- Should upgrades use UUPS, Transparent Proxy, or another OpenZeppelin-supported model?
- Who controls upgrades, pauses, treasury funds, and emergency recovery?
- Is gas sponsorship required through ERC-4337, ERC-2771, or both?
- Is Solana compatibility expected through Solang, an EVM layer, or native Rust/Anchor
  programs with equivalent interfaces?
- Which networks, RPC providers, deployment accounts, and confirmation policies are
  supported in CI and production?
