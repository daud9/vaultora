# Passkey Smart-Account Wallet (Stellar Testnet)

VAULTORA can create a real Stellar smart-account wallet from a device
passkey, in addition to the existing Varial browser-wallet integration.
This document records the exact implementation, its limits, and how to test
it by hand. It does not claim anything that has not been run.

## Status: implemented, not yet proven on a live Testnet run

- The code, unit tests, typecheck, and production build are verified
  locally (see "Verification" below).
- **Not yet verified:** a real passkey ceremony on Android/desktop, a real
  smart-account deployment, a real faucet funding, a real balance read, or
  a real document-fingerprint registration with a passkey wallet. Those
  need a real browser/device and the Testnet relayer, and must be run by
  hand following the procedure below. Do not claim they work until they do.
- **2026-11-27 — the shared SDF relayer proxy is unusable from browsers.**
  The first manual test (Android Chrome, preview deployment) failed at
  deployment with "Smart-account deployment failed: Failed to fetch".
  Root cause, verified by direct probing: the shared proxy
  `https://smart-account-relayer-proxy.sdf-ecosystem.workers.dev`
  returns 403 `{"success":false,"error":"Origin is not allowed"}` for
  **any** request carrying an `Origin` header — the preview domain, the
  production domain, `localhost:5173`, and `lab.stellar.org` were all
  rejected; the same request without `Origin` is processed. Browsers
  always send `Origin` on cross-origin fetch, so the kit's
  `relayer.send()` preflight fails from any browser. This is not a
  network problem on the user's device, and merging to `main` would not
  fix it (the production origin is rejected too).
- **2026-11-27 — self-hosted relayer implemented.** VAULTORA now runs
  its own relayer as a same-origin Vercel serverless function,
  `POST /api/relayer` (`apps/web/api/relayer.ts` thin entry point +
  `apps/web/api/relayer-handler.ts` implementation, allowlist in
  `apps/web/api/relayer-validation.ts`). The app defaults to it
  (`PASSKEY_RELAYER_URL` is now `"/api/relayer"`); `VITE_RELAYER_URL`
  remains only as an override. The endpoint is live on the
  `passkey-smart-wallet` preview, the sponsor account is funded (see
  "Fee sponsorship"), and invalid payloads are rejected without
  touching RPC (verified live, see "Verification"). A real passkey
  ceremony through it has still not been run — that needs Daud's
  device.

## Selected SDK

- **`smart-account-kit` 0.10.0** (pinned exactly in
  `apps/web/package.json`), Stellar-maintained. It depends on
  `@stellar/stellar-sdk ^16.4.1` internally and
  `smart-account-kit-bindings 0.5.0`.
- Why this one: it is the Stellar-maintained passkey smart-account SDK,
  it supports passkey creation, deployment, silent session restore,
  explicit multi-account selection, Friendbot funding of a contract
  address, and relayer fee sponsorship. `passkey-kit` (the older package)
  was considered and not chosen: the Smart Account Kit is the currently
  maintained path and its 0.10.0 README documents the SDK 17 boundary
  used here.
- VAULTORA stays on **`@stellar/stellar-sdk` 17.4.0**. The two SDK majors
  coexist (the kit carries its own SDK 16 copy). At the boundary we pass
  **base64 XDR strings only** — never SDK 17 objects to the kit. In
  particular, `kit.signAuthEntry(entry.toXdr("base64"), …)` returns a
  base64 string that SDK 17 decodes with
  `xdr.SorobanAuthorizationEntry.fromXdr(signed, "base64")`.
- The kit's `execute()`/`executeAndSubmit()` path was **not** used for
  the registry call: its `target_args` are `Vec<Val>`, and the kit's
  SDK 16 converter turns a plain address string into a string ScVal
  (not an address) and rejects SDK 17 ScVal objects. Instead the
  registry call is built with SDK 17, its auth entries are signed with
  `kit.signAuthEntry`, the transaction is re-simulated (WebAuthn
  signatures are larger than the simulation placeholder), and it is
  submitted through the relayer's `send(func, auth)` — the composition
  the kit README documents for SDK 17 apps and relayer submission.

## Configuration (Testnet, verified values)

