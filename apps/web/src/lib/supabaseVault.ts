import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  exportEncryptedDocument,
  deleteDocument,
  getVaultKdfSalt,
  importEncryptedDocument,
  listDocumentTombstones,
  listDocuments,
  validatePassphraseForEncryptedDocument,
  type EncryptedDocumentPayload,
  type VaultDocument,
  type VaultSession,
} from "./localVault";

const BUCKET = "vaultora-ciphertext";
const DOCUMENT_TABLE = "vaultora_documents";
const TOMBSTONE_TABLE = "vaultora_document_tombstones";
const PAGE_SIZE = 500;
const MAX_CIPHERTEXT_BYTES = 25 * 1024 * 1024 + 16;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface CloudDocumentRow {
  id: string;
  owner_id: string;
  object_path: string;
  schema_version: number;
  file_nonce: string;
  metadata_ciphertext: string;
  metadata_nonce: string;
  wrapped_key: string;
  wrap_nonce: string;
  kdf_salt: string;
  created_at: string;
  updated_at: string;
}

export interface CloudVaultInfo {
  documentCount: number;
  vaultSalt: string | null;
}

export interface CloudSyncResult {
  uploaded: number;
  downloaded: number;
  deleted: number;
}

export type CloudConflictAction = "unchanged" | "upload-local" | "download-cloud";

export function resolveCloudConflict(
  localUpdatedAt: string,
  cloudUpdatedAt: string,
  encryptedEnvelopeMatches: boolean,
): CloudConflictAction {
  if (encryptedEnvelopeMatches) return "unchanged";
  const localTime = Date.parse(localUpdatedAt);
  const cloudTime = Date.parse(cloudUpdatedAt);
  if (!Number.isFinite(localTime) || !Number.isFinite(cloudTime)) {
    throw new Error("Document sync encountered an invalid version timestamp.");
  }
  return localTime > cloudTime ? "upload-local" : "download-cloud";
}

interface CloudTombstoneRow {
  id: string;
  owner_id: string;
  deleted_at: string;
}

let client: SupabaseClient | null = null;

function settings(): { url: string; publishableKey: string } | null {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !publishableKey) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") return null;
  } catch {
    return null;
  }
  return { url, publishableKey };
}

export function isSupabaseConfigured(): boolean {
  return settings() !== null;
}

function getClient(): SupabaseClient {
  const config = settings();
  if (!config) throw new Error("Cloud sync is not configured for this deployment.");
  if (!client) {
    client = createClient(config.url, config.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }
  return client;
}

export function subscribeToCloudAuth(onAccount: (email: string | null) => void): () => void {
  if (!isSupabaseConfigured()) return () => undefined;
  const authClient = getClient();
  const { data } = authClient.auth.onAuthStateChange((_event, session) => {
    onAccount(session?.user.email ?? null);
  });
  void authClient.auth.getSession().then(({ data: result }) => {
    onAccount(result.session?.user.email ?? null);
  }).catch(() => onAccount(null));
  return () => data.subscription.unsubscribe();
}

export async function requestCloudSignInLink(email: string): Promise<void> {
  const normalizedEmail = email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new Error("Enter a valid email address for cloud sign-in.");
  }
  const redirectTo = `${window.location.origin}${window.location.pathname}`;
  const { error } = await getClient().auth.signInWithOtp({
    email: normalizedEmail,
    options: { emailRedirectTo: redirectTo, shouldCreateUser: true },
  });
  if (error) throw new Error("The sign-in email could not be sent. Check the Supabase Auth email setup and try again.");
}

export async function signOutCloudAccount(): Promise<void> {
  const { error } = await getClient().auth.signOut();
  if (error) throw new Error("The cloud account could not be signed out.");
}

