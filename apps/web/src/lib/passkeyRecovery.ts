/**
 * Mandatory email recovery backup for a passkey smart-account wallet.
 *
 * HONEST DESIGN — read this before changing anything:
 *
 * An email address is NOT a cryptographic recovery key. It cannot by
 * itself restore a lost passkey, decrypt anything, or re-create a smart
 * account. There is no backend email service for wallet recovery in
 * this repo (the Supabase OTP flow in supabaseVault.ts is for encrypted
 * document cloud sync only and must not be conflated with this).
 *
 * What email does here:
 * 1. It records a recovery contact for the wallet (non-secret metadata
 *    only: contract address, email, when the details were sent/saved,
 *    and whether a backup passkey was enrolled).
 * 2. It delivers the wallet's contract address, a link back to
 *    VAULTORA, and the steps to add a backup passkey — via the user's
 *    own mail app (a `mailto:` link; VAULTORA sends nothing itself)
 *    or by copying the same text.
 * 3. It gives the user a reason to enroll a second passkey on another
 *    device *before* losing the first device. That second passkey is
 *    the actual backup; the email is only how the user finds their way
 *    back to enroll it.
 *
 * If the only passkey is lost and no backup passkey was ever enrolled,
 * the account is unrecoverable. The UI and docs must say that plainly
 * and must never claim otherwise.
 *
 * Nothing secret is stored here: no private keys, no seed phrases, no
 * passkey private material — only the public contract address and the
 * email the user typed. Storage is localStorage, guarded so restricted
 * storage never crashes the app.
 */

export const RECOVERY_STORAGE_KEY = "vaultora-passkey-recovery:v1";

export const RECOVERY_WARNING =
  "Email alone cannot restore this wallet. If you lose your only passkey and never added a backup passkey, the account is unrecoverable.";

export type RecoveryMethod = "mailto" | "copy";

export interface RecoveryRecord {
  /** Public smart-account contract address (C…). Never a secret. */
  contractId: string;
  email: string;
  /** ISO timestamp when the recovery details were sent/saved. */
  sentAt: string;
  method: RecoveryMethod;
  backupPasskeyAdded: boolean;
  backupCredentialId?: string;
}

export type RecoveryStorage = Pick<Storage, "getItem" | "setItem">;

function defaultOrigin(): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return "https://vaultora-flax.vercel.app";
}

/** Returns an error message, or null when the address is acceptable. */
export function validateRecoveryEmail(email: string): string | null {
  const value = email.trim();
  if (!value) return "Enter an email address to back up your wallet.";
  if (value.length > 254) return "That email address is too long.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
    return "Enter a valid email address, for example you@example.com.";
  }
  return null;
}

/**
 * Link back to VAULTORA for the recovery email. The contract id travels
 * as a query parameter only so the user can see which wallet it belongs
 * to; it is a public address, never a secret.
 */
export function buildRecoveryLink(contractId: string, origin: string = defaultOrigin()): string {
  if (!contractId.trim()) throw new Error("A wallet address is required to build a recovery link.");
  const base = origin.replace(/\/+$/, "");
  return `${base}/?recovery=${encodeURIComponent(contractId.trim())}#overview`;
}

export function buildRecoveryEmailBody(args: {
  contractId: string;
  email: string;
  origin?: string;
}): string {
  const contractId = args.contractId.trim();
  if (!contractId) throw new Error("A wallet address is required to build recovery details.");
  const link = buildRecoveryLink(contractId, args.origin ?? defaultOrigin());
  return [
    "VAULTORA wallet recovery details",
    "",
    `Your Stellar Testnet smart-account wallet: ${contractId}`,
    `Open VAULTORA: ${link}`,
    "",
    "What this email does:",
    "- It records this email as your recovery contact for the wallet above.",
    "- It gives you the wallet address and a link back to VAULTORA.",
    "",
    "How to add a backup passkey (do this before losing your first device):",
    "1. Open VAULTORA from the link above and connect with your passkey.",
    "2. Open the wallet menu and choose to add a backup passkey.",
    "3. Approve the passkey prompt on the second device. That second",
    "   passkey can then connect the same wallet on its own.",
    "",
    `IMPORTANT: ${RECOVERY_WARNING}`,
    "This email holds no key, seed phrase, or passkey material, and",
    "VAULTORA never sends wallet recovery emails from a server.",
    "",
    "Testnet only — Testnet XLM has no real monetary value.",
  ].join("\n");
}

