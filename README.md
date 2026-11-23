# VAULTORA

VAULTORA is a personal vault that encrypts files and private details in the browser before saving them to IndexedDB. It also keeps project spaces, saved links, and activity records encrypted on this device. A separate Stellar Soroban registry can store public integrity fingerprints on Testnet.

## Phase 1 status

| Area | What works |
| --- | --- |
| Local vault | Create and unlock a passphrase-protected vault. The app locks after 15 minutes without activity or when you lock it manually. |
| Documents | Encrypt, list, search, sort, star, rename, organize, download, and delete supported files. Files are limited to 25 MiB. |
| Project spaces | Create, edit, and delete encrypted spaces, then search and filter their documents. |
| Saved links | Create, search, edit, and delete encrypted HTTP or HTTPS links, descriptions, categories, and tags. |
| Activity | Store encrypted local activity records. They describe app actions and are not a tamper-proof audit log. |
| Recovery | The Recovery Shield reports the current state accurately. Guardian recovery is not implemented. Optional manual sync covers encrypted documents only and remains inactive until Supabase is configured and tested. |
| Wallet and registry | Preserves Varial wallet connection, Soroban registration with wallet authorization, transaction status, and read-only verification. Calls are pinned to Stellar Testnet. |

The app encrypts files and filenames in this browser before local storage or optional manual document sync. Saved URLs remain local. Registering a document publishes its SHA-256 fingerprint, an encrypted-metadata fingerprint, the wallet address, and a timestamp to the Testnet contract. Those registry values are public. The contract does not receive the file or filename.

## Local encryption and storage

The vault derives a non-extractable AES-256-GCM key from the passphrase with PBKDF2-SHA-256 and a random 16-byte salt, using 600,000 iterations. The app requires at least 12 passphrase characters. Each document uses a random 256-bit data key. That key encrypts the file and its metadata, then is wrapped by the vault key. Random 12-byte nonces and record-specific authenticated data are used for AES-GCM. Project spaces, saved links, and activity records are encrypted with the vault key.

The vault contents are kept in the browser's IndexedDB by default. If the owner configures Supabase, manual sync uploads encrypted document bytes and encrypted metadata; the passphrase is not sent. Project spaces, saved links, and activity remain local. Clearing browser data, losing the device, or forgetting the passphrase can make the vault unrecoverable if no encrypted cloud copy exists, and cloud data still cannot be decrypted without the passphrase. Browser storage can also be evicted or removed. Keep a separate backup of important files. The app does not promise cryptographic memory erasure after locking; browser and operating-system behavior is outside its control.

IndexedDB exposes random record identifiers, collection record types, salts, nonces, ciphertext sizes, and encrypted bytes to local profile inspection. Filenames, file contents, link URLs, workspace details, and activity labels are inside ciphertext. The app has not received an independent security audit. Treat this release as experimental and do not use it as the only copy of important files.

## Stellar Testnet

The browser uses the canonical Stellar Testnet RPC URL and network passphrase. Alternate network overrides are not supported. The contract ID is blank by default, so registry actions stay disabled until an owner configures the Testnet contract ID in `apps/web/.env.local`:

```sh
cp apps/web/.env.example apps/web/.env.local
# Set VITE_STELLAR_CONTRACT_ID to the reviewed Testnet contract ID.
```

The repository includes deployment details and transaction links for a Testnet deployment on 2026-11-20 in [`docs/TESTNET_DEPLOYMENT.md`](docs/TESTNET_DEPLOYMENT.md). This Phase 1 implementation did not refresh the live contract state or verify source correspondence. Confirm both before relying on that contract. Testnet state can be reset, and registry entries have Soroban storage TTL limits.

The app does not implement a mock chain. Registration prepares the Soroban call, asks Varial for authorization, submits the transaction, and reports the RPC result. Verification uses a read-only simulation and does not sign or submit a transaction. Wallet and RPC errors are shown as failures, not successful records.

## Cloud storage and recovery

The app includes a manual, ciphertext-only Supabase client for passwordless sign-in, document sync, restore, and deletion markers. It uses `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`; no Supabase values are stored in the repository, and Production remains unconfigured. If needed for the approved sign-in test, the preview will receive these values only as branch-scoped Preview settings after its exact Auth redirect is approved. The migration is at `supabase/migrations/20261123210000_private_vault_storage.sql`. The owner reports creating the Supabase project, applying the migration, and configuring Auth URLs. Read-only checks confirm Email Auth is enabled and anonymous table access is denied, but authenticated RLS and Storage policy behavior, email delivery, and end-to-end sync have not been verified. Keep device-local use available, and do not claim cloud backup is operational until the remaining setup and two-account isolation tests pass. See [`docs/VAULT_STORAGE_SETUP.md`](docs/VAULT_STORAGE_SETUP.md).

The Recovery Shield is a status page, not an active recovery service. Guardian enrollment, key shares, recovery delays, cancellation, and key rotation remain unimplemented. The design proposal is in [`docs/RECOVERY_DESIGN.md`](docs/RECOVERY_DESIGN.md).

## Run and verify

The repository pins Node.js `24.22.0`, pnpm `11.25.0`, Rust `1.97.1`, Soroban SDK `29.0.1`, and Stellar CLI `30.0.1`.

```sh
pnpm install --frozen-lockfile
pnpm run web:dev
```

Run web typechecking, tests, and production build:

```sh
pnpm run web:check
```

Run the broader local checks where the Rust and Stellar toolchains are installed:

```sh
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
stellar contract build --locked --package document-registry
```

`pnpm run verify` runs the web checks, Rust formatting, contract tests, and locked contract build. CI also runs Clippy and a secret scan. Testnet deployment scripts are described in [`docs/TESTNET_DEPLOYMENT.md`](docs/TESTNET_DEPLOYMENT.md).

## Release state

The existing public target is `https://vaultora-flax.vercel.app`. The owner approved only a separate review-branch preview for this Phase 1 change; it is not a production release. Production release requires the owner's confirmation after review of the exact changes, verification results, target, and rollback plan in [`docs/PHASE1_RELEASE_REVIEW.md`](docs/PHASE1_RELEASE_REVIEW.md).