async function authenticatedUser(): Promise<{ id: string; email: string | null }> {
  const { data, error } = await getClient().auth.getUser();
  if (error || !data.user) throw new Error("Sign in to the cloud account before using encrypted document sync.");
  if (!UUID_PATTERN.test(data.user.id)) throw new Error("The authenticated cloud account has an invalid user identifier.");
  return { id: data.user.id, email: data.user.email ?? null };
}

export function encodeCloudBytes(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  }
  return btoa(binary);
}

export function decodeCloudBytes(value: string): ArrayBuffer {
  if (!value || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error("A cloud vault record contains an invalid encrypted value.");
  }
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  if (encodeCloudBytes(bytes) !== value) throw new Error("A cloud vault record contains an invalid encrypted value.");
  return bytes.buffer;
}

export function cloudObjectPath(ownerId: string, documentId: string): string {
  if (!UUID_PATTERN.test(ownerId) || !UUID_PATTERN.test(documentId)) throw new Error("The cloud vault record has an invalid identifier.");
  return `${ownerId}/${documentId}.enc`;
}

async function fetchRows<T>(table: string): Promise<T[]> {
  const supabase = getClient();
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase.from(table).select("*").order("id", { ascending: true }).range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error("Cloud vault records could not be read. Check the migration, RLS policies, and network connection.");
    const batch = (data ?? []) as unknown as T[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return rows;
  }
}

function validateCloudRows(rows: CloudDocumentRow[], ownerId: string): CloudDocumentRow[] {
  for (const row of rows) {
    if (!row || row.owner_id !== ownerId || typeof row.id !== "string" || !UUID_PATTERN.test(row.id) || row.schema_version !== 1
      || typeof row.object_path !== "string" || row.object_path !== cloudObjectPath(ownerId, row.id)
      || typeof row.updated_at !== "string" || !Number.isFinite(Date.parse(row.updated_at))
      || typeof row.file_nonce !== "string" || typeof row.metadata_nonce !== "string" || typeof row.wrap_nonce !== "string"
      || typeof row.kdf_salt !== "string" || typeof row.metadata_ciphertext !== "string" || typeof row.wrapped_key !== "string"
      || row.file_nonce.length !== 16 || row.metadata_nonce.length !== 16 || row.wrap_nonce.length !== 16
      || row.kdf_salt.length !== 24 || row.metadata_ciphertext.length < 24 || row.metadata_ciphertext.length > 87_384
      || row.wrapped_key.length < 24 || row.wrapped_key.length > 172) {
      throw new Error("A cloud vault record did not match the expected owner-isolated schema.");
    }
    const salt = decodeCloudBytes(row.kdf_salt);
    if (salt.byteLength !== 16) throw new Error("A cloud vault record has an invalid key-derivation salt.");
    for (const value of [row.file_nonce, row.metadata_nonce, row.metadata_ciphertext, row.wrapped_key, row.wrap_nonce]) decodeCloudBytes(value);
  }
  if (rows.length && rows.some((row) => row.kdf_salt !== rows[0].kdf_salt)) {
    throw new Error("This cloud account contains documents from more than one vault key. Sync is paused to avoid mixing vaults.");
  }
  return rows;
}

async function loadCloudState(ownerId: string): Promise<{ rows: CloudDocumentRow[]; tombstones: CloudTombstoneRow[] }> {
  const [rawRows, rawTombstones] = await Promise.all([
    fetchRows<CloudDocumentRow>(DOCUMENT_TABLE),
    fetchRows<CloudTombstoneRow>(TOMBSTONE_TABLE),
  ]);
  const rows = validateCloudRows(rawRows, ownerId);
  for (const tombstone of rawTombstones) {
    if (!tombstone || typeof tombstone.owner_id !== "string" || tombstone.owner_id !== ownerId
      || typeof tombstone.id !== "string" || !UUID_PATTERN.test(tombstone.id)) {
      throw new Error("A cloud vault deletion record did not match the expected owner-isolated schema.");
    }
  }
  return { rows, tombstones: rawTombstones };
}

