# VAULTORA Web

The React/TypeScript frontend is a browser-only Phase 0 workspace for document fingerprints on Stellar Testnet. For the whole-repository overview, setup and security notes, see the [root README](../../README.md).

## Implemented

The app hashes a selected file locally with Web Crypto SHA-256; it does not upload or save the file. It connects to Varial, shows the actual wallet address, and keeps registry actions disabled until a contract ID is configured. It does not show sample records or invented transaction activity.

Registration sends a real contract transaction only after the connected Testnet wallet authorizes it. It stores the file fingerprint, an encrypted-metadata fingerprint supplied by the user, and the owner address in the registry. VAULTORA does not encrypt or upload metadata. Verification builds a read-only RPC simulation for the connected owner and document fingerprint; it does not request wallet authorization or submit a transaction. Contract errors and RPC failures are shown as errors, not success.

## Contract ABI expected by the client

The default names match `contracts/document-registry`:

```text
register_document(document_fingerprint: BytesN<32>, metadata_fingerprint: BytesN<32>, owner: Address) -> Result<(), ContractError>
verify_document(owner: Address, document_fingerprint: BytesN<32>) -> bool
```

The Stellar XDR representation for `BytesN<32>` is a bytes value; the client validates a 64-character hexadecimal digest and encodes exactly 32 bytes. The contract enforces the fixed-length type. If method names are overridden, they must still accept these arguments and verification must return a boolean.

A fingerprint is public and may be correlated or guessed. This interface is not a document-encryption system. The stored metadata fingerprint must be calculated from metadata encrypted elsewhere; no encryption or metadata-storage flow is included here.

## Configuration

Copy `.env.example` to `.env.local` in this directory. Testnet RPC and passphrase have safe defaults. Leave the contract ID blank until the registry is actually deployed.

- `VITE_STELLAR_RPC_URL` changes the Soroban RPC endpoint.
- `VITE_STELLAR_NETWORK_PASSPHRASE` sets the transaction and simulation passphrase.
- `VITE_STELLAR_CONTRACT_ID` enables registry actions when set to a real contract address.
- `VITE_STELLAR_REGISTER_METHOD` and `VITE_STELLAR_VERIFY_METHOD` override the default function names; the ABI above still applies.

These values are bundled into browser code. Never put a seed phrase, private key, API credential or other secret in a `VITE_` variable.

## Commands

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --dir apps/web dev
pnpm --dir apps/web typecheck
pnpm --dir apps/web test
pnpm --dir apps/web build
```

Soroban SDK calls are dynamically imported when the user starts an operation; the production build may show a chunk-size warning for the SDK chunk.

## Not implemented

There is no backend, registry indexer, local document catalogue, project-space manager, saved-link library, encryption, object storage, account recovery, in-app settings screen or transaction-history indexer. The dashboard marks these as planned. Registry records use persistent storage with finite TTL; entries must be renewed and Testnet itself can reset. See [`docs/TESTNET_DEPLOYMENT.md`](../../docs/TESTNET_DEPLOYMENT.md) and [`docs/RECOVERY_DESIGN.md`](../../docs/RECOVERY_DESIGN.md).
