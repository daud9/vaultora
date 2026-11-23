# Security Policy

VAULTORA Phase 1 is an experimental, client-encrypted vault for Stellar Testnet. The browser vault works locally; optional manual Supabase document sync is included but is not configured for Production or independently verified. Any settings added for the approved review preview are for testing only. It has not received an independent security audit. Do not use it as the only copy of important files or as a production recovery service.

## Current protections

- Files, document metadata, project spaces, saved links, and activity records are encrypted before they are stored in IndexedDB.
- The vault key is derived from the passphrase with PBKDF2-SHA-256, a random 16-byte salt, and 600,000 iterations. The app requires at least 12 passphrase characters.
- AES-256-GCM encrypts document data and metadata. Each document has a random 256-bit data-encryption key, wrapped by the vault key. Random 12-byte nonces and record-specific authenticated data are used.
- Web Crypto keys are non-extractable. Passphrase-derived key references remain in the unlocked session. The app clears decrypted records and form/search state when the user locks the vault or after 15 minutes without activity.
- Saved links accept HTTP and HTTPS URLs only. Supported document types and the 25 MiB size limit are checked before encryption.
- Soroban RPC and network passphrase are pinned to Stellar Testnet. The app has no Mainnet configuration path and does not mock transactions.
- When configured, the browser Supabase client receives only the project URL and publishable key. It uploads encrypted document bytes and encrypted metadata to a private bucket, with owner-scoped database and Storage policies defined in the migration. The vault passphrase is not sent to Supabase. Authenticated policy behavior has not been tested against the owner's project.

These controls do not make the app safe against every threat. A malicious extension, compromised browser, same-origin script injection, operating-system malware, or an attacker with an unlocked device may access plaintext or invoke the active key. Browser memory erasure is not guaranteed. Weak passphrases can be attacked offline if the local database is copied.

## Data and recovery limits

The local vault is stored in the current browser profile. If Supabase is configured, manual sync can keep encrypted document copies in the authenticated account; project spaces, saved links, and activity stay local. Supabase sign-in identifies the storage owner and does not decrypt the vault. There is no account reset or guardian recovery. Losing the passphrase makes both local and cloud ciphertext unrecoverable. Clearing browser data can remove the local copy, and browser storage can be evicted. The app cannot guarantee that all temporary plaintext has been erased when it locks.

Local IndexedDB inspection can reveal random identifiers, collection record types, salt and nonce values, approximate ciphertext sizes, and ciphertext. Filenames, document bytes, workspace details, saved URLs, and activity labels are encrypted. Other browser-profile data, including app preferences and wallet state managed by the wallet extension, is outside this vault's encryption boundary.

The app may publish a document SHA-256 fingerprint, an encrypted-metadata fingerprint, a public wallet address, and a timestamp to Stellar Testnet after a user authorizes registration. Those values can be correlated and may reveal information about predictable documents. Blockchain records are public and their storage can expire or be lost during a Testnet reset. Never submit sensitive content or metadata to the registry.

The owner reports creating a Supabase project, applying the migration, and configuring Auth URLs. Read-only checks confirm that Email Auth is enabled and anonymous table access is denied, but authenticated RLS and Storage policy behavior, email delivery, and cross-account isolation have not been live-tested. Production has no Supabase runtime values configured. Any values used for the approved preview must be restricted to that review branch and must not be described as production cloud backup. See [`docs/VAULT_STORAGE_SETUP.md`](docs/VAULT_STORAGE_SETUP.md) for setup and two-account test steps. Never put a Supabase service-role or secret key in browser configuration.

## Reporting a vulnerability

Please do not open a public issue for an exploitable vulnerability. Report it privately to the repository owner through GitHub's private vulnerability reporting feature when available. If that feature is unavailable, contact the maintainer through a private channel linked from the GitHub profile. Include the affected commit or component, impact, and safe reproduction steps. Redact credentials, personal data, document contents, and recovery material.

Please allow time for triage and a fix before public disclosure. This policy does not promise a response time or bounty. Testnet accounts, XLM, contracts, and temporary deployment metadata have no production value. Do not probe unrelated networks, accounts, or services.
