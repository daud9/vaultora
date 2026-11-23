const webcrypto = (globalThis as unknown as {
  process: { getBuiltinModule: (name: string) => { webcrypto: Crypto } };
}).process.getBuiltinModule("node:crypto").webcrypto;
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addActivity,
  createVaultSession,
  decryptDocument,
  deleteDocument,
  deleteSavedLink,
  deleteWorkspace,
  exportEncryptedDocument,
  getDocument,
  getVaultKdfSalt,
  hasLocalVault,
  importEncryptedDocument,
  listActivity,
  listDocumentTombstones,
  listDocuments,
  listSavedLinks,
  listWorkspaces,
  lockVaultSession,
  metadataFingerprint,
  saveDocument,
  saveSavedLink,
  saveWorkspace,
  unlockVaultSession,
  updateDocument,
  validatePassphraseForEncryptedDocument,
  type VaultSession,
} from "./localVault";

const dbs = new Map<string, FakeDatabase>();
let failOpen = false;

function clone<T>(value: T): T {
  return structuredClone(value);
}

interface MutableRequest<T> {
  result: T;
  error: DOMException | null;
  onsuccess: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
}

class FakeTransaction {
  oncomplete: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onabort: ((event: Event) => void) | null = null;
  error: DOMException | null = null;
  private pending = 0;
  private completed = false;
  private readonly ready: Promise<void>;
  private readonly release: () => void;

  constructor(private readonly database: FakeDatabase) {
    const reservation = database.reserve();
    this.ready = reservation.ready;
    this.release = reservation.release;
  }

  objectStore(name: string): IDBObjectStore {
    const target = this.database.stores.get(name);
    if (!target) throw new Error(`Unknown store ${name}`);
    const queue = <T>(getResult: () => T): IDBRequest<T> => {
      const request = { result: undefined, error: null, onsuccess: null, onerror: null } as unknown as IDBRequest<T>;
      const mutable = request as unknown as MutableRequest<T>;
      this.pending += 1;
      void this.ready.then(() => setTimeout(() => {
          if (this.completed) return;
          try {
            mutable.result = clone(getResult());
            request.onsuccess?.call(request, new Event("success") as IDBRequestEventMap["success"]);
          } catch (error) {
            mutable.error = error as DOMException;
            request.onerror?.call(request, new Event("error") as IDBRequestEventMap["error"]);
            this.onerror?.(new Event("error"));
            this.abort();
          } finally {
            this.pending -= 1;
            this.scheduleComplete();
          }
        }, 0));
      return request;
    };
    return {
      get: (key: IDBValidKey) => queue(() => target.get(String(key))),
      getAll: () => queue(() => Array.from(target.values())),
      add: (value: unknown) => queue(() => {
        const row = clone(value) as { id: string };
        if (target.has(row.id)) throw new Error("ConstraintError");
        target.set(row.id, row);
        return row.id;
      }),
      put: (value: unknown) => queue(() => {
        const row = clone(value) as { id: string };
        target.set(row.id, row);
        return row.id;
      }),
      delete: (key: IDBValidKey) => queue(() => {
        target.delete(String(key));
        return undefined;
      }),
    } as unknown as IDBObjectStore;
  }

  abort(): void {
    if (this.completed) return;
    this.completed = true;
    setTimeout(() => {
      this.onabort?.(new Event("abort"));
      this.release();
    }, 0);
  }

  private scheduleComplete(): void {
    setTimeout(() => {
      if (this.completed || this.pending !== 0) return;
      this.completed = true;
      this.oncomplete?.(new Event("complete"));
      this.release();
    }, 0);
  }
}

class FakeDatabase {
  readonly stores = new Map<string, Map<string, unknown>>();
  private transactionTail = Promise.resolve();
  readonly objectStoreNames = {
    contains: (name: string) => this.stores.has(name),
  } as DOMStringList;
  onversionchange: ((event: IDBVersionChangeEvent) => void) | null = null;

  constructor(readonly name: string) {}

  createObjectStore(name: string): IDBObjectStore {
    this.stores.set(name, new Map());
    return {} as IDBObjectStore;
  }

  reserve(): { ready: Promise<void>; release: () => void } {
    const ready = this.transactionTail;
    let resolveTail!: () => void;
    this.transactionTail = new Promise<void>((resolve) => { resolveTail = resolve; });
    let released = false;
    return { ready, release: () => { if (!released) { released = true; resolveTail(); } } };
  }

  transaction(): IDBTransaction {
    return new FakeTransaction(this) as unknown as IDBTransaction;
  }

  close(): void {}
}

