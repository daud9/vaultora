const DATABASE_VERSION = 1;
const DEFAULT_DATABASE_NAME = "vaultora-local-vault";
const SETTINGS_STORE = "vaultSettings";
const DOCUMENT_STORE = "encryptedDocuments";
const COLLECTION_STORE = "encryptedCollections";
const SETTINGS_ID = "vault";
const PBKDF2_ITERATIONS = 600_000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const SESSION_BRAND: unique symbol = Symbol("VaultSession");
const activeSessions = new WeakSet<object>();
const sessionState = new WeakMap<object, { databaseName: string; database: IDBDatabase; key: CryptoKey }>();
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface LocalVaultOptions {
  databaseName?: string;
  vaultSalt?: Uint8Array;
}

export interface VaultSession {
  readonly [SESSION_BRAND]: true;
}

export type VerificationState = "not-registered" | "registered" | "verified" | "failed" | "pending";

export interface VaultDocumentMetadata {
  fileName: string;
  mimeType: string;
  size: number;
  createdAt: string;
  updatedAt: string;
  digest: string;
  starred: boolean;
  workspaceId?: string;
  transactionHash?: string;
  verificationState?: VerificationState;
  ownerAddress?: string;
  network?: string;
  registeredAt?: string;
  verifiedAt?: string;
}

export interface VaultDocument {
  id: string;
  metadata: VaultDocumentMetadata;
}

export interface VaultWorkspace {
  id: string;
  name: string;
  description: string;
  color?: string;
  icon: string;
  createdAt: string;
  updatedAt?: string;
}

