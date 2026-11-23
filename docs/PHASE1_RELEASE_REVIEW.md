# VAULTORA Phase 1 release review

**Status: review preview approved, not released.** The Phase 1 application changes and manual encrypted-document sync are prepared for an isolated review-branch preview. The owner reports applying the Supabase migration and configuring Auth URLs, but authenticated cloud operations remain unverified. Device-local operation remains available. Production deployment, production alias changes, and promotion are outside this preview's scope.

## What changed

The app retains its VaultRail navigation, responsive dashboard, encrypted device-local documents, project spaces, saved links, activity, wallet connection, and Stellar Testnet registry flows. Local encryption uses PBKDF2-SHA-256 with 600,000 iterations and AES-256-GCM, with a random data key for each document.

The browser now includes optional manual Supabase email-link sign-in, encrypted document sync, cloud restore, and deletion markers. Only encrypted document bytes and encrypted details are uploaded. The passphrase is never sent to Supabase. Project spaces, saved links, and activity remain local. The client uses only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`; neither is configured in the existing Vercel project. The storage migration defines a private bucket, owner-scoped document rows, tombstones, RLS, and Storage policies.

Sync skips identical encrypted records and resolves changed metadata with last-write-wins timestamps; ties keep the cloud copy. Invalid timestamps stop sync. Device clock differences can affect conflict outcomes. A network failure may follow partial progress; the operation reports failure and can be retried. Guardian recovery is still not implemented.

## Changed and added files

- Application and styles: `apps/web/src/App.tsx`, `apps/web/src/styles.css`, `apps/web/src/vite-env.d.ts`
- Encrypted local vault and tests: `apps/web/src/lib/localVault.ts`, `apps/web/src/lib/localVault.test.ts`
- Supabase client and tests: `apps/web/src/lib/supabaseVault.ts`, `apps/web/src/lib/supabaseVault.test.ts`
- Updated application tests: `apps/web/src/App.test.tsx`, `apps/web/src/lib/core.test.ts`
- Existing Stellar code updates: `apps/web/src/lib/soroban.ts`, `apps/web/src/lib/sorobanConfig.ts`
- Dependency and browser-safe configuration: `apps/web/package.json`, `pnpm-lock.yaml`, `apps/web/.env.example`
- Storage migration: `supabase/migrations/20261123210000_private_vault_storage.sql` (owner reports applied; authenticated policies not verified)
- Documentation: `README.md`, `SECURITY.md`, `docs/VAULT_STORAGE_SETUP.md`, this review

The new dependency is `@supabase/supabase-js` 2.119.2.

## Verification results

- `pnpm run web:check`: passed TypeScript, all 41 web tests across 4 files, and the production Vite build. Tests cover local encryption and restore, tampering and wrong passphrases, deletion markers, sync encoding and conflict rules, and read/upload/download failure reporting.
- `pnpm install --frozen-lockfile`: passed; the workspace lockfile is up to date.
- `cargo fmt --all -- --check`: passed.
- `cargo test --workspace`: passed, 9 contract tests.
- `cargo clippy --workspace --all-targets -- -D warnings`: passed.
- `stellar contract build --locked --package document-registry`: passed. Wasm hash: `e24ae1b27c492b34894d2e8832ee619868877641ce64ab7f0a8dea4737500f51`.
- Headless Chromium check at 360×800: setup, overview, locked access, and Settings/cloud panel rendered with no horizontal overflow. Cloud panel showed the unconfigured state while local setup remained available.
- `pnpm exec vitest run src/lib/supabaseVault.test.ts`: passed, 10 mocked tests for encrypted-payload encoding, conflict rules, malformed rows, and cloud read/upload/download failures. No live writes were made.
- The production build emitted a non-fatal chunk warning: app chunk 552.38 kB minified and Soroban chunk 556.91 kB minified, each above Vite's 500 kB warning threshold.
- Neither the root project nor `apps/web` defines a lint script, so no separate lint run was available.

These are local tests and rendering checks, plus the read-only Supabase checks summarized below. They do not establish successful Auth sign-in, authenticated RLS or Storage policy behavior, cross-account isolation, live Stellar behavior, or deployment of the Phase 1 changes.

## Configuration and release blockers

The owner supplied a Supabase project URL and browser-safe publishable key. They were used only for read-only API checks; the key was not written to the repository or Vercel. The owner reports the SQL Editor migration completed successfully and the Auth Site URL and production/local redirects were saved. Supabase Auth health and settings returned HTTP 200, and Email Auth is enabled. The public Auth settings response does not expose the Site URL or redirect allowlist, so those values could not be independently re-read through the publishable-key API.

Read-only requests for both `public.vaultora_documents` and `public.vaultora_document_tombstones` now return HTTP 401 with SQLSTATE `42501`, rather than the earlier missing-relation response. This is consistent with the tables existing while the anonymous role lacks table privileges; it does not test authenticated RLS policies. The Storage bucket metadata endpoint returned `NoSuchBucket` for the publishable-key request, which did not confirm whether the private bucket exists or is private. No Auth session or cloud object operations were used, so authenticated policies, email delivery, sync/restore, and cross-account isolation remain unverified. The exact setup and owner test steps are in [`VAULT_STORAGE_SETUP.md`](VAULT_STORAGE_SETUP.md). Never use a Supabase service-role or secret key in the browser.

Read-only Vercel inspection is complete. The existing Vercel Hobby team has a Git-linked `vaultora` Vite project (`prj_MBGoutVBIjczqeEICwKgvB54alfR`) connected to `daud9/vaultora`. The current production deployment is READY at `vaultora-4hzbj4fef-sheik-s-projects1.vercel.app`, sourced from `main` at baseline commit `5a74555f63190b97a2b5313cbb585475652a1f3b`. Its assigned aliases include the production hostname `vaultora-flax.vercel.app`; that domain is verified. The project has SSO protection enabled for non-custom deployment URLs.

The environment-variable metadata lists `VITE_STELLAR_CONTRACT_ID` for Production and Preview. No Supabase variables (`VITE_SUPABASE_URL` or `VITE_SUPABASE_PUBLISHABLE_KEY`) are configured. For the approved sign-in test, add those browser-safe values only as branch-scoped Preview settings after the exact preview redirect is approved; do not add them to Production. The existing Stellar variable is browser-visible configuration, not a secret; verify the contract and method names before relying on live write operations. No environment values are recorded here.

The remaining setup and verification for cloud sync is:

- Confirm in the Supabase dashboard that the private `vaultora-ciphertext` bucket and its owner-only policies exist; the publishable-key metadata request could not verify them.
- Verify email-link delivery and complete an authenticated test sign-in. No sign-in email was sent and no Auth account was created during these checks.
- For the approved sign-in test, configure the browser-safe project URL and publishable key only as branch-scoped Preview values after the exact preview redirect is confirmed. Then test only the safe sign-in and sync path; do not add these values to Production or put a service-role key in the browser.

## Deployment and rollback plan

The current production baseline for any future, separately authorized release is deployment `dpl_Bu8Yt6vy3fCx5PrGU5Se1EFPG7YN` at immutable URL `vaultora-4hzbj4fef-sheik-s-projects1.vercel.app`, on commit `5a74555f63190b97a2b5313cbb585475652a1f3b`. The deployment history marks it as a rollback candidate, and its current production aliases were confirmed. An older production deployment, `dpl_GG9KENiuuw2TmW2JfR2YUTNxnVQW`, is also READY and was marked as a rollback candidate in the history.

The dedicated rollback-candidate filter returned a Vercel 403. The documented CLI fallback was attempted, but no Vercel CLI credentials were available at that time. Therefore, the current production baseline and its alias mapping are recorded, but the rollback action itself has not been exercised. This task is limited to an isolated review-branch preview; no Phase 1 production deployment or production alias change is authorized.

For the approved preview, check local vault setup and unlock, document save/read/delete, project spaces, saved links, lock behavior, the cloud panel, responsive navigation, and the preserved wallet and Testnet registry paths. Production promotion requires separate explicit authorization and verified rollback controls. If a future authorized production release fails its smoke checks, restore the previous deployment through Vercel and verify the public URL. Do not delete the previous deployment or stored data.

## Current repository state

- Review branch: `review/phase1-vault-implementation`, based on the original repository baseline
- Base commit: `5a74555f63190b97a2b5313cbb585475652a1f3b`
- No changes to `main` or Production are authorized or applied. No other repositories or project files were changed. No billable resources or credentials were created.