const fakeIndexedDB = {
  open(name: string): IDBOpenDBRequest {
    const request = { result: undefined, error: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null } as unknown as IDBOpenDBRequest;
    setTimeout(() => {
      if (failOpen) {
        (request as unknown as MutableRequest<unknown>).error = new DOMException("test open failure", "UnknownError");
        request.onerror?.call(request, new Event("error") as IDBRequestEventMap["error"]);
        return;
      }
      let database = dbs.get(name);
      if (!database) {
        database = new FakeDatabase(name);
        dbs.set(name, database);
        (request as unknown as MutableRequest<IDBDatabase>).result = database as unknown as IDBDatabase;
        request.onupgradeneeded?.call(request, new Event("upgradeneeded") as IDBVersionChangeEvent);
      } else {
        (request as unknown as MutableRequest<IDBDatabase>).result = database as unknown as IDBDatabase;
      }
      request.onsuccess?.call(request, new Event("success") as IDBRequestEventMap["success"]);
    }, 0);
    return request;
  },
  deleteDatabase(name: string): IDBOpenDBRequest {
    const request = { result: undefined, error: null, onsuccess: null, onerror: null, onblocked: null } as unknown as IDBOpenDBRequest;
    setTimeout(() => {
      dbs.delete(name);
      request.onsuccess?.call(request, new Event("success") as IDBRequestEventMap["success"]);
    }, 0);
    return request;
  },
} as unknown as IDBFactory;

let sessions: VaultSession[] = [];
const names = new Set<string>();

function options() {
  const databaseName = `vaultora-test-${crypto.randomUUID()}`;
  names.add(databaseName);
  return { databaseName };
}

function ciphertextText(row: Record<string, unknown>): string {
  return Object.values(row).map((value) => value instanceof ArrayBuffer
    ? new TextDecoder().decode(value)
    : String(value)).join("|");
}

function makeFile(name = "secret.txt", text = "private file bytes", type = "text/plain", size?: number): File {
  const bytes = new TextEncoder().encode(text);
  const file = new File([bytes], name, { type });
  Object.defineProperty(file, "arrayBuffer", { value: async () => bytes.slice().buffer });
  if (size !== undefined) Object.defineProperty(file, "size", { value: size });
  return file;
}

async function createSession(databaseName: string): Promise<VaultSession> {
  const session = await createVaultSession("correct horse battery staple", { databaseName });
  sessions.push(session);
  return session;
}

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("indexedDB", fakeIndexedDB);
});

afterEach(async () => {
  for (const session of sessions) lockVaultSession(session);
  sessions = [];
  failOpen = false;
  for (const databaseName of names) dbs.delete(databaseName);
  names.clear();
  vi.unstubAllGlobals();
});

