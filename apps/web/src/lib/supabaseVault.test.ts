import { afterEach, describe, expect, it, vi } from "vitest";
const { mockSupabase, mockLocalVault } = vi.hoisted(() => ({
  mockSupabase: {
    auth: { getUser: vi.fn() },
    from: vi.fn(),
    storage: { from: vi.fn() },
  },
  mockLocalVault: {
    exportEncryptedDocument: vi.fn(),
    deleteDocument: vi.fn(),
    getVaultKdfSalt: vi.fn(),
    importEncryptedDocument: vi.fn(),
    listDocumentTombstones: vi.fn(),
    listDocuments: vi.fn(),
    validatePassphraseForEncryptedDocument: vi.fn(),
  },
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => mockSupabase }));
vi.mock("./localVault", () => mockLocalVault);
import {
  cloudObjectPath,
  decodeCloudBytes,
  encodeCloudBytes,
  inspectCloudVault,
  resolveCloudConflict,
  synchronizeEncryptedDocuments,
} from "./supabaseVault";
import type { VaultSession } from "./localVault";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

const ownerId = "123e4567-e89b-42d3-a456-426614174000";
const documentId = "123e4567-e89b-42d3-a456-426614174001";
const bytes = (length: number) => new Uint8Array(length).buffer;

function configureCloudRows(documentRows: unknown[] = []) {
  vi.stubEnv("VITE_SUPABASE_URL", "https://vaultora.supabase.co");
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "browser-publishable-test-key");
  mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: ownerId, email: "owner@example.test" } }, error: null });
  mockSupabase.from.mockImplementation((table: string) => {
    const data = table === "vaultora_documents" ? documentRows : [];
    return { select: () => ({ order: () => ({ range: async () => ({ data, error: null }) }) }) };
  });
}

function cloudRow() {
  return {
    id: documentId,
    owner_id: ownerId,
    object_path: cloudObjectPath(ownerId, documentId),
    schema_version: 1,
    file_nonce: encodeCloudBytes(bytes(12)),
    metadata_ciphertext: encodeCloudBytes(bytes(18)),
    metadata_nonce: encodeCloudBytes(bytes(12)),
    wrapped_key: encodeCloudBytes(bytes(18)),
    wrap_nonce: encodeCloudBytes(bytes(12)),
    kdf_salt: encodeCloudBytes(bytes(16)),
    created_at: "2026-11-23T10:00:00.000Z",
    updated_at: "2026-11-23T10:00:00.000Z",
  };
}

describe("Supabase encrypted-payload encoding", () => {
  it("round-trips binary ciphertext without text conversion", () => {
    const original = new Uint8Array([0, 255, 3, 128, 17, 42]);
    const encoded = encodeCloudBytes(original);
    expect(new Uint8Array(decodeCloudBytes(encoded))).toEqual(original);
  });

  it("rejects malformed or non-canonical base64 values", () => {
    for (const value of ["", "!bad", "YQ", "YR=="]) {
      expect(() => decodeCloudBytes(value)).toThrow(/invalid encrypted value/i);
    }
  });

  it("builds only the migration's authenticated-user and random-document path", () => {
    expect(cloudObjectPath(ownerId, documentId)).toBe(`${ownerId}/${documentId}.enc`);
    expect(() => cloudObjectPath("someone-else", "document-id")).toThrow(/invalid identifier/i);
  });
});

describe("cloud sync conflict policy", () => {
  it("skips identical encrypted envelopes", () => {
    expect(resolveCloudConflict("invalid-local-time", "invalid-cloud-time", true)).toBe("unchanged");
  });

  it("uploads the later local version and downloads the later cloud version", () => {
    expect(resolveCloudConflict("2026-11-23T10:01:00.000Z", "2026-11-23T10:00:00.000Z", false)).toBe("upload-local");
    expect(resolveCloudConflict("2026-11-23T10:00:00.000Z", "2026-11-23T10:01:00.000Z", false)).toBe("download-cloud");
    expect(resolveCloudConflict("2026-11-23T10:00:00.000Z", "2026-11-23T10:00:00.000Z", false)).toBe("download-cloud");
  });

  it("fails closed on invalid timestamps instead of overwriting either copy", () => {
    expect(() => resolveCloudConflict("not-a-date", "2026-11-23T10:00:00.000Z", false)).toThrow(/invalid version timestamp/i);
  });
});

describe("cloud operation failures", () => {
  it("reports a remote read failure instead of treating it as an empty vault", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://vaultora.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "browser-publishable-test-key");
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: ownerId, email: "owner@example.test" } },
      error: null,
    });
    mockSupabase.from.mockImplementation(() => ({
      select: () => ({ order: () => ({ range: async () => ({ data: null, error: new Error("network unavailable") }) }) }),
    }));
    await expect(inspectCloudVault()).rejects.toThrow(/could not be read/i);
  });

  it("rejects malformed remote rows instead of treating them as valid encrypted records", async () => {
    configureCloudRows([{ ...cloudRow(), file_nonce: null }]);
    await expect(inspectCloudVault()).rejects.toThrow(/expected owner-isolated schema/i);
  });

  it("reports an encrypted-object upload failure and does not continue as if the document synced", async () => {
    configureCloudRows();
    mockLocalVault.getVaultKdfSalt.mockResolvedValue(bytes(16));
    mockLocalVault.listDocumentTombstones.mockResolvedValue([]);
    mockLocalVault.listDocuments.mockResolvedValue([{ id: documentId, metadata: { createdAt: "2026-11-23T10:00:00.000Z", updatedAt: "2026-11-23T10:00:00.000Z" } }]);
    mockLocalVault.exportEncryptedDocument.mockResolvedValue({
      id: documentId,
      fileNonce: bytes(12),
      fileCiphertext: bytes(32),
      metadataNonce: bytes(12),
      metadataCiphertext: bytes(18),
      wrappedKeyNonce: bytes(12),
      wrappedKeyCiphertext: bytes(18),
      kdfSalt: bytes(16),
    });
    mockSupabase.storage.from.mockReturnValue({ upload: async () => ({ error: new Error("storage unavailable") }) });
    await expect(synchronizeEncryptedDocuments({} as VaultSession)).rejects.toThrow(/could not be uploaded/i);
  });

  it("reports a missing cloud-object download instead of counting it as restored", async () => {
    configureCloudRows([cloudRow()]);
    mockLocalVault.getVaultKdfSalt.mockResolvedValue(bytes(16));
    mockLocalVault.listDocumentTombstones.mockResolvedValue([]);
    mockLocalVault.listDocuments.mockResolvedValue([]);
    mockSupabase.storage.from.mockReturnValue({ download: async () => ({ data: null, error: new Error("object missing") }) });
    await expect(synchronizeEncryptedDocuments({} as VaultSession)).rejects.toThrow(/could not be downloaded/i);
  });
});
