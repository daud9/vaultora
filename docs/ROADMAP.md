# VAULTORA Roadmap

## Phase 0 — foundation

- Repository, CI, and security documentation.
- Soroban document registry for owner-scoped document and encrypted-metadata fingerprints.
- Testnet build/deploy/invoke/verification workflow.
- Responsive web foundation, wallet connection, and local SHA-256 calculation.
- Clear boundaries: no encrypted object storage or recovery claims.

## Phase 1 — reviewed client-side encryption

- Select and document a vetted authenticated-encryption implementation.
- Generate keys using browser cryptographic randomness and define key derivation/wrapping with explicit versioning.
- Encrypt/decrypt locally; test round trips, tamper detection, malformed inputs, key lifecycle, and browser failure handling.
- Add a clear privacy notice for public fingerprint equality and guessing risks.
- No server receives plaintext files or encryption keys.

## Phase 2 — private encrypted object storage

- Add a narrowly scoped API for encrypted bytes and opaque object references.
- Define upload integrity, authorization, deletion, retention, backup, and metadata-leakage behavior.
- Verify decrypted content against the registered fingerprint on the client.

## Phase 3 — identity and everyday access

- Add wallet-linked ownership and passkey-compatible sessions.
- Add device registration, limited smart sessions, revocation, and account-security flows.
- Keep login identity distinct from key control.

## Phase 4 — independent recovery

- Complete the protocol and independent cryptographic review described in [Recovery Design](RECOVERY_DESIGN.md).
- Implement a threshold policy, delayed requests, owner cancellation, and key-envelope rotation only after the review passes.
- Test compromise, collusion, loss, race, replay, and failure scenarios.

## Phase 5 — organization and sharing

- Add workspaces, versions, bookmarks, encrypted notes, fine-grained sharing, and revocation.
- Minimize public metadata and include auditable but privacy-aware event handling.
- Reassess on-chain data before any mainnet release.