export async function inspectCloudVault(): Promise<CloudVaultInfo> {
  const user = await authenticatedUser();
  const { rows } = await loadCloudState(user.id);
  return { documentCount: rows.length, vaultSalt: rows[0]?.kdf_salt ?? null };
}

function payloadFromRow(row: CloudDocumentRow, fileCiphertext: ArrayBuffer = new ArrayBuffer(0)): EncryptedDocumentPayload {
  return {
    id: row.id,
    fileNonce: decodeCloudBytes(row.file_nonce),
    fileCiphertext,
    metadataNonce: decodeCloudBytes(row.metadata_nonce),
    metadataCiphertext: decodeCloudBytes(row.metadata_ciphertext),
    wrappedKeyNonce: decodeCloudBytes(row.wrap_nonce),
    wrappedKeyCiphertext: decodeCloudBytes(row.wrapped_key),
    kdfSalt: decodeCloudBytes(row.kdf_salt),
  };
}

export async function validateCloudVaultPassphrase(passphrase: string): Promise<string> {
  const user = await authenticatedUser();
  const { rows } = await loadCloudState(user.id);
  const first = rows[0];
  if (!first) throw new Error("This cloud account has no encrypted documents to restore yet.");
  await validatePassphraseForEncryptedDocument(passphrase, payloadFromRow(first));
  return first.kdf_salt;
}

async function upsertLocalDocument(ownerId: string, document: VaultDocument, session: VaultSession): Promise<void> {
  const supabase = getClient();
  const payload = await exportEncryptedDocument(session, document.id);
  const objectPath = cloudObjectPath(ownerId, payload.id);
  const now = new Date().toISOString();
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(objectPath, new Blob([payload.fileCiphertext], { type: "application/octet-stream" }), {
    cacheControl: "0",
    contentType: "application/octet-stream",
    upsert: true,
  });
  if (uploadError) throw new Error("Encrypted file bytes could not be uploaded. Check the private Storage policies and connection.");
  const row = {
    id: payload.id,
    owner_id: ownerId,
    object_path: objectPath,
    schema_version: 1,
    file_nonce: encodeCloudBytes(payload.fileNonce),
    metadata_ciphertext: encodeCloudBytes(payload.metadataCiphertext),
    metadata_nonce: encodeCloudBytes(payload.metadataNonce),
    wrapped_key: encodeCloudBytes(payload.wrappedKeyCiphertext),
    wrap_nonce: encodeCloudBytes(payload.wrappedKeyNonce),
    kdf_salt: encodeCloudBytes(payload.kdfSalt),
    created_at: document.metadata.createdAt,
    updated_at: now,
  };
  const { error: rowError } = await supabase.from(DOCUMENT_TABLE).upsert(row, { onConflict: "owner_id,id" });
  if (rowError) throw new Error("Encrypted document details could not be synced. Check the private table policies and connection.");
  const { error: tombstoneError } = await supabase.from(TOMBSTONE_TABLE).delete().eq("owner_id", ownerId).eq("id", payload.id);
  if (tombstoneError) throw new Error("The encrypted document synced, but its cloud deletion marker could not be cleared.");
}

async function deleteCloudDocument(ownerId: string, row: CloudDocumentRow): Promise<void> {
  const supabase = getClient();
  if (row.object_path !== cloudObjectPath(ownerId, row.id)) throw new Error("A cloud file path failed its ownership check.");
  const { error: storageError } = await supabase.storage.from(BUCKET).remove([row.object_path]);
  if (storageError) throw new Error("A deleted document's encrypted cloud object could not be removed.");
  const { error: rowError } = await supabase.from(DOCUMENT_TABLE).delete().eq("owner_id", ownerId).eq("id", row.id);
  if (rowError) throw new Error("A deleted document's cloud record could not be removed.");
}

