# Phase 0 Toolchain and Stellar References

The versions and behavior below were checked against official Stellar sources on 2026-11-20. They are a reproducibility snapshot, not a promise that upstream versions will remain current.

## Verified project baseline

- Stellar CLI `30.0.1` was downloaded from the official GitHub release and checked against its published SHA-256 asset digest. `stellar version` returned `30.0.1`. The current contract build requires `[profile.release] overflow-checks = true`; that setting is present in the workspace manifest.
- Rust is pinned to `1.97.1` for this project; the Soroban setup guide documents Rust `1.84.0+` and target `wasm32v1-none`.
- Soroban Rust SDK `29.0.1` is the latest stable release identified; `30.0.0-rc.1` is a prerelease. The contract manifest pins `=29.0.1` and the lockfile is committed.
- Browser packages used by this project are pinned in the pnpm lockfile: `@stellar/stellar-sdk` `17.4.0`, `@stellar/varial-sdk` `7.0.0`, React `19.3.1`, Vite `8.3.8`, Node `24.22.0` and pnpm `11.25.0`. The official sources identify the JS SDK v17.4.0 as current at this check and recommend the Varial SDK name for new integrations; they do not identify a latest exact Varial SDK version.
- Stellar Testnet Soroban RPC: `https://soroban-testnet.stellar.org`; exact passphrase: `Test SDF Network ; September 2015`. A live `getNetwork` request to that endpoint returned protocol version `30` on this check.

## Contract build, deployment and calls

Use `stellar contract build` for the contract Wasm path; the official CLI supports explicit `--package` selection in a workspace. Deploy with an explicit Wasm path and a dedicated Testnet identity. The CLI accepts contract constructor arguments at deployment; a separate initialization call is contract-specific, not universally required. For explicit read-only invocation, use `--send=no`. Keep CLI stdout and stderr separate when parsing results.

Soroban persistent entries are not permanent by default. Their TTL does not renew merely because an entry is read or written. `extend_ttl` or an `ExtendFootprintTTLOp` is required to raise TTL; each persistent entry has an independent TTL. The registry extends a newly registered record to the network's current maximum TTL. Later renewal is still needed to keep it live, and archived records require restoration. Stellar Testnet also resets periodically, so no Testnet deployment or record should be treated as durable.

## Wallet and browser notes

The current Stellar browser SDK is `@stellar/stellar-sdk`; official frontend documentation supports React-based applications and recommends generated typed contract bindings for stronger type safety. The Soroban RPC client supports direct browser use; the reviewed docs do not establish a minimum browser-version matrix or guarantee a specific public RPC endpoint's CORS policy. The official Varial developer guidance says new single-wallet integrations should use `@stellar/varial-sdk`; Stellar Wallets Kit is an alternative when supporting multiple wallet providers. SEP-43 remains Draft and should not be described as a finalized universal wallet standard.

## Official sources

- [Stellar CLI install and command manual](https://developers.stellar.org/docs/tools/cli/install-cli) · [CLI command reference](https://developers.stellar.org/docs/tools/cli/stellar-cli) · [CLI v30.0.1 release](https://github.com/stellar/stellar-cli/releases/tag/v30.0.1)
- [Soroban contract setup](https://developers.stellar.org/docs/build/smart-contracts/getting-started/setup) · [Soroban SDK releases](https://github.com/stellar/rs-soroban-sdk/releases) · [Contract SDK guidance](https://developers.stellar.org/docs/tools/sdks/contract-sdks)
- [Testnet RPC `getNetwork`](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getNetwork) · [Stellar network details and reset policy](https://developers.stellar.org/docs/networks)
- [Contract deployment and invocation guide](https://developers.stellar.org/docs/tools/cli/agent-cli/guides/build-and-deploy-contracts) · [Soroban storage archival and TTL](https://developers.stellar.org/docs/learn/fundamentals/contract-development/storage/state-archival)
- [JavaScript SDK repository/releases](https://github.com/stellar/js-stellar-sdk) · [Frontend dapp guide](https://developers.stellar.org/docs/build/guides/dapps/frontend-guide)
- [Varial developer documentation](https://github.com/stellar/freighter-developer-docs) · [Stellar wallet directory](https://developers.stellar.org/docs/tools/developer-tools/wallets) · [SEP-43 status](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0043.md)
- [Authorization testing guidance](https://developers.stellar.org/docs/build/guides/auth/contract-authorization)