| Setting | Value | Source |
| --- | --- | --- |
| Account WASM hash | `c514d35ea67eaea9bfc1fb3327854c0c06111bc1ddebd4fe217c504c1004b9e1` | stellar-accounts v0.8.0 |
| WebAuthn verifier | `CC7EKIHQP3TN4CARQDND6CEOY2UXLWWC2X5GHTD5NLAT7BG5GPZIOM3F` | Protocol 27 set |
| Ed25519 verifier | `CAAVTMCBXEIBPR64EAASKFXERVPYFZA2JYP5A3BG6PESWEFUJX5IHKN4` | Protocol 27 set |
| Native XLM SAC | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` | Testnet native token |
| Threshold policy | `CAZ2WFUDXGX265LOEARFEOYYUL6F4BYWXZLGUAWZNJY3MRFPNLSZVS4S` | v0.8.0 |
| Weighted-threshold policy | `CDBYLFLUNPAYGE3AHZSMB4TFWECFCCHX6CJFMFO6HRPKK2W5PFU2LCKE` | v0.8.0 |
| Spending-limit policy | `CC3CEYQAP6NPNFIYSWL5MVZRCPJZGWX4XO7WDEJOUVGO2FZX5OONYPA5` | v0.8.0 |
| Relayer (self-hosted) | `POST /api/relayer` (same origin; Vercel serverless function) | VAULTORA, Testnet |
| Relayer sponsor account | `GAOKZ6BA6QS3OSRUQIACV7VNHJHTKFMKAHCQMEEV2JMMY44AFACITZ7I` (10,000 Testnet XLM from Friendbot, 2026-11-27) | VAULTORA, Testnet |
| Shared SDF relayer proxy | `https://smart-account-relayer-proxy.sdf-ecosystem.workers.dev` — **DO NOT USE**: returns 403 "Origin is not allowed" for every browser origin (verified 2026-11-27) | SDF ecosystem, Testnet |
| RPC / passphrase | `https://soroban-testnet.stellar.org` / `Test SDF Network ; September 2015` | pinned, as before |
| Registry contract | `CAQK2Q7I7Q5BAVP4LEOPRWSVRPPKAWIV4CVZPWH6AHIUYUDZTN67KWZQ` | existing, unchanged |

All of these are defaults in `apps/web/src/lib/passkeyWallet.ts` and can
be overridden with the `VITE_PASSKEY_*` / `VITE_RELAYER_URL` variables in
`apps/web/.env.example`. No secret is in the bundle: the relayer URL is a
public proxy endpoint, and the kit's default deployer keypair is a public,
shared, sign-only keypair (it salts deployment and never controls the
account or pays fees).

## How it works

### Creation — `apps/web/src/lib/passkeyWallet.ts`

1. `createPasskeyWallet(displayName?)` checks WebAuthn support
   (secure context + `PublicKeyCredential` + `navigator.credentials`).
2. It calls `kit.createWallet("VAULTORA", userName, { autoSubmit: true,
   autoFund: false, nativeTokenContract })`. The browser runs the native
   WebAuthn creation ceremony from the user's click; the kit deploys the
   smart account through the relayer and connects **only after
   deployment succeeds**. A failed `submitResult` throws — success is
   never reported before on-chain confirmation.
3. Credentials and the session are stored only through the kit's
   `IndexedDBStorage`. No private key, seed phrase, or passkey material
   is stored in localStorage or sent anywhere.

### Returning users

- On vault unlock, `restorePasskeySession()` calls `kit.connectWallet()`
  with no options (silent restore from the stored session).
- "Connect with passkey" tries the silent restore first, then
  `kit.connectWallet({ prompt: true })`. It never creates a new wallet.
- If the passkey is linked to several accounts, the kit throws
  `WalletAmbiguousError`; VAULTORA surfaces the candidate contract
  addresses and asks the user to choose one. It never auto-picks, and a
  credential id alone is never treated as proof of ownership — the kit
  verifies birth, current code, a live signer, and fresh passkey
  ownership before connecting.

### Mandatory email recovery backup — `apps/web/src/lib/passkeyRecovery.ts`

After a passkey wallet is created or connected, VAULTORA **requires** an
email recovery backup before the user can continue. The onboarding modal
opens a "Back up your wallet — required" step that cannot be skipped:
the close button, the scrim click, and Escape are all disabled while it
is shown, and "Continue to VAULTORA" stays disabled until the backup is
recorded. A returning user whose wallet has no recorded recovery is sent
to the same step on silent restore; a user who already completed it is
not asked again. Varial wallets are unaffected — this is passkey-only.