async function markCloudDeleted(ownerId: string, id: string): Promise<void> {
  const { error } = await getClient().from(TOMBSTONE_TABLE).upsert({ owner_id: ownerId, id, deleted_at: new Date().toISOString() }, { onConflict: "owner_id,id" });
  if (error) throw new Error("A document deletion could not be recorded for other devices.");
}

async function downloadCloudDocument(ownerId: string, row: CloudDocumentRow, session: VaultSession): Promise<void> {
  const supabase = getClient();
  const expectedPath = cloudObjectPath(ownerId, row.id);
  if (row.object_path !== expectedPath) throw new Error("A cloud file path failed its ownership check.");
  const { data, error } = await supabase.storage.from(BUCKET).download(expectedPath);
  if (error || !data) throw new Error("An encrypted cloud document could not be downloaded.");
  if (data.size <= 16 || data.size > MAX_CIPHERTEXT_BYTES) throw new Error("An encrypted cloud document has an invalid size.");
  const payload = payloadFromRow(row, await data.arrayBuffer());
  await importEncryptedDocument(session, payload);
}

export async function synchronizeEncryptedDocuments(session: VaultSession): Promise<CloudSyncResult> {
  const user = await authenticatedUser();
  const localSalt = encodeCloudBytes(await getVaultKdfSalt(session));
  const initialCloudState = await loadCloudState(user.id);
  if (initialCloudState.rows.length && initialCloudState.rows[0].kdf_salt !== localSalt) {
    throw new Error("The cloud documents use a different vault passphrase salt. Restore this vault from the cloud before syncing this device.");
  }

  const localTombstones = new Set(await listDocumentTombstones(session));
  const remoteTombstones = new Set(initialCloudState.tombstones.map((row) => row.id));
  const remoteById = new Map(initialCloudState.rows.map((row) => [row.id, row]));
  let deleted = 0;

  for (const id of localTombstones) {
    if (!remoteTombstones.has(id)) await markCloudDeleted(user.id, id);
  }
  const deletedIds = new Set([...localTombstones, ...remoteTombstones]);
  for (const id of deletedIds) {
    const row = remoteById.get(id);
    if (row) {
      await deleteCloudDocument(user.id, row);
      remoteById.delete(id);
      deleted += 1;
    }
  }
  const localDocuments = await listDocuments(session);
  const localById = new Map(localDocuments.map((document) => [document.id, document]));
  for (const id of remoteTombstones) {
    if (localById.has(id)) {
      await deleteDocument(session, id);
      localById.delete(id);
    }
  }

  let uploaded = 0;
  let downloaded = 0;
  for (const document of localById.values()) {
    const remote = remoteById.get(document.id);
    if (!remote) {
      await upsertLocalDocument(user.id, document, session);
      uploaded += 1;
      continue;
    }
    const localPayload = await exportEncryptedDocument(session, document.id);
    const localMetadataMatches = encodeCloudBytes(localPayload.metadataNonce) === remote.metadata_nonce
      && encodeCloudBytes(localPayload.metadataCiphertext) === remote.metadata_ciphertext
      && encodeCloudBytes(localPayload.wrappedKeyNonce) === remote.wrap_nonce
      && encodeCloudBytes(localPayload.wrappedKeyCiphertext) === remote.wrapped_key
      && encodeCloudBytes(localPayload.fileNonce) === remote.file_nonce;
    const action = resolveCloudConflict(document.metadata.updatedAt, remote.updated_at, localMetadataMatches);
    if (action === "unchanged") {
      remoteById.delete(document.id);
      continue;
    }
    if (action === "upload-local") {
      await upsertLocalDocument(user.id, document, session);
      uploaded += 1;
    } else {
      await downloadCloudDocument(user.id, remote, session);
      downloaded += 1;
    }
    remoteById.delete(document.id);
  }

  for (const remote of remoteById.values()) {
    if (deletedIds.has(remote.id)) continue;
    await downloadCloudDocument(user.id, remote, session);
    downloaded += 1;
  }
  return { uploaded, downloaded, deleted };
}
