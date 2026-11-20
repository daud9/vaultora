# Document Registry (Soroban)

This crate implements a Soroban smart contract that records a 32-byte document fingerprint, a 32-byte fingerprint of encrypted metadata, its asserted owner, and the ledger timestamp at registration. It does not store document contents, names, or plaintext metadata.

## API

- `register_document(document_fingerprint, metadata_fingerprint, owner)` registers an owner/document pair. The owner must authorize the invocation. A repeated pair fails with `ContractError::DocumentAlreadyRegistered`.
- `verify_document(owner, document_fingerprint)` and `document_exists(owner, document_fingerprint)` return whether that pair has a record.
- `get_document_record(owner, document_fingerprint)` returns the typed record or `None`.
- A `DocumentRegistered` contract event is emitted after a successful write. Its indexed topics are the owner and document fingerprint; it intentionally omits metadata fingerprints and any off-chain content.

## Authorization and storage

Soroban does not expose an implicit `msg.sender`. The `owner` parameter is an asserted identity, not an automatically inferred caller. Registration calls `owner.require_auth()`, so the owner must provide the Soroban authorization required for that invocation; callers cannot register on another address's behalf without its authorization. Read methods are public.

Records use persistent contract storage under a typed key containing **both** the owner address and document fingerprint. Consequently, the same fingerprint can be registered by different owners, and an owner can register multiple fingerprints. Soroban persistent entries are subject to the network's storage lifecycle and rent rules; this contract does not implement archival or renewal workflows.

## Build and test

The crate is pinned to exactly `soroban-sdk = 29.0.1` (including test utilities). From this directory:

```sh
cargo test
cargo build --release --target wasm32v1-none
stellar contract build
```

Or from the repository root, run Cargo with `--manifest-path contracts/document-registry/Cargo.toml`. `stellar contract build` is an optional CLI build check and requires Stellar CLI to be installed. The Rust build target used here is `wasm32v1-none`; the contract avoids Protocol-30-specific APIs.

Tests exercise successful registration, record retrieval and verification, duplicate rejection with the explicit error, missing authorization, unknown fingerprints, owner-key separation, multiple documents per owner, metadata persistence, and a timestamp compared with the test environment's ledger timestamp.

## Limitations

Fingerprints prove only equality of the submitted hashes; the contract cannot validate the source document or decrypt metadata. The contract does not enforce a particular hashing/encryption scheme, prove that the metadata is encrypted, support record replacement/deletion, or establish legal identity beyond Soroban authorization. Consumers must independently manage confidentiality, canonicalization, key management, storage rent, and fingerprint generation.
