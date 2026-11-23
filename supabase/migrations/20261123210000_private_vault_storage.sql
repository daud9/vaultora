-- VAULTORA encrypted-object storage schema for the optional browser sync client.
-- This migration is staged in the repository and has not been applied to a live project.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'vaultora-ciphertext',
  'vaultora-ciphertext',
  false,
  26214416,
  array['application/octet-stream']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.vaultora_documents (
  id uuid not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  object_path text not null unique,
  schema_version smallint not null default 1 check (schema_version > 0),
  file_nonce text not null,
  metadata_ciphertext text not null,
  metadata_nonce text not null,
  wrapped_key text not null,
  wrap_nonce text not null,
  kdf_salt text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  constraint vaultora_object_path_owner check (
    object_path = owner_id::text || '/' || id::text || '.enc'
  )
);

alter table public.vaultora_documents enable row level security;
revoke all on table public.vaultora_documents from anon, authenticated;
grant select, insert, update, delete on table public.vaultora_documents to authenticated;

drop policy if exists "vaultora users read own encrypted rows" on public.vaultora_documents;
create policy "vaultora users read own encrypted rows"
on public.vaultora_documents for select to authenticated
using (owner_id = (select auth.uid()));

drop policy if exists "vaultora users insert own encrypted rows" on public.vaultora_documents;
create policy "vaultora users insert own encrypted rows"
on public.vaultora_documents for insert to authenticated
with check (owner_id = (select auth.uid()));

drop policy if exists "vaultora users update own encrypted rows" on public.vaultora_documents;
create policy "vaultora users update own encrypted rows"
on public.vaultora_documents for update to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

drop policy if exists "vaultora users delete own encrypted rows" on public.vaultora_documents;
create policy "vaultora users delete own encrypted rows"
on public.vaultora_documents for delete to authenticated
using (owner_id = (select auth.uid()));

create table if not exists public.vaultora_document_tombstones (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null,
  deleted_at timestamptz not null default now(),
  primary key (owner_id, id)
);

alter table public.vaultora_document_tombstones enable row level security;
revoke all on table public.vaultora_document_tombstones from anon, authenticated;
grant select, insert, update, delete on table public.vaultora_document_tombstones to authenticated;

drop policy if exists "vaultora users read own tombstones" on public.vaultora_document_tombstones;
create policy "vaultora users read own tombstones"
on public.vaultora_document_tombstones for select to authenticated
using (owner_id = (select auth.uid()));

drop policy if exists "vaultora users insert own tombstones" on public.vaultora_document_tombstones;
create policy "vaultora users insert own tombstones"
on public.vaultora_document_tombstones for insert to authenticated
with check (owner_id = (select auth.uid()));

drop policy if exists "vaultora users update own tombstones" on public.vaultora_document_tombstones;
create policy "vaultora users update own tombstones"
on public.vaultora_document_tombstones for update to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

drop policy if exists "vaultora users delete own tombstones" on public.vaultora_document_tombstones;
create policy "vaultora users delete own tombstones"
on public.vaultora_document_tombstones for delete to authenticated
using (owner_id = (select auth.uid()));

drop policy if exists "vaultora users read own ciphertext objects" on storage.objects;
create policy "vaultora users read own ciphertext objects"
on storage.objects for select to authenticated
using (
  bucket_id = 'vaultora-ciphertext'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "vaultora users upload own ciphertext objects" on storage.objects;
create policy "vaultora users upload own ciphertext objects"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'vaultora-ciphertext'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "vaultora users update own ciphertext objects" on storage.objects;
create policy "vaultora users update own ciphertext objects"
on storage.objects for update to authenticated
using (
  bucket_id = 'vaultora-ciphertext'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
)
with check (
  bucket_id = 'vaultora-ciphertext'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "vaultora users delete own ciphertext objects" on storage.objects;
create policy "vaultora users delete own ciphertext objects"
on storage.objects for delete to authenticated
using (
  bucket_id = 'vaultora-ciphertext'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);
