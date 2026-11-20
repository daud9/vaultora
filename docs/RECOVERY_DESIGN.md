# VAULTORA Recovery Design

Recovery is a planned protocol, not a Phase 0 feature. No guardian can currently replace an owner, decrypt files, or approve recovery in VAULTORA.

## Intended security model

A user creates a vault encryption key locally. The key is never sent to Google, an application server, or Soroban in plaintext. The browser creates a versioned key envelope under the user's wallet/device-controlled key material and maintains independent recovery envelopes for multiple authorities.

An initial policy may use a 2-of-3 threshold: any two of three independent authorities can approve a recovery request. Approval starts a public or otherwise independently verifiable delay. The current owner can cancel a suspicious request during that delay. A successful recovery rotates the lost wallet's authority and creates a new envelope for the user's new key/device without exposing the underlying key to a single authority.

## Trust assumptions and failure cases

- Fewer than the threshold authorities are compromised or colluding.
- At least the threshold number of authorities remain reachable when needed.
- The delay is long enough for the user to detect and cancel abuse.
- The user retains a viable path to approve or cancel requests when one device is lost.
- The key-envelope format and cryptographic library are correct, versioned, and independently reviewed.
- Wallet, device, browser, authority keys, and recovery channels may be compromised or unavailable.

A threshold does not prevent collusion at or above the threshold. A delay does not stop an attacker if the user cannot receive alerts or cancel. Losing all recovery material may be intentionally unrecoverable; a support agent must not gain unilateral decryption capability.

## Required protocol work before implementation

1. Specify exact key generation, key wrapping, envelope serialization, domain separation, and version migration.
2. Select vetted cryptographic primitives and libraries; independently review use of authenticated encryption, threshold secret sharing or threshold key encryption, signatures, and randomness.
3. Define authority enrollment, key rotation, revocation, lost-authority replacement, replay protection, and policy changes.
4. Define request states, threshold rules, deadlines, delay, cancellation, race conditions, and reentrancy/duplicate-submission behavior.
5. Threat-model collusion, phishing, compromised devices, malicious recovery authorities, database rollback, and Testnet/Mainnet migration.
6. Test properties and adversarial cases, including tampering, partial approvals, expiry, duplicate approvals, concurrent requests, cancellations, and key-envelope recovery.
7. Obtain independent cryptographic and smart-contract review before handling real user data.

Google authentication or a passkey may help identify a user or protect an everyday session. Neither is a vault encryption key, and neither alone may authorize cryptographic ownership replacement.