**What email does (and what it does not do).** An email address is not
a cryptographic recovery key. It cannot by itself restore a lost
passkey, decrypt anything, or re-create an account, and the UI says so
in plain language. What it does:

1. It records a recovery contact for the wallet — non-secret metadata
   only (public contract address, the email typed, when it was sent or
   saved, and whether a backup passkey was enrolled), stored in
   localStorage under `vaultora-passkey-recovery:v1`.
2. It delivers the wallet's contract address, a link back to VAULTORA,
   and the steps to add a backup passkey.
3. It gives the user a reason to enroll that second passkey on another
   device *before* losing the first one. The second passkey is the real
   backup; the email is only how the user finds their way back to
   enroll it.

**How the email is sent: it is not sent by VAULTORA.** There is no
backend email service for wallet recovery in this repo, and the
Supabase OTP flow is for encrypted document cloud sync only. "Email my
recovery details" opens the user's own mail app with a `mailto:` link
(pre-filled subject and body) — VAULTORA sends nothing and cannot
confirm delivery. "Copy recovery details" copies the same text. The
user then confirms with "I've sent / saved my recovery email", which is
what records the backup. No private keys, seeds, or passkey material
are ever stored or sent.

**Backup passkey enrollment.** From the recovery step, "Add a backup
passkey (recommended)" calls `kit.signers.addPasskey(0, "VAULTORA",
email, { nickname: "Backup passkey" })` and submits the resulting
transaction with `kit.signAndSubmitAdmin` — the admin transaction is
authorized by the existing passkey, so it must be done while the first
device is still available. On success the credential id is recorded
against the recovery record, and the wallet menu and Settings show the
recovery email and whether a backup passkey exists.

**Device loss.** If the only passkey is lost and no backup passkey was
ever enrolled, the account is unrecoverable — email alone does not
change that. If a backup passkey was enrolled, that passkey can connect
the same wallet on its own from the second device.

### Faucet — "Request Testnet XLM"

- `fundPasskeyWallet()` calls `kit.fundWallet(nativeTokenContract)`.
  Friendbot cannot fund a contract address directly, so the kit funds a
  temporary account and transfers XLM to the smart account. The button
  is Testnet-only, disabled while a request is in flight, and the UI
  shows the real balance afterwards (read with `getNativeBalance`).
  A failed result is shown as a failure, never as a funded balance.
- Testnet XLM has no real monetary value.

### Balance

- `getNativeBalance(address)` simulates the native token SAC
  `balance(address)` call with SDK 17 and formats stroops as XLM.
  It returns `null` when the balance cannot be retrieved; the UI then
  shows "Balance unavailable", never a fabricated number.

## Soroban registry compatibility

- **No contract change was needed.** The registry methods are
  `register_document(document, metadata, owner: Address)` (with
  `owner.require_auth()`) and `verify_document(owner, document)`.
  `Address` accepts a C… smart-account address.
- **Records are per-owner.** A G… (Varial) account and a C… (passkey)
  account have separate record namespaces: a fingerprint registered
  under one owner will not verify under the other. The UI does not hide
  this — the connected wallet's provider and address are always shown.
- Passkey path (`apps/web/src/lib/soroban.ts`, `walletKind: "passkey"`):
  - Verify is a **simulation-only** transaction. The source is the
    deterministic placeholder `GAAAA…WHF` (sequence 0), used only for
    simulation; nothing is submitted. It never calls
    `server.getAccount(C…)` and never uses Varial `signTransaction`.
  - Register simulates the call, signs each auth entry with
    `kit.signAuthEntry(…, { contextRuleIds: [0] })` (the wallet's
    default rule), re-simulates with the signed entries, then submits
    `{ func, auth }` through the Testnet relayer and polls RPC for
    confirmation with the same loop as the Varial path.
  - The Varial path is unchanged and is still used whenever
    `walletKind` is `"varial"`.
- **Unproven:** this passkey registry path has not been run against
  Testnet yet (see Status). It is the best-supported composition from
  the kit 0.10.0 README and SDK 17 docs, covered by mocked unit tests
  that assert it never calls `getAccount(C…)` or Varial signing.

## Fee sponsorship — self-hosted relayer (`POST /api/relayer`)

Wallet creation, passkey registry calls, and backup-passkey enrollment
are fee-sponsored through VAULTORA's own relayer, a same-origin Vercel
serverless function (`apps/web/api/relayer.ts` entry point +
`apps/web/api/relayer-handler.ts`, Node runtime,
`maxDuration` 60s in `apps/web/vercel.json`). The browser posts
`{ func, auth }` base64 XDR strings — exactly what the kit's
`RelayerClient.send()` posts — and the function builds the transaction
envelope with the sponsor account as source, simulates it, signs it
with the sponsor keypair, submits it to Soroban Testnet RPC, and
returns `{ success: true, hash }`. The kit then polls RPC itself for
confirmation (10 attempts), so the function returns as soon as the
transaction is accepted (PENDING) and does not wait for confirmation.
The sponsor account sources and pays; the shared deployer never pays
and never signs an envelope.

- **Sponsor account:** `GAOKZ6BA6QS3OSRUQIACV7VNHJHTKFMKAHCQMEEV2JMMY44AFACITZ7I`,
  funded with 10,000 Testnet XLM from Friendbot on 2026-11-27. Its
  secret lives **only** in the `VAULTORA_RELAYER_SPONSOR_SECRET` Vercel
  env var (type `sensitive`, target `preview`, id `nkHKJmV7s1bAQexS`).
  It is read from `process.env` in `api/relayer-handler.ts` and nowhere else,
  never logged, never returned, and never stored in the repo. The
  sponsor holds only Testnet XLM, which has no monetary value.
- **Rotation:** generate a fresh Testnet keypair, fund it via
  Friendbot, verify the balance, then replace the env var value in the
  Vercel dashboard (Project → Settings → Environment Variables) or via
  the Vercel API (`DELETE` the old entry, `POST` the new one — values
  of `sensitive` vars cannot be read back). Redeploy the preview so
  the new value takes effect. The old sponsor account can simply be
  abandoned; it holds only Testnet XLM.
- **Allowlist (the security boundary).** The function classifies the
  decoded host-function XDR before any RPC call
  (`apps/web/api/relayer-validation.ts`) and sponsors **only**:
  1. a `CreateContractV2` whose executable is the known smart-account
     WASM hash (`c514d35e…1004b9e1`) — anyone may deploy their own
     wallet; the sponsor only pays the deployment fee;
  2. an `invokeContract` call to `register_document` on the registry
     contract (`CAQK2Q7I…67KWZQ`);
  3. an `invokeContract` call to `add_signer` or `batch_add_signer`
     **on a contract whose on-chain code hash is the known
     smart-account WASM hash** (verified with an RPC
     `getLedgerEntries` read of the contract instance before
     sponsoring). This is what the mandatory backup-passkey flow
     (`kit.signers.addPasskey` + `kit.signAndSubmitAdmin`) submits, so
     a strict deploy+register-only allowlist would have broken
     recovery; the on-chain code check is what keeps this third case
     from becoming arbitrary-call sponsorship. Auth entries are never
     trusted for allowlisting — the chain re-validates them at
     simulation time, and a failed simulation means nothing is
     submitted and no fee is spent.
  
  Everything else is rejected with a safe (non-echoing) error: token
  transfers, arbitrary contract calls, V1 contract creation,
  Stellar-asset executables, unknown code, malformed XDR, and
  oversized auth arrays. Unit tests cover each rejection
  (`apps/web/src/lib/relayerValidation.test.ts`).
- **Abuse mitigation and residual surface.** The function caps request
  bodies at 64 KB and rate-limits best-effort at 20 requests per IP
  per 10 minutes (per function instance, so approximate under
  concurrency). The honest residual risk: anyone who can reach the
  endpoint can ask the sponsor to pay the fee for a *valid* wallet
  deployment, registry registration, or signer-admin call — including
  deploying many wallets of their own. Each costs the sponsor only a
  few thousandths of a Testnet XLM, and Testnet XLM is free from
  Friendbot and worthless, so the worst case is the sponsor running
  dry and deployments failing closed until it is re-funded or
  rotated. That is acceptable for a Testnet-only preview and is the
  reason the sponsor holds only Testnet funds. This design must be
  re-reviewed before any mainnet use: on mainnet a sponsor like this
  would need authentication, per-user quotas, and a funded budget.
- **Faucet funding is not fee sponsorship.** The faucet gives the
  account XLM to hold; the relayer pays transaction fees. Both remain
  available independently. The faucet (`kit.fundWallet`) does not use
  this endpoint: it funds a temporary account via Friendbot and
  submits through RPC directly.
- Without a relayer, passkey registration fails closed with a clear
  error: a smart account cannot source a transaction itself (it has no
  sequence number), and the shared deployer cannot pay.

## Security limitations

- **Unaudited integration.** The Smart Account Kit, its demo, the
  relayer proxy, and the indexer integration have not received an
  independent third-party security audit. The underlying OpenZeppelin
  Stellar contracts have a separate audit with a different scope, and
  the deployed v0.8.0 artifacts use later source revisions than that
  audit. Treat the integration as experimental and **Testnet-only**.
  Do not hold valuable assets in these accounts.
- No custom cryptography: all signing goes through WebAuthn via the
  kit. No private keys in localStorage. No passkey material is sent to
  a backend.
- A passkey is **not** a vault recovery method. It does not decrypt the
  local vault and does not recover the vault passphrase. VAULTORA's
  independent recovery-guardian design (`docs/RECOVERY_DESIGN.md`) is
  unchanged and still unimplemented.
- **Device loss:** if you lose the only device holding the passkey,
  you lose access to that smart account. Synced passkeys (for example
  Google Password Manager / iCloud Keychain) may work on another device
  signed into the same account, but that is not guaranteed for every
  authenticator and must not be assumed. **Add a second passkey (or a
  delegated signer) to the account before losing the first one** — the
  kit supports adding passkey signers (`kit.signers.addPasskey`), and
  VAULTORA now wires it into the mandatory recovery step (see above).
  The recovery email itself cannot restore a lost-only passkey.
- Multi-device behaviour depends on the authenticator: platform
  passkeys may be single-device, synced passkeys may roam. VAULTORA
  does not claim a passkey works on every device.
- The shared default deployer is public and shared across integrators;
  never fund it, and never use it as a fee source.

## Existing Varial support

- Preserved unchanged: `connectWallet` / `disconnectWallet` in
  `apps/web/src/lib/wallet.ts`, the Varial branch of
  `invokeDocumentContract`, and the existing Varial unit tests.
- The wallet menu offers Varial as "Connect existing Stellar wallet".
  No other provider is listed, because no other provider has a verified
  integration in this codebase.

## Environment variables

See `apps/web/.env.example`. The only new variables are the
`VITE_PASSKEY_*` overrides, `VITE_RELAYER_URL`, and
`VITE_PASSKEY_SESSION_EXPIRY_MS`. None of them is a secret. The
registry contract id (`VITE_STELLAR_CONTRACT_ID`) is still required
for on-chain actions; leave it blank and registry actions stay
disabled.

## Verification

Run from the repository root:

```sh
pnpm run web:check   # typecheck + tests + production build, apps/web
```

Unit tests (mocked kit / mocked RPC) cover: passkey create, connect,
silent restore, disconnect, faucet success/failure, balance read,
error mapping (cancellation, unsupported browser, ambiguous accounts),
wallet-menu behaviour, and registry branching (the passkey path must
not call `getAccount(C…)` or Varial `signTransaction`). The mandatory
email recovery step is covered too: email validation, the recovery
link/body/mailto text (contract address + no-restore warning), the
localStorage record, backup-passkey success/failure, Continue disabled
before recovery, the modal not closing in the recovery stage, a
returning user without recovery being sent to recovery on restore, and
a returning user with completed recovery not being forced there. The
existing Varial tests still pass. The relayer allowlist is covered too:
deployment of the known WASM hash is accepted, unknown WASM / V1
creation / Stellar-asset executables / token transfers / arbitrary
calls are rejected, `add_signer` is classified as wallet-admin (with
the on-chain WASM check enforced by the handler), malformed XDR and
bad auth are rejected, and the handler returns clean `{success:false}`
shapes for 405/400/503/429 without touching RPC. Total: 106 tests,
7 files.

Live endpoint checks (preview): PARTIAL, 2026-11-28. The first real
browser attempt reached the relayer and came back **HTTP 500 with no
JSON body** ("Relayer request failed with status 500"). The handler's
own code paths never return 500 (they return 400/429/502/503 with
`{success:false}`), and Vercel's runtime-logs API returned only build
events, so the failure happened outside the handler — at module load
or in the response helpers. The handler code itself is proven: the
exact kit payload (synthetic P-256 passkey, shared deployer) run
through the local handler deployed a real smart account on Testnet
twice (tx `60ce5ec6…e3314a`, ledger 5961664; tx `f2ec536d…02dfc6`).
Fix shipped: `api/relayer.ts` is now a thin entry point with no
runtime imports that dynamically imports `api/relayer-handler.ts`
inside a try/catch, and all responses use raw Node methods
(`writeHead`/`end`) with the Express-style helpers only as fallback —
so a load failure now surfaces as a JSON error naming the cause
instead of a bare platform 500. The deliberate rejection probes
(invalid func, token-transfer func) still await a signed-in session:
anonymous probes get 401 from Vercel deployment protection. A real
sponsored deployment from Daud's device still has not succeeded — the
next phone attempt is the test.

Note: in this VM, `pnpm install` hits an `EPERM: fchown` error when
writing the lockfile (overlay filesystem); the lockfile was generated
with `pnpm install --lockfile-only` in a copy under `/tmp` and copied
back, and `smart-account-kit@0.10.0` is installed in `node_modules`.
If a fresh checkout fails the same way, generate the lockfile that way
or run the checks from a copy outside the overlay.

## Manual test procedure (real device required)

Automated tests cannot simulate device biometrics. Do not claim
Android works until this has been run on a real device.

### Desktop (Chrome or Edge, HTTPS)

1. `pnpm run web:dev`, open the app over HTTPS (or `localhost`).
2. Unlock the vault, open the wallet menu → "Create wallet with
   passkey". Approve the passkey prompt.
3. Record: the actual contract address shown, the deployment
   transaction hash, and whether the success screen appeared only
   after confirmation.
4. Click "Request Testnet XLM". Record the faucet result and the
   balance shown afterwards.
5. Reload the page, unlock the vault, and confirm the wallet restores
   silently without a prompt.
6. Upload a document, register its fingerprint, and confirm the
   transaction on Stellar Expert. Then verify the same document.
7. Disconnect from the wallet menu, then "Connect with passkey" and
   approve the prompt. Confirm the same address returns (no new
   wallet is created).
8. Connect Varial and confirm the old flow still works, then
   disconnect.

### Mandatory email recovery (desktop or Android, real device)

1. Create a passkey wallet as above. Instead of the success screen,
   the "Back up your wallet — required" step must appear.
2. Confirm "Continue to VAULTORA" is disabled, the close button is
   disabled, and pressing Escape does not close the modal.
3. Enter an invalid email and confirm it is rejected; enter a valid
   one and click "Email my recovery details". Confirm your mail app
   opens with the wallet address, the recovery link, and the warning
   that email alone cannot restore the wallet. VAULTORA sends nothing
   itself — check the mail app, not a server log.
4. Click "I've sent / saved my recovery email". Confirm "Continue to
   VAULTORA" becomes enabled and the success screen shows the recovery
   email.
5. Go back through the recovery step and click "Add a backup passkey
   (recommended)". Approve the passkey prompt on a second device and
   confirm the backup is recorded (wallet menu and Settings show
   "Backup passkey added").
6. Reload, unlock the vault, and connect with the *backup* passkey.
   Confirm the same contract address returns.
7. Reload again with the recovery record cleared (clear site data for
   the recovery key only) and confirm the returning user is sent back
   to the recovery step on restore.
8. Confirm Varial connect never shows the recovery step.

### Android Chrome (real device, HTTPS)

1. Deploy a preview (do not deploy to production) or expose the dev
   server over HTTPS with a valid certificate.
2. On the device, open VAULTORA in Chrome, unlock the vault, and run
   steps 2–7 above using fingerprint / screen lock.
3. Record: device model, Android version, Chrome version, whether the
   passkey prompt appeared, the contract address, the deployment and
   registration transaction hashes, the funded balance, and any error
   text. If the prompt does not appear, record the exact browser
   message instead of working around it.
4. Test cancellation: start creation, dismiss the passkey prompt, and
   confirm the app reports cancellation and creates nothing.
5. Test an unsupported browser (for example an in-app WebView) and
   confirm the app explains passkeys are unavailable and offers the
   existing-wallet option instead.
