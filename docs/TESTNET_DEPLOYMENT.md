# Stellar Testnet Deployment

This repository targets Stellar Testnet only. Testnet accounts, XLM, contracts and records are experimental and may be reset. Do not use Mainnet identities or funds.

## Current verified deployment

On 2026-11-20 the registry was built with Stellar CLI `30.0.1` and deployed to Testnet. The contract ID is `CAQK2Q7I7Q5BAVP4LEOPRWSVRPPKAWIV4CVZPWH6AHIUYUDZTN67KWZQ`. The optimized Wasm was 8,585 bytes with hash `e24ae1b27c492b34894d2e8832ee619868877641ce64ab7f0a8dea4737500f51`.

The upload transaction is [188359356837a33017a2eba8e3a201d1e1d0e62f0c9f1b89640e5c39fd99abd9](https://stellar.expert/explorer/testnet/tx/188359356837a33017a2eba8e3a201d1e1d0e62f0c9f1b89640e5c39fd99abd9); the contract deployment transaction is [04c37317aea5dc3bb10f655d5bfa6281abb9f1294896a9d6cda108688284a5e6](https://stellar.expert/explorer/testnet/tx/04c37317aea5dc3bb10f655d5bfa6281abb9f1294896a9d6cda108688284a5e6). The deployed contract is visible in [Stellar Expert](https://stellar.expert/explorer/testnet/contract/CAQK2Q7I7Q5BAVP4LEOPRWSVRPPKAWIV4CVZPWH6AHIUYUDZTN67KWZQ).

The read-only verifier called `document_exists` with an all-zero, intentionally unknown fingerprint and received `false`. The command used `--send=no`; it submitted no transaction. No document was registered or uploaded. The temporary CLI identity configuration was removed after deployment; final read-only verification used the already-funded public Testnet address only. No seed phrase was committed or retained in the project. The local `.deployments/testnet.json` contains only public deployment metadata and is Git-ignored.

## Verified network and toolchain

A live Testnet `getNetwork` request returned protocol version 30 and passphrase `Test SDF Network ; September 2015` on 2026-11-20. The Soroban RPC is `https://soroban-testnet.stellar.org`; Horizon is `https://horizon-testnet.stellar.org`. Stellar's [network documentation](https://developers.stellar.org/docs/networks) describes Testnet resets and Friendbot. See [`FOUNDATION_RESEARCH.md`](FOUNDATION_RESEARCH.md) for official version and API references.

The project pins Rust `1.97.1`, target `wasm32v1-none`, Soroban SDK `29.0.1`, Node `24.22.0`, pnpm `11.25.0`, and Stellar CLI `30.0.1`. The optimized contract build requires release overflow checks, which are enabled in the root Cargo manifest.

## Reproduce the Testnet flow

The helper creates a dedicated Testnet identity under the CLI's default local configuration unless `XDG_CONFIG_HOME` is set. The CLI stores a 24-word seed phrase in its config by default; the helper suppresses the generation command's output, but the config directory still contains sensitive key material. Use a private machine and protect that directory, or provide a suitable secure-store setup. Never commit it or place the seed in a browser environment file.

```sh
bash scripts/initialize-testnet.sh
bash scripts/deploy-testnet.sh
bash scripts/verify-testnet.sh
```

The scripts reject a noncanonical network, RPC URL or passphrase. Deployment builds the locked contract, checks for a valid contract ID before writing metadata, and stores only public fields in ignored `.deployments/testnet.json`. The verifier accepts a local CLI identity alias or a funded public Testnet address through `STELLAR_SOURCE`; it uses `--send=no` and checks an unknown fingerprint returns `false`. For a raw `BytesN<32>` CLI argument, pass exactly 64 hexadecimal characters **without** a `0x` prefix.

To enable the local browser against this deployment, set `VITE_STELLAR_CONTRACT_ID=CAQK2Q7I7Q5BAVP4LEOPRWSVRPPKAWIV4CVZPWH6AHIUYUDZTN67KWZQ` in `apps/web/.env.local`. The file is ignored by Git. Registration still requires a compatible wallet to authorize a Testnet transaction and a separate encrypted-metadata fingerprint. Verification is a read-only simulation and does not sign or submit.

## Storage lifetime and safety

The contract extends a new persistent entry to the current network maximum TTL, but no automatic renewal feature is implemented. Reads and writes do not renew Soroban TTL. Long-term retention requires a separately reviewed renewal and archived-record restoration path; Testnet resets can erase state regardless. A successful Wasm build, deployment or read-only simulation is not an audit or production-readiness claim.
