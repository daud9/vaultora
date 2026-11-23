# Vault storage and cloud setup

## What works without cloud setup

The encrypted browser vault, project spaces, saved links, and activity records work locally in IndexedDB. If the two Supabase variables are absent, the app labels cloud sync as not configured and keeps device-local use available. No project or paid resource is created by this repository.

The client now includes passwordless email-link sign-in, encrypted-document sync and restore, and deletion markers. Sync is manual and covers documents only. It does not sync project spaces, saved links, or activity. The original file bytes and document details are encrypted in the browser before upload. The vault passphrase is used locally and is never sent to Supabase. Supabase account access identifies the storage owner but cannot decrypt the vault.

The current conflict rule skips an identical encrypted envelope. When document metadata differs, the later timestamp wins; equal timestamps keep the cloud copy, and an invalid timestamp stops sync rather than choosing a copy. Device clock differences can affect that choice. Documents are otherwise immutable in the app: editing details creates a new encrypted metadata envelope, while adding a document creates a new random ID. A sync can partially complete before a network error; retrying is safe, and the app reports an error instead of a success message.

## Supabase layout

The migration file is `supabase/migrations/20261123210000_private_vault_storage.sql`. It creates the private `vaultora-ciphertext` bucket, the `public.vaultora_documents` table, and owner-scoped deletion tombstones. The object path is `<authenticated-user-id>/<random-document-id>.enc`. Storage contains encrypted file bytes; the table contains encrypted metadata, nonce values, the wrapped document key, and the KDF salt. Row Level Security (RLS) and Storage policies restrict access to the authenticated user's own records and first path segment.

The owner reports that the migration completed successfully in the current project's SQL Editor and that the Auth Site URL and production/local redirects were saved. The public Auth endpoint confirms Email Auth is enabled, but it does not expose the URL settings for independent verification. Anonymous requests to both tables now return SQLSTATE `42501`, consistent with the tables existing without anonymous table privileges; this does not verify authenticated RLS policies. The private bucket metadata could not be confirmed through the publishable-key endpoint. Confirm the bucket is private and its policies exist in the Supabase dashboard. Authenticated Storage access, sync, restore, email delivery, and cross-account isolation have not been tested. Do not describe cloud backup as operational until these tests pass.

## Owner setup

1. Select an existing Supabase project or create one only with the owner's approval. Do not create billable resources without approval.
2. Apply `supabase/migrations/20261123210000_private_vault_storage.sql` through the Supabase SQL editor or the project's migration workflow. Confirm that `vaultora-ciphertext` is private, RLS is enabled for both `vaultora_documents` and `vaultora_document_tombstones`, and the listed owner policies exist for both tables and `storage.objects`.
3. Enable the Email Auth provider and verify email-link delivery. In Auth URL configuration, add the exact redirect URLs the app will use: `https://vaultora-flax.vercel.app/`, `http://localhost:5173/` for local testing, and the exact preview URL when available. Avoid broad preview wildcards unless their risk is understood. The client redirects to the current origin and pathname.
4. Provide these browser-safe values through the app's runtime/build environment:
   - `VITE_SUPABASE_URL`: the selected project's HTTPS URL.
   - `VITE_SUPABASE_PUBLISHABLE_KEY`: the project's publishable key. A legacy anon key is supported by Supabase, but the publishable key is preferred.
5. Never provide a `service_role` or secret key to the browser, repository, `.env` file, or Vercel client variables. The browser client does not need one. Do not commit `.env.local`.

The Vite example file is `apps/web/.env.example`. For local development, copy it to `apps/web/.env.local`, fill only the two browser-safe Supabase values, and restart the dev server. Add them to Vercel only after Vercel project access is available and the target redirect is configured.

## Required verification before enabling cloud sync

Use two separate authenticated test accounts. With account A, create a local vault, sync a test document, and restore it in a clean browser profile using the same vault passphrase. Confirm a wrong passphrase cannot restore it. With account B, confirm the app cannot list account A's rows, download account A's object path, overwrite it, or delete it. Test direct database and Storage requests under each user's own session as well as the normal UI. Confirm that deletion markers remove a document from the other device on its next sync. Do not use real confidential files for these tests.

After tests, verify the production and preview deployments use the same intended project configuration and redirect allowlist. Until these tests pass, keep local mode available and treat the cloud client as prepared, not as an active backup service.

## References

- Supabase [email OTP sign-in](https://supabase.com/docs/reference/javascript/auth-signinwithotp) and [auth state change events](https://supabase.com/docs/reference/javascript/auth-onauthstatechange) describe the passwordless account flow used by the client.
- Supabase [Storage upload](https://supabase.com/docs/reference/javascript/file-buckets-upload) and [download](https://supabase.com/docs/reference/javascript/file-buckets-download) document the object operations used for encrypted bytes.
- Supabase [database security](https://supabase.com/docs/guides/database/secure-data) and [Storage access control](https://supabase.com/docs/guides/storage/security/access-control) explain RLS and private-object policies. These references do not establish that this project's policies are configured correctly or working under authenticated accounts.