export function buildRecoveryMailto(
  email: string,
  contractId: string,
  origin?: string,
): string {
  const to = email.trim();
  const subject = "Your VAULTORA wallet recovery details";
  const body = buildRecoveryEmailBody({ contractId, email: to, origin });
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export type MailtoOpener = (url: string) => void;

function defaultMailtoOpener(url: string): void {
  if (typeof window === "undefined") return;
  try {
    window.location.href = url;
  } catch {
    // Opening the mail app is best-effort; the caller still records
    // that the user chose to send the details.
  }
}

/**
 * Opens the user's own mail app with the recovery details pre-filled.
 * Returns the mailto URL. VAULTORA sends nothing itself and cannot
 * confirm delivery — the caller must ask the user to confirm they sent
 * or saved it.
 */
export function openRecoveryMailto(
  email: string,
  contractId: string,
  origin?: string,
  opener: MailtoOpener = defaultMailtoOpener,
): string {
  const url = buildRecoveryMailto(email, contractId, origin);
  opener(url);
  return url;
}

function getStorage(storage?: RecoveryStorage | null): RecoveryStorage | null {
  if (storage) return storage;
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  } catch {
    return null;
  }
  return null;
}

function readAll(storage?: RecoveryStorage | null): Record<string, RecoveryRecord> {
  const store = getStorage(storage);
  if (!store) return {};
  try {
    const raw = store.getItem(RECOVERY_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, RecoveryRecord>;
  } catch {
    return {};
  }
}

function writeAll(records: Record<string, RecoveryRecord>, storage?: RecoveryStorage | null): void {
  const store = getStorage(storage);
  if (!store) return;
  try {
    store.setItem(RECOVERY_STORAGE_KEY, JSON.stringify(records));
  } catch {
    // Restricted storage must not crash the app; the in-memory record
    // is still returned to the caller.
  }
}

export function getRecoveryRecord(
  contractId: string,
  storage?: RecoveryStorage | null,
): RecoveryRecord | null {
  if (!contractId.trim()) return null;
  return readAll(storage)[contractId.trim()] ?? null;
}

/** True only when an email was recorded for this wallet. */
export function hasCompletedRecovery(
  contractId: string,
  storage?: RecoveryStorage | null,
): boolean {
  const record = getRecoveryRecord(contractId, storage);
  return Boolean(record && record.email.trim());
}

export function recordRecoveryEmail(
  contractId: string,
  email: string,
  method: RecoveryMethod,
  storage?: RecoveryStorage | null,
): RecoveryRecord {
  const trimmedContract = contractId.trim();
  if (!trimmedContract) throw new Error("A wallet address is required to record recovery.");
  const validation = validateRecoveryEmail(email);
  if (validation) throw new Error(validation);
  const records = readAll(storage);
  const existing = records[trimmedContract];
  const record: RecoveryRecord = {
    contractId: trimmedContract,
    email: email.trim(),
    sentAt: new Date().toISOString(),
    method,
    backupPasskeyAdded: existing?.backupPasskeyAdded ?? false,
    ...(existing?.backupCredentialId ? { backupCredentialId: existing.backupCredentialId } : {}),
  };
  records[trimmedContract] = record;
  writeAll(records, storage);
  return record;
}

export function recordBackupPasskey(
  contractId: string,
  credentialId: string,
  storage?: RecoveryStorage | null,
): RecoveryRecord | null {
  const trimmedContract = contractId.trim();
  if (!trimmedContract || !credentialId.trim()) return null;
  const records = readAll(storage);
  const existing = records[trimmedContract];
  if (!existing) return null;
  const record: RecoveryRecord = {
    ...existing,
    backupPasskeyAdded: true,
    backupCredentialId: credentialId.trim(),
  };
  records[trimmedContract] = record;
  writeAll(records, storage);
  return record;
}
