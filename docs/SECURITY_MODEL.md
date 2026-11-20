# VAULTORA Security Model

## Security goals

- Keep original documents, plaintext names, keys, recovery secrets, and unnecessary personal information off-chain.
- Compute integrity fingerprints locally in the browser.
- Require wallet authorization for changes to a user's registry state.
- Make public-chain behavior and Testnet-only status explicit.
- Never equate successful login with authority to decrypt a vault.

## Data classification

| Data | Phase 0 handling | Intended future handling |
| --- | --- | --- |
| Original file bytes | Selected locally for hashing; not uploaded | Encrypt locally before transfer to private object storage |
| File SHA-256 | Publicly displayed; only registered after explicit wallet action | Public commitment; assess equality and guessing leakage before registration |
| Encrypted metadata fingerprint | Contract record only when caller provides a digest | Derived from client-encrypted metadata; never plaintext metadata |
| Wallet address and transaction | Public Testnet data | Public-chain identifiers remain correlatable |
| Keys, recovery shares, plaintext names | Not collected by the contract | Client-held or threshold-protected; separate from login credentials |

## Threats and controls

- **Unauthorized registration:** a contract call must require authorization for the owner address, and tests should prove calls without auth fail. A caller-supplied address is not proof by itself.
- **Fingerprint disclosure:** hashes are public; equal files yield equal hashes, and low-entropy/predictable documents may be guessed. Users should understand this before anchoring a fingerprint.
- **Plaintext upload:** Phase 0 must hash in the browser and must not send the selected file to a backend. The UI should not imply encrypted storage exists.
- **Forged transaction feedback:** `submitted` is not `confirmed`; show transaction IDs and explorer links only from real RPC results.
- **Compromised login:** Google/passkey login is an authentication factor, not a document decryption key or replacement for wallet ownership.
- **Recovery collusion or loss:** threshold authorities can collude or become unavailable; delays and cancellation reduce but do not eliminate this risk.
- **Testnet instability:** Testnet can reset, and test funds/records have no monetary value or durability guarantee.

## Recovery security rule

Google authentication alone must never decrypt the vault or replace the cryptographic owner. A later recovery protocol must use independent authorities, explicit threshold authorization, a delay, cancellation, and an auditable key-envelope transition. See [Recovery Design](RECOVERY_DESIGN.md).

## Phase 0 limitations

No end-to-end encrypted storage, passkey login, smart-session service, file backend, private sharing, or guardian recovery is claimed here. A public hash is not confidentiality, proof of authorship, or proof that a document is safe. Contract authorization is only as strong as the wallet, contract, network, and client verification flow. All on-chain operations in this phase target Testnet; never use a production identity.

## Vulnerability reporting

Please disclose potential vulnerabilities privately. Follow the instructions in the repository's [`SECURITY.md`](../SECURITY.md); do not include live private keys, recovery secrets, or another person's data in a report.
