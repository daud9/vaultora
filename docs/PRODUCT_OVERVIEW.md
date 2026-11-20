# VAULTORA Product Overview

VAULTORA is a secure digital vault for important documents, project materials, notes, and saved links. Its defining security boundary is client-side control: the original file and its encryption keys should remain outside the blockchain, while Stellar Soroban can provide a public, independently checkable integrity record.

## The problem

People keep important records across disconnected drives, inboxes, devices, and services. Ordinary cloud storage may make organization easy but leaves users dependent on provider accounts and opaque access-control decisions. Losing an account can also mean losing access to important data.

## Product direction

VAULTORA is intended to combine:

- Local encryption before any future file upload.
- Private object storage for encrypted files.
- Soroban records for document fingerprints and encrypted-metadata fingerprints, not document contents.
- Wallet/passkey-compatible access, with everyday sessions separated from cryptographic ownership.
- Workspaces, documents, versions, bookmarks, and notes.
- Threshold-based recovery controlled by independent authorities.
- Explicit sharing permissions and audit events.

## Phase 0 boundary

Phase 0 establishes the repository and a small, testable Soroban document registry, a Testnet deployment workflow, and a web foundation for local file hashing and contract verification. It is not a complete vault: encrypted file storage, passkeys, smart sessions, sharing, and guardian recovery remain planned until implemented and independently tested.

## Privacy principles

Original files, plaintext names, encryption keys, recovery secrets, and unnecessary personal information must not be sent to Soroban. A document hash is public data and can reveal that two users registered identical content; it must not be treated as confidential. The product must explain that limitation before a user registers a fingerprint.
