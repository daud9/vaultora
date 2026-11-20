# Smart Contract Foundation

The VAULTORA Document Registry anchors a document SHA-256 fingerprint and an encrypted-metadata fingerprint to a Stellar owner. The contract never receives the original file, plaintext metadata, names, encryption keys or recovery secrets. Fingerprints and addresses are public and can be copied or correlated.

## Implemented interface

The registry exposes four operations:

| Function | Behavior |
| --- | --- |
| `register_document(document_fingerprint: BytesN<32>, metadata_fingerprint: BytesN<32>, owner: Address)` | Requires `owner.require_auth()`, rejects an existing owner/document pair, stores a record, extends its initial persistent TTL to the current network maximum, and emits a minimal event. |
| `verify_document(owner: Address, document_fingerprint: BytesN<32>) -> bool` | Returns whether that owner/fingerprint pair has a record. It is suitable for an unsigned simulation. |
| `document_exists(owner: Address, document_fingerprint: BytesN<32>) -> bool` | Direct existence check for the same key. |
| `get_document_record(owner: Address, document_fingerprint: BytesN<32>) -> Option<DocumentRecord>` | Returns the public stored record when present. |

The storage key is namespaced by both owner address and document fingerprint. A record stores owner, document fingerprint, encrypted-metadata fingerprint and ledger timestamp. The `DocumentRegistered` event contains only the owner and document fingerprint; it omits the metadata fingerprint.

## Authorization and storage lifetime

Soroban does not provide an implicit EVM-style `msg.sender`; the caller supplies an owner address, and the contract accepts it only after that address authorizes the invocation. Tests cover unauthenticated registration failure, the exact authorized owner, duplicate rejection, per-owner keying, record retrieval, the false result for unknown records and initial TTL extension.

Persistent entries have finite, independent TTLs. Reads and writes do not automatically renew an entry. Registration extends a new record to the current Testnet maximum, but the current contract and UI do **not** expose a record-renewal workflow. A record therefore needs a separately designed and authorized renewal/archival-restoration path before long-term retention can be claimed. Stellar Testnet itself can reset, which can erase all test records regardless of TTL. Never treat a Testnet record as durable evidence.

## Version and build

This project pins stable `soroban-sdk` `29.0.1`, Rust `1.97.1`, and `wasm32v1-none`; Stellar CLI `30.0.1` builds the optimized Wasm. The workspace release profile enables overflow checks because the CLI's optimized build requires them. Official source links and the verified network snapshot are in [`FOUNDATION_RESEARCH.md`](FOUNDATION_RESEARCH.md).

From the repository root:

```sh
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
stellar contract build --package document-registry
```

A local build and passing tests do not establish that a contract is deployed, audited or safe for production. See [`TESTNET_DEPLOYMENT.md`](TESTNET_DEPLOYMENT.md) for the separate Testnet workflow.