export interface VaultSavedLink {
  id: string;
  url: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface VaultActivity {
  type: string;
  at: string;
  entityId: string;
  label: string;
}

export type VaultDocumentPatch = Partial<
  Pick<
    VaultDocumentMetadata,
    "fileName" | "mimeType" | "starred" | "workspaceId" | "transactionHash" | "verificationState" | "ownerAddress" | "network" | "registeredAt" | "verifiedAt"
  >
>;

export type VaultWorkspaceInput = Omit<VaultWorkspace, "id" | "createdAt"> & {
  id?: string;
  createdAt?: string;
};

export type VaultSavedLinkInput = Omit<VaultSavedLink, "id" | "createdAt" | "updatedAt"> & {
  id?: string;
  createdAt?: string;
  updatedAt?: string;
};

interface VaultSettingsRow {
  id: typeof SETTINGS_ID;
  salt: ArrayBuffer;
  verifierNonce: ArrayBuffer;
  verifierCiphertext: ArrayBuffer;
}

interface EncryptedDocumentRow {
  id: string;
  dataNonce: ArrayBuffer;
  dataCiphertext: ArrayBuffer;
  metadataNonce: ArrayBuffer;
  metadataCiphertext: ArrayBuffer;
  wrappedKeyNonce: ArrayBuffer;
  wrappedKeyCiphertext: ArrayBuffer;
}

type CollectionType = "workspace" | "savedLink" | "activity" | "documentTombstone";

interface EncryptedCollectionRow {
  id: string;
  type: CollectionType;
  nonce: ArrayBuffer;
  ciphertext: ArrayBuffer;
}

export interface EncryptedDocumentPayload {
  id: string;
  fileNonce: ArrayBuffer;
  fileCiphertext: ArrayBuffer;
  metadataNonce: ArrayBuffer;
  metadataCiphertext: ArrayBuffer;
  wrappedKeyNonce: ArrayBuffer;
  wrappedKeyCiphertext: ArrayBuffer;
  kdfSalt: ArrayBuffer;
}

export class LocalVaultError extends Error {
  constructor(message: string, name = "LocalVaultError") {
    super(message);
    this.name = name;
  }
}

class ConcurrentDocumentUpdateError extends LocalVaultError {
  constructor() {
    super("The document changed in another vault session. Retrying with the latest version.", "ConcurrentDocumentUpdateError");
  }
}

export class InvalidVaultFileError extends LocalVaultError {
  constructor(message: string) {
    super(message, "InvalidVaultFileError");
  }
}

const MIME_BY_EXTENSION: Record<string, Set<string>> = {
  pdf: new Set(["application/pdf"]),
  docx: new Set(["application/vnd.openxmlformats-officedocument.wordprocessingml.document"]),
  xlsx: new Set(["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]),
  xls: new Set(["application/vnd.ms-excel"]),
  png: new Set(["image/png"]),
  jpg: new Set(["image/jpeg"]),
  jpeg: new Set(["image/jpeg"]),
  txt: new Set(["text/plain"]),
};

function databaseName(options?: LocalVaultOptions): string {
  return options?.databaseName ?? DEFAULT_DATABASE_NAME;
}

function requireCrypto(): Crypto {
  if (!globalThis.crypto?.subtle || typeof globalThis.crypto.getRandomValues !== "function") {
    throw new LocalVaultError("Web Crypto is unavailable in this browser.");
  }
  return globalThis.crypto;
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  requireCrypto().getRandomValues(bytes);
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

function equalBuffers(left: ArrayBuffer, right: ArrayBuffer): boolean {
  if (left.byteLength !== right.byteLength) return false;
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  return a.every((value, index) => value === b[index]);
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function makeId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const value = hex(bytes);
  bytes.fill(0);
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function assertRandomId(id: string): void {
  if (!/^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.test(id)) {
    throw new LocalVaultError("Collection IDs must be random identifiers.");
  }
}

function aad(domain: string, id?: string): ArrayBuffer {
  return encoder.encode(id ? `vaultora:v1:${domain}:${id}` : `vaultora:v1:${domain}`).buffer as ArrayBuffer;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new LocalVaultError("IndexedDB request failed."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new LocalVaultError("IndexedDB transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new LocalVaultError("IndexedDB transaction was aborted."));
  });
}

function openDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = globalThis.indexedDB.open(name, DATABASE_VERSION);
    } catch (error) {
      reject(storageError(error, "Could not open the local vault database."));
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) db.createObjectStore(SETTINGS_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(DOCUMENT_STORE)) db.createObjectStore(DOCUMENT_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(COLLECTION_STORE)) db.createObjectStore(COLLECTION_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(storageError(request.error, "Could not open the local vault database."));
    request.onblocked = () => reject(new LocalVaultError("Opening the local vault was blocked by another database connection."));
  });
}

function storageError(error: unknown, message: string): LocalVaultError {
  const result = new LocalVaultError(message, "LocalVaultStorageError");
  if (error instanceof Error) result.cause = error;
  return result;
}

async function runTransaction<T>(
  database: IDBDatabase,
  stores: string | string[],
  mode: IDBTransactionMode,
  action: (transaction: IDBTransaction) => Promise<T>,
): Promise<T> {
  let transaction: IDBTransaction;
  try {
    transaction = database.transaction(stores, mode);
  } catch (error) {
    throw storageError(error, "Could not start a local vault transaction.");
  }
  const done = transactionDone(transaction);
  try {
    const result = await action(transaction);
    await done;
    return result;
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      // The transaction may already have completed or aborted.
    }
    await done.catch(() => undefined);
    if (error instanceof LocalVaultError) throw error;
    throw storageError(error, "The local vault transaction failed.");
  }
}

async function readSettings(name: string): Promise<VaultSettingsRow | undefined> {
  const database = await openDatabase(name);
  try {
    return await runTransaction(database, SETTINGS_STORE, "readonly", async (transaction) =>
      requestResult(transaction.objectStore(SETTINGS_STORE).get(SETTINGS_ID)) as Promise<VaultSettingsRow | undefined>,
    );
  } finally {
    database.close();
  }
}

async function deriveVaultKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  if (typeof passphrase !== "string" || passphrase.length === 0) {
    throw new LocalVaultError("A non-empty vault passphrase is required.");
  }
  const passphraseBytes = encoder.encode(passphrase);
  const saltBuffer = toArrayBuffer(salt);
  try {
    const passphraseKey = await requireCrypto().subtle.importKey("raw", passphraseBytes.buffer as ArrayBuffer, "PBKDF2", false, ["deriveKey"]);
    return await requireCrypto().subtle.deriveKey(
      { name: "PBKDF2", salt: saltBuffer, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
      passphraseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  } finally {
    passphraseBytes.fill(0);
    new Uint8Array(saltBuffer).fill(0);
  }
}

async function newSession(name: string, key: CryptoKey): Promise<VaultSession> {
  const database = await openDatabase(name);
  const session = { [SESSION_BRAND]: true } as VaultSession;
  activeSessions.add(session);
  sessionState.set(session, { databaseName: name, database, key });
  return session;
}

function assertSession(session: VaultSession): void {
  if (!session || !activeSessions.has(session as object)) {
    throw new LocalVaultError("This vault session is not active. Unlock the vault again.");
  }
}

function sessionContext(session: VaultSession): { databaseName: string; database: IDBDatabase; key: CryptoKey } {
  assertSession(session);
  return sessionState.get(session as object)!;
}

export async function hasLocalVault(options?: LocalVaultOptions): Promise<boolean> {
  return Boolean(await readSettings(databaseName(options)));
}

export async function createVaultSession(passphrase: string, options?: LocalVaultOptions): Promise<VaultSession> {
  if (typeof passphrase !== "string" || passphrase.length < 12) {
    throw new LocalVaultError("The vault passphrase must be at least 12 characters long.");
  }
  const name = databaseName(options);
  if (await hasLocalVault(options)) throw new LocalVaultError("A local vault already exists.");
  const salt = options?.vaultSalt ? new Uint8Array(options.vaultSalt) : randomBytes(16);
  if (salt.byteLength !== 16) {
    salt.fill(0);
    throw new LocalVaultError("The vault key salt must contain exactly 16 bytes.");
  }
  const verifierNonce = randomBytes(12);
  const verifierPlaintext = encoder.encode("vaultora-v1-vault-verifier");
  const verifierBuffer = toArrayBuffer(verifierPlaintext);
  let database: IDBDatabase | undefined;
  let created = false;
  try {
    const key = await deriveVaultKey(passphrase, salt);
    const verifierCiphertext = await requireCrypto().subtle.encrypt(
      { name: "AES-GCM", iv: toArrayBuffer(verifierNonce), additionalData: aad("vault-verifier") },
      key,
      verifierBuffer,
    );
    database = await openDatabase(name);
    await runTransaction(database, SETTINGS_STORE, "readwrite", async (transaction) => {
      const store = transaction.objectStore(SETTINGS_STORE);
      const existing = await requestResult(store.get(SETTINGS_ID));
      if (existing) throw new LocalVaultError("A local vault already exists.");
      store.add({
        id: SETTINGS_ID,
        salt: toArrayBuffer(salt),
        verifierNonce: toArrayBuffer(verifierNonce),
        verifierCiphertext,
      } satisfies VaultSettingsRow);
      return undefined;
    });
    const session = { [SESSION_BRAND]: true } as VaultSession;
    activeSessions.add(session);
    sessionState.set(session, { databaseName: name, database, key });
    created = true;
    return session;
  } finally {
    verifierPlaintext.fill(0);
    new Uint8Array(verifierBuffer).fill(0);
    salt.fill(0);
    verifierNonce.fill(0);
    if (!created) database?.close();
  }
}

export async function unlockVaultSession(passphrase: string, options?: LocalVaultOptions): Promise<VaultSession> {
  const name = databaseName(options);
  const settings = await readSettings(name);
  if (!settings) throw new LocalVaultError("No local vault has been created.");
  const salt = new Uint8Array(settings.salt);
  let key: CryptoKey;
  try {
    key = await deriveVaultKey(passphrase, salt);
  } finally {
    salt.fill(0);
  }
  const verifierNonce = new Uint8Array(settings.verifierNonce);
  try {
    const plaintext = new Uint8Array(await requireCrypto().subtle.decrypt(
      { name: "AES-GCM", iv: toArrayBuffer(verifierNonce), additionalData: aad("vault-verifier") },
      key,
      settings.verifierCiphertext,
    ));
    let matches: boolean;
    try {
      matches = decoder.decode(plaintext) === "vaultora-v1-vault-verifier";
    } finally {
      plaintext.fill(0);
    }
    if (!matches) throw new LocalVaultError("Incorrect passphrase or corrupted local vault.");
  } catch {
    verifierNonce.fill(0);
    throw new LocalVaultError("Incorrect passphrase or corrupted local vault.");
  }
  verifierNonce.fill(0);
  return newSession(name, key);
}

export function lockVaultSession(session: VaultSession): void {
  if (session && activeSessions.has(session as object)) {
    sessionContext(session).database.close();
    activeSessions.delete(session as object);
    sessionState.delete(session as object);
  }
}

export async function getVaultKdfSalt(session: VaultSession): Promise<ArrayBuffer> {
  assertSession(session);
  const settings = await readSettings(sessionContext(session).databaseName);
  assertSession(session);
  if (!settings) throw new LocalVaultError("The local vault settings could not be read.");
  return settings.salt.slice(0);
}

export async function validatePassphraseForEncryptedDocument(
  passphrase: string,
  payload: Pick<EncryptedDocumentPayload, "id" | "kdfSalt" | "wrappedKeyNonce" | "wrappedKeyCiphertext" | "metadataNonce" | "metadataCiphertext">,
): Promise<void> {
  assertRandomId(payload.id);
  if (payload.kdfSalt.byteLength !== 16 || payload.wrappedKeyNonce.byteLength !== 12 || payload.metadataNonce.byteLength !== 12) {
    throw new LocalVaultError("The cloud vault key envelope is invalid.");
  }
  const salt = new Uint8Array(payload.kdfSalt.slice(0));
  let key: CryptoKey;
  try {
    key = await deriveVaultKey(passphrase, salt);
  } finally {
    salt.fill(0);
  }
  let rawDek: Uint8Array;
  try {
    rawDek = new Uint8Array(await requireCrypto().subtle.decrypt(
      { name: "AES-GCM", iv: payload.wrappedKeyNonce, additionalData: aad("document-key-wrap", payload.id) },
      key,
      payload.wrappedKeyCiphertext,
    ));
  } catch {
    throw new LocalVaultError("The vault passphrase did not unlock the encrypted cloud documents.");
  }
  try {
    const dek = await requireCrypto().subtle.importKey("raw", toArrayBuffer(rawDek), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
    const plaintext = new Uint8Array(await requireCrypto().subtle.decrypt(
      { name: "AES-GCM", iv: payload.metadataNonce, additionalData: aad("document-metadata", payload.id) },
      dek,
      payload.metadataCiphertext,
    ));
    try {
      const metadata = JSON.parse(decoder.decode(plaintext)) as Partial<VaultDocumentMetadata>;
      if (typeof metadata.fileName !== "string" || typeof metadata.digest !== "string" || !/^[0-9a-f]{64}$/i.test(metadata.digest)) {
        throw new LocalVaultError("The cloud vault metadata is invalid or uses a different passphrase.");
      }
    } catch {
      throw new LocalVaultError("The vault passphrase did not unlock the encrypted cloud documents.");
    } finally {
      plaintext.fill(0);
    }
  } finally {
    rawDek.fill(0);
  }
}

export async function validateVaultFile(file: File | null | undefined): Promise<void> {
  if (!file || typeof file.arrayBuffer !== "function") throw new InvalidVaultFileError("Choose a file to add to the vault.");
  if (!file.name || file.name.trim().length === 0) throw new InvalidVaultFileError("The selected file does not have a valid name.");
  if (file.size <= 0) throw new InvalidVaultFileError("Empty files cannot be added to the vault.");
  if (file.size > MAX_FILE_BYTES) throw new InvalidVaultFileError("Files must be 25 MiB or smaller.");
  const extension = file.name.split(".").pop()?.toLowerCase();
  const allowedMimes = extension ? MIME_BY_EXTENSION[extension] : undefined;
  if (!allowedMimes) throw new InvalidVaultFileError("This file format is not supported.");
  const mime = (file.type || "").toLowerCase();
  if (mime && !allowedMimes.has(mime)) throw new InvalidVaultFileError("The file extension and MIME type do not match.");
}

async function getDocumentRow(session: VaultSession, id: string): Promise<EncryptedDocumentRow> {
  assertSession(session);
  const row = await runTransaction(sessionContext(session).database, DOCUMENT_STORE, "readonly", async (transaction) =>
    requestResult(transaction.objectStore(DOCUMENT_STORE).get(id)) as Promise<EncryptedDocumentRow | undefined>,
  );
  assertSession(session);
  if (!row) throw new LocalVaultError("The requested vault document was not found.");
  return row;
}

async function unwrapDocumentKey(session: VaultSession, row: EncryptedDocumentRow): Promise<CryptoKey> {
  const raw = new Uint8Array(await requireCrypto().subtle.decrypt(
    {
      name: "AES-GCM",
      iv: row.wrappedKeyNonce,
      additionalData: aad("document-key-wrap", row.id),
    },
    sessionContext(session).key,
    row.wrappedKeyCiphertext,
  ));
  try {
    assertSession(session);
    const key = await requireCrypto().subtle.importKey("raw", toArrayBuffer(raw), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
    assertSession(session);
    return key;
  } finally {
    raw.fill(0);
  }
}

async function decryptMetadata(session: VaultSession, row: EncryptedDocumentRow, key: CryptoKey): Promise<VaultDocumentMetadata> {
  const plaintext = new Uint8Array(await requireCrypto().subtle.decrypt(
    { name: "AES-GCM", iv: row.metadataNonce, additionalData: aad("document-metadata", row.id) },
    key,
    row.metadataCiphertext,
  ));
  try {
    assertSession(session);
    const metadata = JSON.parse(decoder.decode(plaintext)) as VaultDocumentMetadata;
    assertSession(session);
    return metadata;
  } finally {
    plaintext.fill(0);
  }
}

async function encryptMetadata(id: string, metadata: VaultDocumentMetadata, key: CryptoKey): Promise<{ nonce: Uint8Array; ciphertext: ArrayBuffer }> {
  const nonce = randomBytes(12);
  const plaintext = encoder.encode(JSON.stringify(metadata));
  const plaintextBuffer = toArrayBuffer(plaintext);
  try {
    return {
      nonce,
      ciphertext: await requireCrypto().subtle.encrypt(
        { name: "AES-GCM", iv: toArrayBuffer(nonce), additionalData: aad("document-metadata", id) },
        key,
        plaintextBuffer,
      ),
    };
  } finally {
    plaintext.fill(0);
    new Uint8Array(plaintextBuffer).fill(0);
  }
}

export async function listDocuments(session: VaultSession): Promise<VaultDocument[]> {
  assertSession(session);
  const rows = await runTransaction(sessionContext(session).database, DOCUMENT_STORE, "readonly", async (transaction) =>
    requestResult(transaction.objectStore(DOCUMENT_STORE).getAll()) as Promise<EncryptedDocumentRow[]>,
  );
  assertSession(session);
  const documents: VaultDocument[] = [];
  for (const row of rows) {
    assertSession(session);
    const dek = await unwrapDocumentKey(session, row);
    documents.push({ id: row.id, metadata: await decryptMetadata(session, row, dek) });
  }
  assertSession(session);
  return documents;
}

export async function getDocument(session: VaultSession, id: string): Promise<VaultDocument> {
  const row = await getDocumentRow(session, id);
  const dek = await unwrapDocumentKey(session, row);
  const metadata = await decryptMetadata(session, row, dek);
  assertSession(session);
  return { id, metadata };
}

export async function exportEncryptedDocument(session: VaultSession, id: string): Promise<EncryptedDocumentPayload> {
  const row = await getDocumentRow(session, id);
  const settings = await readSettings(sessionContext(session).databaseName);
  assertSession(session);
  if (!settings) throw new LocalVaultError("The local vault settings could not be read.");
  return {
    id: row.id,
    fileNonce: row.dataNonce.slice(0),
    fileCiphertext: row.dataCiphertext.slice(0),
    metadataNonce: row.metadataNonce.slice(0),
    metadataCiphertext: row.metadataCiphertext.slice(0),
    wrappedKeyNonce: row.wrappedKeyNonce.slice(0),
    wrappedKeyCiphertext: row.wrappedKeyCiphertext.slice(0),
    kdfSalt: settings.salt.slice(0),
  };
}

export async function importEncryptedDocument(session: VaultSession, payload: EncryptedDocumentPayload): Promise<void> {
  assertSession(session);
  assertRandomId(payload.id);
  if (payload.fileNonce.byteLength !== 12 || payload.metadataNonce.byteLength !== 12 || payload.wrappedKeyNonce.byteLength !== 12
    || payload.kdfSalt.byteLength !== 16 || payload.fileCiphertext.byteLength <= 16 || payload.fileCiphertext.byteLength > MAX_FILE_BYTES + 16
    || payload.metadataCiphertext.byteLength <= 16 || payload.metadataCiphertext.byteLength > 65_536
    || payload.wrappedKeyCiphertext.byteLength <= 16 || payload.wrappedKeyCiphertext.byteLength > 128) {
    throw new LocalVaultError("The encrypted cloud document has invalid cryptographic fields.");
  }
  const settings = await readSettings(sessionContext(session).databaseName);
  assertSession(session);
  if (!settings || !equalBuffers(settings.salt, payload.kdfSalt)) {
    throw new LocalVaultError("This encrypted document belongs to a different vault key.");
  }
  const row: EncryptedDocumentRow = {
    id: payload.id,
    dataNonce: payload.fileNonce.slice(0),
    dataCiphertext: payload.fileCiphertext.slice(0),
    metadataNonce: payload.metadataNonce.slice(0),
    metadataCiphertext: payload.metadataCiphertext.slice(0),
    wrappedKeyNonce: payload.wrappedKeyNonce.slice(0),
    wrappedKeyCiphertext: payload.wrappedKeyCiphertext.slice(0),
  };
  const dek = await unwrapDocumentKey(session, row);
  const metadata = await decryptMetadata(session, row, dek);
  if (!Number.isSafeInteger(metadata.size) || metadata.size <= 0 || metadata.size > MAX_FILE_BYTES
    || typeof metadata.fileName !== "string" || typeof metadata.mimeType !== "string"
    || !/^[0-9a-f]{64}$/i.test(metadata.digest)) {
    throw new LocalVaultError("The encrypted cloud document metadata is invalid.");
  }
  const plaintext = new Uint8Array(await requireCrypto().subtle.decrypt(
    { name: "AES-GCM", iv: row.dataNonce, additionalData: aad("document-data", row.id) },
    dek,
    row.dataCiphertext,
  ));
  try {
    assertSession(session);
    if (plaintext.byteLength !== metadata.size) throw new LocalVaultError("The encrypted cloud document size does not match its metadata.");
    const digest = new Uint8Array(await requireCrypto().subtle.digest("SHA-256", plaintext));
    try {
      if (hex(digest) !== metadata.digest) throw new LocalVaultError("The encrypted cloud document fingerprint does not match its metadata.");
    } finally {
      digest.fill(0);
    }
  } finally {
    plaintext.fill(0);
  }
  assertSession(session);
  await runTransaction(sessionContext(session).database, DOCUMENT_STORE, "readwrite", async (transaction) => {
    transaction.objectStore(DOCUMENT_STORE).put(row);
    return undefined;
  });
  assertSession(session);
}

export async function saveDocument(session: VaultSession, file: File, workspaceId?: string): Promise<VaultDocument> {
  assertSession(session);
  await validateVaultFile(file);
  assertSession(session);
  const id = makeId();
  const data = new Uint8Array(await file.arrayBuffer());
  try {
    assertSession(session);
    if (data.byteLength === 0 || data.byteLength > MAX_FILE_BYTES || data.byteLength !== file.size) {
      throw new InvalidVaultFileError("The file bytes do not match the validated file size.");
    }
    const digestBytes = new Uint8Array(await requireCrypto().subtle.digest("SHA-256", data));
    let digest: string;
    try {
      assertSession(session);
      digest = hex(digestBytes);
    } finally {
      digestBytes.fill(0);
    }
    const now = new Date().toISOString();
    const metadata: VaultDocumentMetadata = {
      fileName: file.name,
      mimeType: file.type || MIME_BY_EXTENSION[file.name.split(".").pop()!.toLowerCase()]!.values().next().value!,
      size: data.byteLength,
      createdAt: now,
      updatedAt: now,
      digest,
      starred: false,
      ...(workspaceId ? { workspaceId } : {}),
    };
    const rawDek = randomBytes(32);
    try {
      const rawDekBuffer = toArrayBuffer(rawDek);
      let dek: CryptoKey;
      try {
        dek = await requireCrypto().subtle.importKey("raw", rawDekBuffer, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
      } finally {
        new Uint8Array(rawDekBuffer).fill(0);
      }
      assertSession(session);
      const dataNonce = randomBytes(12);
      const wrappedKeyNonce = randomBytes(12);
      try {
        const dataBuffer = toArrayBuffer(data);
        let dataCiphertext: ArrayBuffer;
        try {
          dataCiphertext = await requireCrypto().subtle.encrypt(
            { name: "AES-GCM", iv: toArrayBuffer(dataNonce), additionalData: aad("document-data", id) },
            dek,
            dataBuffer,
          );
        } finally {
          new Uint8Array(dataBuffer).fill(0);
        }
        assertSession(session);
        const encryptedMetadata = await encryptMetadata(id, metadata, dek);
        try {
          assertSession(session);
          const keyBuffer = toArrayBuffer(rawDek);
          let wrappedKeyCiphertext: ArrayBuffer;
          try {
            wrappedKeyCiphertext = await requireCrypto().subtle.encrypt(
              { name: "AES-GCM", iv: toArrayBuffer(wrappedKeyNonce), additionalData: aad("document-key-wrap", id) },
              sessionContext(session).key,
              keyBuffer,
            );
          } finally {
            new Uint8Array(keyBuffer).fill(0);
          }
          assertSession(session);
          const row: EncryptedDocumentRow = {
            id,
            dataNonce: toArrayBuffer(dataNonce),
            dataCiphertext,
            metadataNonce: toArrayBuffer(encryptedMetadata.nonce),
            metadataCiphertext: encryptedMetadata.ciphertext,
            wrappedKeyNonce: toArrayBuffer(wrappedKeyNonce),
            wrappedKeyCiphertext,
          };
          await runTransaction(sessionContext(session).database, DOCUMENT_STORE, "readwrite", async (transaction) => {
            transaction.objectStore(DOCUMENT_STORE).add(row);
            return undefined;
          });
          assertSession(session);
          return { id, metadata };
        } finally {
          encryptedMetadata.nonce.fill(0);
        }
      } finally {
        dataNonce.fill(0);
        wrappedKeyNonce.fill(0);
      }
    } finally {
      rawDek.fill(0);
    }
  } finally {
    data.fill(0);
  }
}

export async function decryptDocument(
  session: VaultSession,
  id: string,
): Promise<{ blob: Blob; metadata: VaultDocumentMetadata }> {
  const row = await getDocumentRow(session, id);
  const dek = await unwrapDocumentKey(session, row);
  const metadata = await decryptMetadata(session, row, dek);
  const plaintext = new Uint8Array(await requireCrypto().subtle.decrypt(
    { name: "AES-GCM", iv: row.dataNonce, additionalData: aad("document-data", id) },
    dek,
    row.dataCiphertext,
  ));
  try {
    assertSession(session);
    const blob = new Blob([plaintext], { type: metadata.mimeType });
    assertSession(session);
    return { blob, metadata };
  } finally {
    plaintext.fill(0);
  }
}

export async function updateDocument(session: VaultSession, id: string, patch: VaultDocumentPatch): Promise<VaultDocument> {
  const allowedKeys: (keyof VaultDocumentPatch)[] = [
    "fileName", "mimeType", "starred", "workspaceId", "transactionHash", "verificationState",
    "ownerAddress", "network", "registeredAt", "verifiedAt",
  ];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const row = await getDocumentRow(session, id);
    const dek = await unwrapDocumentKey(session, row);
    const metadata = await decryptMetadata(session, row, dek);
    for (const key of allowedKeys) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        const value = patch[key];
        if (value !== undefined) (metadata as unknown as Record<string, unknown>)[key] = value;
        else delete (metadata as unknown as Record<string, unknown>)[key];
      }
    }
    metadata.updatedAt = new Date().toISOString();
    const encrypted = await encryptMetadata(id, metadata, dek);
    try {
      await runTransaction(sessionContext(session).database, DOCUMENT_STORE, "readwrite", async (transaction) => {
        const store = transaction.objectStore(DOCUMENT_STORE);
        const latest = await requestResult(store.get(id)) as EncryptedDocumentRow | undefined;
        assertSession(session);
        if (!latest) throw new LocalVaultError("The requested vault document was not found.");
        if (!equalBuffers(latest.metadataNonce, row.metadataNonce) || !equalBuffers(latest.metadataCiphertext, row.metadataCiphertext)) {
          throw new ConcurrentDocumentUpdateError();
        }
        latest.metadataNonce = toArrayBuffer(encrypted.nonce);
        latest.metadataCiphertext = encrypted.ciphertext;
        store.put(latest);
        return undefined;
      });
      assertSession(session);
      return { id, metadata };
    } catch (error) {
      if (!(error instanceof ConcurrentDocumentUpdateError)) throw error;
      if (attempt === 2) throw new LocalVaultError("This document kept changing in another vault session. Review it and try again.");
    } finally {
      encrypted.nonce.fill(0);
    }
  }
  throw new LocalVaultError("The document could not be updated. Try again.");
}

export async function deleteDocument(session: VaultSession, id: string): Promise<void> {
  assertSession(session);
  assertRandomId(id);
  const tombstone = await encryptCollection(session, "documentTombstone", { id, deletedAt: new Date().toISOString() });
  await runTransaction(sessionContext(session).database, [DOCUMENT_STORE, COLLECTION_STORE], "readwrite", async (transaction) => {
    transaction.objectStore(DOCUMENT_STORE).delete(id);
    transaction.objectStore(COLLECTION_STORE).put(tombstone);
    return undefined;
  });
  assertSession(session);
}

export async function metadataFingerprint(session: VaultSession, id: string): Promise<string> {
  const row = await getDocumentRow(session, id);
  const fingerprint = new Uint8Array(await requireCrypto().subtle.digest("SHA-256", row.metadataCiphertext));
  try {
    assertSession(session);
    return hex(fingerprint);
  } finally {
    fingerprint.fill(0);
  }
}

export async function getVaultStorageEstimate(): Promise<{ usage: number; quota: number }> {
  try {
    const estimate = await globalThis.navigator?.storage?.estimate?.();
    return { usage: estimate?.usage ?? 0, quota: estimate?.quota ?? 0 };
  } catch {
    return { usage: 0, quota: 0 };
  }
}

async function encryptCollection<T extends { id: string }>(
  session: VaultSession,
  type: CollectionType,
  value: T,
): Promise<EncryptedCollectionRow> {
  const nonce = randomBytes(12);
  const plaintext = encoder.encode(JSON.stringify(value));
  const plaintextBuffer = toArrayBuffer(plaintext);
  try {
    assertSession(session);
    const ciphertext = await requireCrypto().subtle.encrypt(
      { name: "AES-GCM", iv: toArrayBuffer(nonce), additionalData: aad(`collection-${type}`, value.id) },
      sessionContext(session).key,
      plaintextBuffer,
    );
    assertSession(session);
    return {
      id: value.id,
      type,
      nonce: toArrayBuffer(nonce),
      ciphertext,
    };
  } finally {
    nonce.fill(0);
    plaintext.fill(0);
    new Uint8Array(plaintextBuffer).fill(0);
  }
}

async function decryptCollection<T>(session: VaultSession, row: EncryptedCollectionRow): Promise<T> {
  const plaintext = new Uint8Array(await requireCrypto().subtle.decrypt(
    { name: "AES-GCM", iv: row.nonce, additionalData: aad(`collection-${row.type}`, row.id) },
    sessionContext(session).key,
    row.ciphertext,
  ));
  try {
    assertSession(session);
    const value = JSON.parse(decoder.decode(plaintext)) as T;
    assertSession(session);
    return value;
  } finally {
    plaintext.fill(0);
  }
}

async function saveCollection<T extends { id: string }>(session: VaultSession, type: CollectionType, value: T): Promise<T> {
  assertSession(session);
  const row = await encryptCollection(session, type, value);
  await runTransaction(sessionContext(session).database, COLLECTION_STORE, "readwrite", async (transaction) => {
    const store = transaction.objectStore(COLLECTION_STORE);
    const existing = await requestResult(store.get(value.id)) as EncryptedCollectionRow | undefined;
    assertSession(session);
    if (existing && existing.type !== type) {
      throw new LocalVaultError("That random collection ID is already used by another record type.");
    }
    store.put(row);
    return undefined;
  });
  assertSession(session);
  return value;
}

async function listCollection<T>(session: VaultSession, type: CollectionType): Promise<T[]> {
  assertSession(session);
  const rows = await runTransaction(sessionContext(session).database, COLLECTION_STORE, "readonly", async (transaction) =>
    requestResult(transaction.objectStore(COLLECTION_STORE).getAll()) as Promise<EncryptedCollectionRow[]>,
  );
  assertSession(session);
  const matching = rows.filter((row) => row.type === type);
  const result: T[] = [];
  for (const row of matching) {
    assertSession(session);
    result.push(await decryptCollection<T>(session, row));
  }
  assertSession(session);
  return result;
}

async function deleteCollection(session: VaultSession, id: string, type: CollectionType): Promise<void> {
  assertSession(session);
  await runTransaction(sessionContext(session).database, COLLECTION_STORE, "readwrite", async (transaction) => {
    const store = transaction.objectStore(COLLECTION_STORE);
    const row = await requestResult(store.get(id)) as EncryptedCollectionRow | undefined;
    assertSession(session);
    if (row?.type === type) store.delete(id);
    return undefined;
  });
  assertSession(session);
}

export async function listWorkspaces(session: VaultSession): Promise<VaultWorkspace[]> {
  return listCollection<VaultWorkspace>(session, "workspace");
}

export async function saveWorkspace(session: VaultSession, input: VaultWorkspaceInput): Promise<VaultWorkspace> {
  const id = input.id ?? makeId();
  assertRandomId(id);
  const workspace: VaultWorkspace = {
    ...input,
    id,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
  return saveCollection(session, "workspace", workspace);
}

export async function deleteWorkspace(session: VaultSession, id: string): Promise<void> {
  return deleteCollection(session, id, "workspace");
}

export async function listSavedLinks(session: VaultSession): Promise<VaultSavedLink[]> {
  return listCollection<VaultSavedLink>(session, "savedLink");
}

export async function saveSavedLink(session: VaultSession, input: VaultSavedLinkInput): Promise<VaultSavedLink> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(input.url);
  } catch {
    throw new LocalVaultError("Saved links must use a valid HTTP or HTTPS URL.");
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new LocalVaultError("Saved links must use a valid HTTP or HTTPS URL.");
  }
  const now = new Date().toISOString();
  const id = input.id ?? makeId();
  assertRandomId(id);
  const savedLink: VaultSavedLink = {
    ...input,
    id,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
    tags: [...input.tags],
  };
  return saveCollection(session, "savedLink", savedLink);
}

export async function deleteSavedLink(session: VaultSession, id: string): Promise<void> {
  return deleteCollection(session, id, "savedLink");
}

export async function addActivity(session: VaultSession, activity: VaultActivity): Promise<VaultActivity> {
  const value = { ...activity, id: makeId() };
  await saveCollection(session, "activity", value);
  return activity;
}

export async function listActivity(session: VaultSession): Promise<VaultActivity[]> {
  const rows = await listCollection<VaultActivity & { id: string }>(session, "activity");
  return rows.map(({ type, at, entityId, label }) => ({ type, at, entityId, label }));
}

export async function listDocumentTombstones(session: VaultSession): Promise<string[]> {
  const rows = await listCollection<{ id: string; deletedAt: string }>(session, "documentTombstone");
  return rows.map((row) => row.id);
}
