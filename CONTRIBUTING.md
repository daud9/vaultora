# Contributing to VAULTORA

Thank you for helping improve VAULTORA. The repository is an early Stellar Testnet foundation; do not add claims for unfinished security features.

## Development setup

- Node.js 24.22.0 (or a compatible version at least 22.12.0) and pnpm 11.25.0.
- Rust 1.97.1 with the `wasm32v1-none` target.
- Stellar CLI 30.0.1 for Soroban contract builds and Testnet operations.
- A Testnet identity only when deploying or submitting a transaction.

Install JavaScript dependencies with `pnpm install --frozen-lockfile`. Run the root `pnpm run verify` after implementation and tests are complete. Contract changes should include authorization, storage, and event tests. Frontend changes must not upload plaintext files or simulate wallet/transaction success.

## Security and privacy

Never commit seeds, private keys, tokens, `.env` files, document contents, recovery material, or credentials. Do not add document content or encryption keys to Soroban. New cryptographic or recovery behavior requires an explicit threat model and independent review before it is described as secure.

## Changes

Keep changes scoped, reviewable, and documented. Do not add a license or change the project license without the owner's decision. Use focused tests and report any checks that could not run rather than suppressing failures.