describe("encrypted local vault documents", () => {
  it("generates a canonical UUID when crypto.randomUUID is unavailable", async () => {
    const { databaseName } = options();
    vi.stubGlobal("crypto", {
      subtle: webcrypto.subtle,
      getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
      randomUUID: undefined,
    });
    const session = await createSession(databaseName);
    const saved = await saveDocument(session, makeFile());
    expect(saved.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it("encrypts and decrypts original bytes and exposes metadata only in the unlocked session", async () => {
    const { databaseName } = options();
    const session = await createSession(databaseName);
    const input = makeFile("confidential.txt", "top secret text");
    const saved = await saveDocument(session, input, "workspace-1");

    expect(saved.metadata).toMatchObject({
      fileName: "confidential.txt",
      size: input.size,
      digest: expect.stringMatching(/^[0-9a-f]{64}$/),
      workspaceId: "workspace-1",
      starred: false,
    });
    const decrypted = await decryptDocument(session, saved.id);
    const decryptedBytes = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(decrypted.blob);
    });
    expect(new TextDecoder().decode(decryptedBytes)).toBe("top secret text");
    expect(await getDocument(session, saved.id)).toEqual(saved);
    expect(await listDocuments(session)).toEqual([saved]);

    const stored = dbs.get(databaseName)!.stores.get("encryptedDocuments")!;
    const row = stored.get(saved.id) as Record<string, unknown>;
    expect(ciphertextText(row)).not.toContain("confidential.txt");
    expect(new TextDecoder().decode(row.dataCiphertext as ArrayBuffer)).not.toContain("top secret text");
    expect(await metadataFingerprint(session, saved.id)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects ciphertext tampering", async () => {
    const { databaseName } = options();
    const session = await createSession(databaseName);
    const saved = await saveDocument(session, makeFile());
    const store = dbs.get(databaseName)!.stores.get("encryptedDocuments")!;
    const row = store.get(saved.id) as { dataCiphertext: ArrayBuffer };
    const tampered = new Uint8Array(row.dataCiphertext.slice(0));
    tampered[0] ^= 1;
    row.dataCiphertext = tampered.buffer;
    store.set(saved.id, row);
    await expect(decryptDocument(session, saved.id)).rejects.toThrow();
  });

  it("restores encrypted documents only with the matching vault key and rejects tampered records", async () => {
    const sourceName = options().databaseName;
    const targetName = options().databaseName;
    const targetTwoName = options().databaseName;
    const salt = new Uint8Array(16).fill(19);
    const source = await createVaultSession("correct horse battery staple", { databaseName: sourceName, vaultSalt: salt });
    sessions.push(source);
    const saved = await saveDocument(source, makeFile("shared.txt", "ciphertext travels, plaintext does not"));
    const payload = await exportEncryptedDocument(source, saved.id);
    expect(new Uint8Array(await getVaultKdfSalt(source))).toEqual(salt);
    await expect(validatePassphraseForEncryptedDocument("correct horse battery staple", payload)).resolves.toBeUndefined();
    await expect(validatePassphraseForEncryptedDocument("incorrect passphrase", payload)).rejects.toThrow(/did not unlock/i);

    const target = await createVaultSession("correct horse battery staple", { databaseName: targetName, vaultSalt: salt });
    sessions.push(target);
    expect(await getVaultKdfSalt(target)).toEqual(payload.kdfSalt);
    await importEncryptedDocument(target, payload);
    expect(await listDocuments(target)).toEqual([saved]);
    expect((await decryptDocument(target, saved.id)).blob.size).toBe(saved.metadata.size);

    const targetTwo = await createVaultSession("correct horse battery staple", { databaseName: targetTwoName, vaultSalt: salt });
    sessions.push(targetTwo);
    const corrupted = { ...payload, metadataCiphertext: payload.metadataCiphertext.slice(0) };
    new Uint8Array(corrupted.metadataCiphertext)[0] ^= 1;
    await expect(importEncryptedDocument(targetTwo, corrupted)).rejects.toThrow();
    expect(await listDocuments(targetTwo)).toEqual([]);
  });

  it("persists an encrypted tombstone when a document is deleted", async () => {
    const { databaseName } = options();
    const session = await createSession(databaseName);
    const saved = await saveDocument(session, makeFile());
    await deleteDocument(session, saved.id);
    expect(await listDocuments(session)).toEqual([]);
    expect(await listDocumentTombstones(session)).toEqual([saved.id]);
  });

  it("does not return plaintext from a decrypt that completes after the session is locked", async () => {
    const { databaseName } = options();
    const session = await createSession(databaseName);
    const saved = await saveDocument(session, makeFile());
    const originalDecrypt = webcrypto.subtle.decrypt.bind(webcrypto.subtle);
    let releaseDecrypt!: () => void;
    let signalDecryptStarted!: () => void;
    const decryptGate = new Promise<void>((resolve) => { releaseDecrypt = resolve; });
    const decryptStarted = new Promise<void>((resolve) => { signalDecryptStarted = resolve; });
    let paused = false;
    const decryptSpy = vi.spyOn(webcrypto.subtle, "decrypt").mockImplementation(async (...args) => {
      const result = await originalDecrypt(...args);
      if (!paused) {
        paused = true;
        signalDecryptStarted();
        await decryptGate;
      }
      return result;
    });

    try {
      const pendingDecrypt = decryptDocument(session, saved.id);
      await decryptStarted;
      lockVaultSession(session);
      releaseDecrypt();
      await expect(pendingDecrypt).rejects.toThrow(/session is not active/i);
      expect(decryptSpy).toHaveBeenCalledTimes(1);
    } finally {
      releaseDecrypt();
      decryptSpy.mockRestore();
    }
  });

  it("rejects an incorrect passphrase and duplicate vault setup", async () => {
    const { databaseName } = options();
    await expect(createVaultSession("too short", { databaseName })).rejects.toThrow(/12 characters/i);
    const session = await createSession(databaseName);
    await expect(createVaultSession("another passphrase", { databaseName })).rejects.toThrow(/already exists/i);
    lockVaultSession(session);
    await expect(unlockVaultSession("incorrect passphrase", { databaseName })).rejects.toThrow(/incorrect passphrase/i);
    const unlocked = await unlockVaultSession("correct horse battery staple", { databaseName });
    sessions.push(unlocked);
  });

  it("rejects unsupported, mismatched, empty, and oversized files", async () => {
    const { databaseName } = options();
    const session = await createSession(databaseName);
    await expect(saveDocument(session, makeFile("bad.exe", "x", "application/octet-stream"))).rejects.toThrow(/format/i);
    await expect(saveDocument(session, makeFile("bad.txt", "x", "application/pdf"))).rejects.toThrow(/MIME type/i);
    await expect(saveDocument(session, makeFile("empty.txt", "", "text/plain"))).rejects.toThrow(/Empty/i);
    await expect(saveDocument(session, makeFile("large.txt", "x", "text/plain", 25 * 1024 * 1024 + 1))).rejects.toThrow(/25 MiB/i);
  });

  it("updates encrypted metadata, lists names after unlock, and deletes documents", async () => {
    const { databaseName } = options();
    const session = await createSession(databaseName);
    const saved = await saveDocument(session, makeFile());
    const updated = await updateDocument(session, saved.id, {
      starred: true,
      workspaceId: "space-1",
      transactionHash: "tx-hash",
      verificationState: "registered",
      registeredAt: "2026-11-23T00:00:00.000Z",
      verifiedAt: "2026-11-23T00:01:00.000Z",
      ownerAddress: "GABC",
      network: "testnet",
    });
    expect(updated.metadata).toMatchObject({ starred: true, workspaceId: "space-1", transactionHash: "tx-hash" });
    expect((await listDocuments(session)).map((document) => document.metadata.fileName)).toEqual(["secret.txt"]);
    await deleteDocument(session, saved.id);
    expect(await listDocuments(session)).toEqual([]);
  });

  it("retries a stale concurrent metadata update without losing the other edit", async () => {
    const { databaseName } = options();
    const session = await createSession(databaseName);
    const saved = await saveDocument(session, makeFile());

    await Promise.all([
      updateDocument(session, saved.id, { starred: true }),
      updateDocument(session, saved.id, { fileName: "renamed.txt" }),
    ]);

    expect((await getDocument(session, saved.id)).metadata).toMatchObject({
      starred: true,
      fileName: "renamed.txt",
    });
  });

  it("surfaces IndexedDB open failures", async () => {
    failOpen = true;
    await expect(hasLocalVault({ databaseName: "vaultora-open-error" })).rejects.toThrow(/open the local vault database/i);
  });
});

describe("encrypted workspace, saved-link, and activity collections", () => {
  it("supports encrypted workspace and saved-link CRUD and only accepts HTTP(S) URLs", async () => {
    const { databaseName } = options();
    const session = await createSession(databaseName);
    const workspace = await saveWorkspace(session, {
      name: "Private Project",
      description: "Encrypted workspace detail",
      color: "blue",
      icon: "folder",
    });
    expect(await listWorkspaces(session)).toEqual([workspace]);
    const updatedWorkspace = await saveWorkspace(session, { ...workspace, name: "Renamed Project" });
    expect(await listWorkspaces(session)).toEqual([updatedWorkspace]);

    await expect(saveSavedLink(session, {
      url: "javascript:alert(1)", title: "bad", description: "", category: "", tags: [],
    })).rejects.toThrow(/HTTP or HTTPS/i);
    const link = await saveSavedLink(session, {
      url: "https://example.test/private?q=secret",
      title: "Private title",
      description: "Private description",
      category: "research",
      tags: ["confidential"],
    });
    expect(await listSavedLinks(session)).toEqual([link]);

    const collectionRows = dbs.get(databaseName)!.stores.get("encryptedCollections")!;
    const serialized = Array.from(collectionRows.values()).map((row) => ciphertextText(row as Record<string, unknown>));
    expect(serialized.join(" ")).not.toContain("Private Project");
    expect(serialized.join(" ")).not.toContain("example.test");
    expect(serialized.join(" ")).not.toContain("confidential");

    await deleteSavedLink(session, link.id);
    await deleteWorkspace(session, workspace.id);
    expect(await listSavedLinks(session)).toEqual([]);
    expect(await listWorkspaces(session)).toEqual([]);
  });

  it("stores activity labels encrypted and lists them only after unlock", async () => {
    const { databaseName } = options();
    const session = await createSession(databaseName);
    const activity = { type: "document-uploaded", at: new Date().toISOString(), entityId: "random-id", label: "Private document name" };
    await addActivity(session, activity);
    expect(await listActivity(session)).toMatchObject([activity]);
    const rows = dbs.get(databaseName)!.stores.get("encryptedCollections")!;
    expect(Array.from(rows.values()).map((row) => ciphertextText(row as Record<string, unknown>)).join(" ")).not.toContain("Private document name");
  });
});
