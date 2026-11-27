import { describe, expect, it } from "vitest";
import {
  RECOVERY_STORAGE_KEY,
  buildRecoveryEmailBody,
  buildRecoveryLink,
  buildRecoveryMailto,
  getRecoveryRecord,
  hasCompletedRecovery,
  openRecoveryMailto,
  recordBackupPasskey,
  recordRecoveryEmail,
  validateRecoveryEmail,
  type RecoveryStorage,
} from "./passkeyRecovery";

const contractId = "C" + "B".repeat(55);

function memoryStorage(): RecoveryStorage & { clear: () => void } {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    clear: () => map.clear(),
  };
}

describe("recovery email validation", () => {
  it("rejects empty and malformed addresses", () => {
    expect(validateRecoveryEmail("")).toMatch(/enter an email/i);
    expect(validateRecoveryEmail("not-an-email")).toMatch(/valid email/i);
    expect(validateRecoveryEmail("user@")).toMatch(/valid email/i);
    expect(validateRecoveryEmail("user@example")).toMatch(/valid email/i);
  });

  it("accepts a normal address, trimming whitespace", () => {
    expect(validateRecoveryEmail("  you@example.com ")).toBeNull();
  });
});

describe("recovery link and email text", () => {
  it("builds a link back to VAULTORA carrying the contract address", () => {
    const link = buildRecoveryLink(contractId, "https://vaultora-flax.vercel.app");
    expect(link).toBe(`https://vaultora-flax.vercel.app/?recovery=${contractId}#overview`);
  });

  it("includes the contract address and the no-restore warning in the body", () => {
    const body = buildRecoveryEmailBody({
      contractId,
      email: "you@example.com",
      origin: "https://vaultora-flax.vercel.app",
    });
    expect(body).toContain(contractId);
    expect(body).toContain("https://vaultora-flax.vercel.app/?recovery=");
    expect(body).toMatch(/cannot restore/i);
    expect(body).toMatch(/backup passkey/i);
    expect(body).toMatch(/holds no key/i);
  });

  it("builds a mailto link addressed to the recovery email", () => {
    const mailto = buildRecoveryMailto("you@example.com", contractId, "https://example.test");
    expect(mailto.startsWith("mailto:you%40example.com?")).toBe(true);
    expect(decodeURIComponent(mailto)).toContain(contractId);
    expect(decodeURIComponent(mailto)).toContain("cannot restore");
  });

  it("opens the mailto link through the injected opener and returns it", () => {
    const opened: string[] = [];
    const url = openRecoveryMailto("you@example.com", contractId, "https://example.test", (u) => {
      opened.push(u);
    });
    expect(opened).toEqual([url]);
    expect(url.startsWith("mailto:")).toBe(true);
  });
});

describe("recovery storage", () => {
  it("records an email and reports recovery as complete", () => {
    const storage = memoryStorage();
    expect(hasCompletedRecovery(contractId, storage)).toBe(false);
    const record = recordRecoveryEmail(contractId, "you@example.com", "mailto", storage);
    expect(record.email).toBe("you@example.com");
    expect(record.method).toBe("mailto");
    expect(record.backupPasskeyAdded).toBe(false);
    expect(record.sentAt).toBeTruthy();
    expect(hasCompletedRecovery(contractId, storage)).toBe(true);
    expect(getRecoveryRecord(contractId, storage)?.email).toBe("you@example.com");
  });

  it("keeps records per contract address", () => {
    const storage = memoryStorage();
    const other = "C" + "D".repeat(55);
    recordRecoveryEmail(contractId, "you@example.com", "copy", storage);
    expect(hasCompletedRecovery(other, storage)).toBe(false);
    expect(getRecoveryRecord(other, storage)).toBeNull();
  });

  it("records a backup passkey against the existing record", () => {
    const storage = memoryStorage();
    recordRecoveryEmail(contractId, "you@example.com", "copy", storage);
    const record = recordBackupPasskey(contractId, "cred-backup", storage);
    expect(record?.backupPasskeyAdded).toBe(true);
    expect(record?.backupCredentialId).toBe("cred-backup");
    expect(record?.email).toBe("you@example.com");
    expect(hasCompletedRecovery(contractId, storage)).toBe(true);
  });

  it("does not create a record from a backup passkey alone", () => {
    const storage = memoryStorage();
    expect(recordBackupPasskey(contractId, "cred-backup", storage)).toBeNull();
    expect(hasCompletedRecovery(contractId, storage)).toBe(false);
  });

  it("rejects an invalid email instead of recording it", () => {
    const storage = memoryStorage();
    expect(() => recordRecoveryEmail(contractId, "nope", "mailto", storage)).toThrow(/valid email/i);
    expect(hasCompletedRecovery(contractId, storage)).toBe(false);
  });

  it("tolerates restricted storage instead of crashing", () => {
    const failing: RecoveryStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(getRecoveryRecord(contractId, failing)).toBeNull();
    expect(hasCompletedRecovery(contractId, failing)).toBe(false);
    const record = recordRecoveryEmail(contractId, "you@example.com", "copy", failing);
    expect(record.email).toBe("you@example.com");
  });

  it("uses the documented storage key", () => {
    expect(RECOVERY_STORAGE_KEY).toBe("vaultora-passkey-recovery:v1");
  });
});
