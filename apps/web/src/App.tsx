import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { FormEvent, ReactNode, SVGProps } from "react";
import {
  addActivity,
  createVaultSession,
  decryptDocument,
  deleteDocument,
  deleteSavedLink,
  deleteWorkspace,
  getVaultStorageEstimate,
  hasLocalVault,
  listActivity,
  listDocuments,
  listSavedLinks,
  listWorkspaces,
  metadataFingerprint,
  saveDocument,
  saveSavedLink,
  saveWorkspace,
  lockVaultSession,
  unlockVaultSession,
  updateDocument,
  type VaultDocument,
  type VaultDocumentMetadata,
  type VaultActivity,
  type VaultSavedLink,
  type VaultSession,
  type VaultWorkspace,
} from "./lib/localVault";
import { sha256File } from "./lib/fileHash";
import { defaultSorobanConfig, explorerTransactionUrl, STELLAR_TESTNET_PASSPHRASE, type DocumentOperation } from "./lib/sorobanConfig";
import { initialTransactionState, transactionReducer } from "./lib/transactionState";
import { connectWallet, disconnectWallet, walletErrorMessage, type ConnectedWallet } from "./lib/wallet";
import { cleanInterfaceMessage } from "./lib/uiText";
import type { ContractOperationResult } from "./lib/soroban";
import {
  decodeCloudBytes,
  inspectCloudVault,
  isSupabaseConfigured,
  requestCloudSignInLink,
  signOutCloudAccount,
  subscribeToCloudAuth,
  synchronizeEncryptedDocuments,
  validateCloudVaultPassphrase,
  type CloudSyncResult,
  type CloudVaultInfo,
} from "./lib/supabaseVault";

type IconName =
  | "overview" | "documents" | "recent" | "star" | "share" | "spaces" | "link" | "note"
  | "shield" | "ledger" | "activity" | "settings" | "search" | "menu" | "close" | "plus"
  | "file" | "upload" | "arrow" | "external" | "chevron" | "lock" | "wallet" | "network"
  | "check" | "alert" | "download" | "trash" | "edit" | "dots" | "filter" | "sort" | "spark";

type Section =
  | "overview" | "all-documents" | "recent" | "starred" | "shared-with-me" | "project-spaces"
  | "saved-links" | "notes" | "recovery-shield" | "integrity-ledger" | "security-activity" | "settings" | "document-detail";

type IconProps = SVGProps<SVGSVGElement> & { name: IconName; size?: number };

const paths: Record<IconName, ReactNode> = {
  overview: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /></>,
  documents: <><path d="M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10Z" /><path d="M13 3v7h7M8 15h8M8 18h5" /></>,
  recent: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  star: <><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z" /></>,
  share: <><path d="M16 8a3 3 0 1 0-2.8-4" /><path d="M8 14a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" /><path d="m10.5 15.2 4.4-4.3M9.8 13.8l4.7-5" /></>,
  spaces: <><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5Z" /><path d="M3.5 10h17" /></>,
  link: <><path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.2 1.2" /><path d="M14 11a5 5 0 0 0-7.1 0l-2 2A5 5 0 0 0 12 20.1l1.2-1.2" /></>,
  note: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" /><path d="M14 3v6h6M8 14h8M8 18h6" /></>,
  shield: <><path d="M12 3 19 6v5.4c0 4.5-2.9 7.6-7 9.6-4.1-2-7-5.1-7-9.6V6l7-3Z" /><path d="m9 12 2 2 4-4" /></>,
  ledger: <><path d="M5 4h14a2 2 0 0 1 2 2v14H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" /><path d="M7 8h10M7 12h10M7 16h6M3 8h2M3 12h2M3 16h2" /></>,
  activity: <><path d="M3 12h4l3-8 4 16 3-8h4" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1a1.7 1.7 0 0 1-2.4 2.4l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a1.7 1.7 0 0 1-3.4 0v-.2a1.7 1.7 0 0 0-2.9-1.2l-.1.1a1.7 1.7 0 0 1-2.4-2.4l.1-.1a1.7 1.7 0 0 0-1.2-2.9H4a1.7 1.7 0 0 1 0-3.4h.2a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a1.7 1.7 0 0 1 2.4-2.4l.1.1a1.7 1.7 0 0 0 2.9-1.2V2a1.7 1.7 0 0 1 3.4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a1.7 1.7 0 0 1 2.4 2.4l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a1.7 1.7 0 0 1 0 3.4h-.2a1.7 1.7 0 0 0-1.2 2.9Z" /></>,
  search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 5 5" /></>,
  menu: <><path d="M4 6h16M4 12h16M4 18h16" /></>,
  close: <><path d="m6 6 12 12M18 6 6 18" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  file: <><path d="M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10Z" /><path d="M13 3v7h7" /></>,
  upload: <><path d="M12 16V4m0 0L7 9m5-5 5 5" /><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></>,
  arrow: <><path d="M7 17 17 7M7 7h10v10" /></>,
  external: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" /></>,
  chevron: <><path d="m9 18 6-6-6-6" /></>,
  lock: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 1 1 8 0v3" /></>,
  wallet: <><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H20v14H5.5A2.5 2.5 0 0 1 3 16.5Z" /><path d="M3 8h14a3 3 0 0 1 3 3v2h-4a2 2 0 0 0 0 4h4M16 13h.01" /></>,
  network: <><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4" /></>,
  check: <><path d="m5 12 4 4L19 6" /></>,
  alert: <><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></>,
  download: <><path d="M12 4v12m0 0 5-5m-5 5-5-5" /><path d="M4 20h16" /></>,
  trash: <><path d="M3 6h18M8 6V4h8v2m3 0-.8 14H5.8L5 6m4 4v6m6-6v6" /></>,
  edit: <><path d="m4 16.5-.8 4.3 4.3-.8L19 8.5 15.5 5 4 16.5Z" /><path d="m13.5 7 3.5 3.5" /></>,
  dots: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  filter: <><path d="M4 6h16M7 12h10m-7 6h4" /></>,
  sort: <><path d="M7 4v16m0 0-3-3m3 3 3-3M17 20V4m0 0-3 3m3-3 3 3" /></>,
  spark: <><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" /><path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z" /></>,
};

function Icon({ name, size = 18, ...props }: IconProps) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...props}>{paths[name]}</svg>;
}

const navigation: { group: string; items: { id: Section; label: string; icon: IconName }[] }[] = [
  { group: "OVERVIEW", items: [{ id: "overview", label: "Overview", icon: "overview" }] },
  { group: "MY VAULT", items: [
    { id: "all-documents", label: "All Documents", icon: "documents" },
    { id: "recent", label: "Recent", icon: "recent" },
    { id: "starred", label: "Starred", icon: "star" },
    { id: "shared-with-me", label: "Shared With Me", icon: "share" },
  ] },
  { group: "WORKSPACES", items: [
    { id: "project-spaces", label: "Project Spaces", icon: "spaces" },
    { id: "saved-links", label: "Saved Links", icon: "link" },
    { id: "notes", label: "Notes", icon: "note" },
  ] },
  { group: "SECURITY", items: [
    { id: "recovery-shield", label: "Recovery Shield", icon: "shield" },
    { id: "integrity-ledger", label: "Integrity Ledger", icon: "ledger" },
    { id: "security-activity", label: "Security Activity", icon: "activity" },
  ] },
  { group: "PREFERENCES", items: [{ id: "settings", label: "Settings", icon: "settings" }] },
];

const pageTitles: Record<Section, string> = {
  overview: "Overview", "all-documents": "All Documents", recent: "Recent", starred: "Starred",
  "shared-with-me": "Shared With Me", "project-spaces": "Project Spaces", "saved-links": "Saved Links",
  notes: "Notes", "recovery-shield": "Recovery Shield", "integrity-ledger": "Integrity Ledger",
  "security-activity": "Security Activity", settings: "Settings", "document-detail": "Document Details",
};

const supportedAccept = ".pdf,.docx,.xlsx,.xls,.png,.jpg,.jpeg,.txt";
const IDLE_LOCK_MS = 15 * 60 * 1000;

function sectionFromHash(): Section {
  const name = window.location.hash.replace(/^#/, "").split("/")[0] as Section;
  return name in pageTitles ? name : "overview";
}

function shortAddress(address: string): string { return `${address.slice(0, 5)}…${address.slice(-5)}`; }
function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1_048_576) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1_048_576).toFixed(1)} MB`;
}
function formatDate(value?: string): string {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}
function formatDateTime(value?: string): string {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}
function fileKind(metadata: VaultDocumentMetadata): string {
  const ext = metadata.fileName.split(".").pop()?.toUpperCase();
  return ext && ext !== metadata.fileName.toUpperCase() ? ext : "FILE";
}
function isSafeWebUrl(value: string): boolean {
  try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:"; }
  catch { return false; }
}

function activityIcon(type: string): IconName {
  if (type.startsWith("document.")) return "file";
  if (type.startsWith("workspace.")) return "spaces";
  if (type.startsWith("link.")) return "link";
  if (type.startsWith("integrity.register")) return "ledger";
  return "shield";
}

function activityDescription(type: string): string {
  const descriptions: Record<string, string> = {
    "vault.created": "Encrypted local vault created",
    "document.saved": "Encrypted and saved in this browser",
    "document.downloaded": "Decrypted locally for download",
    "document.deleted": "Removed from this browser",
    "document.renamed": "Document details updated",
    "document.starred": "Added to Starred",
    "document.unstarred": "Removed from Starred",
    "document.moved": "Project space updated",
    "workspace.created": "Project space created",
    "workspace.updated": "Project space updated",
    "workspace.deleted": "Project space deleted",
    "link.saved": "Saved in encrypted local vault",
    "link.updated": "Saved link updated",
    "link.deleted": "Saved link deleted",
    "integrity.submitted": "Submitted to Stellar Testnet; confirmation pending",
    "integrity.registered": "Confirmed on Stellar Testnet",
    "integrity.verified": "Fingerprint matched on Stellar Testnet",
    "integrity.not-registered": "No matching Testnet record for this wallet",
    "integrity.registration-failed": "Registration was not confirmed",
    "integrity.verification-failed": "Read-only verification could not complete",
  };
  return descriptions[type] ?? "Vault activity";
}

function Brand() {
  return <a href="#overview" className="brand" aria-label="VAULTORA overview"><span className="brand-mark"><Icon name="shield" size={19} /></span><span className="brand-name">VAULTORA<span>.</span></span></a>;
}

function AccessScreen({
  mode, busy, error, onSubmit, cloudControls, onCancelRestore,
}: { mode: "checking" | "setup" | "locked" | "restore"; busy: boolean; error: string; onSubmit: (passphrase: string, confirmation?: string) => void; cloudControls: ReactNode; onCancelRestore: () => void }) {
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  if (mode === "checking") return <main className="access-shell"><div className="access-card"><Brand /><p className="muted">Checking this device…</p></div></main>;
  const create = mode === "setup";
  const restore = mode === "restore";
  return (
    <main className="access-shell">
      <section className="access-card">
        <Brand />
        <span className="access-kicker"><Icon name={create ? "spark" : "lock"} size={15} /> {restore ? "ENCRYPTED CLOUD VAULT" : "ENCRYPTED ON THIS DEVICE"}</span>
        <h1>{create ? "Set up your vault" : restore ? "Restore your cloud vault" : "Unlock your vault"}</h1>
        <p>{create ? "Choose a vault passphrase. It encrypts your files and private details before they are saved in this browser." : restore ? "Use the vault passphrase that protects your encrypted cloud documents. Supabase sign-in does not decrypt them." : "Enter the vault passphrase you chose on this device. It is not sent to a server."}</p>
        <form onSubmit={(event) => { event.preventDefault(); onSubmit(passphrase, create ? confirmation : undefined); }}>
          <label className="field-label" htmlFor="vault-passphrase">Vault passphrase</label>
          <input id="vault-passphrase" type="password" autoComplete={create ? "new-password" : "current-password"} value={passphrase} onChange={(event) => setPassphrase(event.currentTarget.value)} minLength={12} required autoFocus />
          {create && <><label className="field-label" htmlFor="vault-confirmation">Confirm passphrase</label><input id="vault-confirmation" type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.currentTarget.value)} minLength={12} required /><small className="field-hint">Use at least 12 characters. If you lose it, this device cannot decrypt your files.</small></>}
          {error && <div role="alert" className="form-error"><Icon name="alert" size={16} />{error}</div>}
          <button className="button button-primary access-submit" type="submit" disabled={busy}>{busy ? "Working…" : create ? "Create encrypted vault" : restore ? "Restore encrypted documents" : "Unlock vault"}</button>
        </form>
        {restore && <button className="text-link access-cancel-restore" onClick={onCancelRestore}>Use device-only setup instead</button>}
        {cloudControls}
      </section>
    </main>
  );
}

function App() {
  const [accessMode, setAccessMode] = useState<"checking" | "setup" | "locked" | "restore">("checking");
  const [session, setSession] = useState<VaultSession | null>(null);
  const sessionRef = useRef<VaultSession | null>(null);
  const [accessBusy, setAccessBusy] = useState(false);
  const [accessError, setAccessError] = useState("");
  const [cloudConfigured] = useState(isSupabaseConfigured);
  const [cloudAccount, setCloudAccount] = useState<string | null>(null);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudError, setCloudError] = useState("");
  const [cloudMessage, setCloudMessage] = useState("");
  const [cloudVaultInfo, setCloudVaultInfo] = useState<CloudVaultInfo | null>(null);
  const [cloudSyncResult, setCloudSyncResult] = useState<CloudSyncResult | null>(null);
  const [section, setSection] = useState<Section>(() => sectionFromHash());
  const [documents, setDocuments] = useState<VaultDocument[]>([]);
  const [workspaces, setWorkspaces] = useState<VaultWorkspace[]>([]);
  const [savedLinks, setSavedLinks] = useState<VaultSavedLink[]>([]);
  const [activityRecords, setActivityRecords] = useState<VaultActivity[]>([]);
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletError, setWalletError] = useState("");
  const [notice, setNotice] = useState("");
  const [operationError, setOperationError] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeWorkspaceId, setActiveWorkspaceId] = useState("");
  const [documentSort, setDocumentSort] = useState<"newest" | "oldest" | "name" | "size">("newest");
  const [selectedDocumentId, setSelectedDocumentId] = useState("");
  const [documentBusy, setDocumentBusy] = useState(false);
  const [transaction, dispatchTransaction] = useReducer(transactionReducer, initialTransactionState);
  const [transactionDocumentId, setTransactionDocumentId] = useState("");
  const [lastOperation, setLastOperation] = useState<DocumentOperation | null>(null);
  const [registryResult, setRegistryResult] = useState("");
  const [registryDocumentId, setRegistryDocumentId] = useState("");
  const [ledgerFilter, setLedgerFilter] = useState("all");
  const [modal, setModal] = useState<"workspace" | "link" | null>(null);
  const [editingWorkspace, setEditingWorkspace] = useState<VaultWorkspace | null>(null);
  const [editingLink, setEditingLink] = useState<VaultSavedLink | null>(null);
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceDescription, setWorkspaceDescription] = useState("");
  const [workspaceIcon, setWorkspaceIcon] = useState("folder");
  const [linkTitle, setLinkTitle] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkDescription, setLinkDescription] = useState("");
  const [linkCategory, setLinkCategory] = useState("Reference");
  const [linkTags, setLinkTags] = useState("");
  const [detailRename, setDetailRename] = useState("");
  const [renameEditing, setRenameEditing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const commandInputRef = useRef<HTMLInputElement>(null);
  const contractReady = Boolean(defaultSorobanConfig.contractId);

  const refreshData = useCallback(async (activeSession: VaultSession) => {
    const [nextDocuments, nextWorkspaces, nextLinks, nextActivity] = await Promise.all([
      listDocuments(activeSession), listWorkspaces(activeSession), listSavedLinks(activeSession), listActivity(activeSession),
    ]);
    if (sessionRef.current !== activeSession) return;
    setDocuments(nextDocuments);
    setWorkspaces(nextWorkspaces);
    setSavedLinks(nextLinks);
    setActivityRecords(nextActivity);
  }, []);

  const clearPrivateView = useCallback(() => {
    setDocuments([]); setWorkspaces([]); setSavedLinks([]); setActivityRecords([]);
    setSelectedDocumentId(""); setActiveWorkspaceId(""); setSearchQuery("");
    setCommandQuery(""); setCommandOpen(false); setModal(null);
    setEditingWorkspace(null); setEditingLink(null); setWorkspaceName("");
    setWorkspaceDescription(""); setWorkspaceIcon("folder"); setLinkTitle(""); setLinkUrl("");
    setLinkDescription(""); setLinkCategory("Reference"); setLinkTags(""); setNotice("");
    setDetailRename(""); setRenameEditing(false); setRegistryResult("");
    setRegistryDocumentId(""); setOperationError(""); setWalletError("");
    setLastOperation(null); setTransactionDocumentId("");
    dispatchTransaction({ type: "RESET" });
  }, []);

  async function recordActivity(activeSession: VaultSession, activity: VaultActivity) {
    if (sessionRef.current !== activeSession) return;
    try {
      await addActivity(activeSession, activity);
      if (sessionRef.current !== activeSession) return;
      const records = await listActivity(activeSession);
      if (sessionRef.current === activeSession) setActivityRecords(records);
    } catch {
      if (sessionRef.current === activeSession) setOperationError("The change succeeded, but its encrypted activity record could not be saved.");
    }
  }

  useEffect(() => {
    let alive = true;
    void hasLocalVault().then((exists) => { if (alive) setAccessMode(exists ? "locked" : "setup"); }).catch(() => { if (alive) { setAccessMode("setup"); setAccessError("This browser could not open local vault storage."); } });
    const onHashChange = () => setSection(sectionFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => { alive = false; window.removeEventListener("hashchange", onHashChange); };
  }, []);

  useEffect(() => subscribeToCloudAuth((email) => {
    setCloudAccount(email);
    if (!email) setCloudVaultInfo(null);
  }), []);

  useEffect(() => {
    if (!session) return undefined;
    let lastActivityAt = Date.now();
    let timer: number;
    const expire = () => {
      if (Date.now() - lastActivityAt < IDLE_LOCK_MS) {
        timer = window.setTimeout(expire, IDLE_LOCK_MS - (Date.now() - lastActivityAt));
        return;
      }
      sessionRef.current = null;
      lockVaultSession(session);
      clearPrivateView();
      setAccessMode("locked"); setNotice("Vault locked after 15 minutes of inactivity.");
      setSession(null);
    };
    const recordActivity = () => {
      lastActivityAt = Date.now();
      window.clearTimeout(timer);
      timer = window.setTimeout(expire, IDLE_LOCK_MS);
    };
    const checkOnReturn = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastActivityAt >= IDLE_LOCK_MS) expire();
      else recordActivity();
    };
    timer = window.setTimeout(expire, IDLE_LOCK_MS);
    window.addEventListener("pointerdown", recordActivity, { passive: true });
    window.addEventListener("keydown", recordActivity);
    document.addEventListener("visibilitychange", checkOnReturn);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", recordActivity);
      window.removeEventListener("keydown", recordActivity);
      document.removeEventListener("visibilitychange", checkOnReturn);
      lockVaultSession(session);
    };
  }, [session, clearPrivateView]);

  useEffect(() => {
    try { setCollapsed(window.localStorage.getItem("vaultora-rail-collapsed") === "true"); } catch { /* Browser storage may be restricted. */ }
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setCommandOpen(true); setCommandQuery(""); }
      if (event.key === "Escape") { setCommandOpen(false); setDrawerOpen(false); setModal(null); }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => { if (commandOpen) window.setTimeout(() => commandInputRef.current?.focus(), 20); }, [commandOpen]);
  useEffect(() => {
    const selected = documents.find((doc) => doc.id === selectedDocumentId);
    if (selected) setDetailRename(selected.metadata.fileName);
  }, [documents, selectedDocumentId]);

  function navigate(next: Section) {
    setSection(next);
    setDrawerOpen(false);
    if (window.location.hash !== `#${next}`) window.location.hash = next;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleRequestCloudLink(email: string) {
    setCloudBusy(true); setCloudError(""); setCloudMessage("");
    try {
      await requestCloudSignInLink(email);
      setCloudMessage("Sign-in link sent. Open it on this device to connect your cloud account.");
    } catch (error) {
      setCloudError(cleanInterfaceMessage(error instanceof Error ? error.message : "The cloud sign-in link could not be sent."));
    } finally { setCloudBusy(false); }
  }

  async function handleInspectCloud() {
    setCloudBusy(true); setCloudError(""); setCloudMessage(""); setCloudSyncResult(null);
    try {
      const info = await inspectCloudVault();
      setCloudVaultInfo(info);
      const localExists = await hasLocalVault();
      if (!localExists && info.documentCount > 0) {
        setAccessMode("restore");
        setCloudMessage(`${info.documentCount} encrypted document${info.documentCount === 1 ? "" : "s"} found. Enter the vault passphrase to restore them.`);
      } else if (!info.documentCount) {
        setCloudMessage("No encrypted documents are synced to this account yet.");
      } else {
        setCloudMessage(`${info.documentCount} encrypted document${info.documentCount === 1 ? "" : "s"} found. Unlock this device vault, then run Sync to compare copies.`);
      }
    } catch (error) {
      setCloudError(cleanInterfaceMessage(error instanceof Error ? error.message : "The cloud vault could not be checked."));
    } finally { setCloudBusy(false); }
  }

  async function handleSignOutCloud() {
    setCloudBusy(true); setCloudError(""); setCloudMessage("");
    try {
      await signOutCloudAccount();
      setCloudVaultInfo(null); setCloudSyncResult(null);
      if (accessMode === "restore") setAccessMode("setup");
      setCloudMessage("Cloud account signed out. This device vault was not changed.");
    } catch (error) {
      setCloudError(cleanInterfaceMessage(error instanceof Error ? error.message : "The cloud account could not be signed out."));
    } finally { setCloudBusy(false); }
  }

  async function handleCloudSync() {
    const activeSession = session;
    if (!activeSession) return;
    setCloudBusy(true); setCloudError(""); setCloudMessage(""); setCloudSyncResult(null);
    try {
      const result = await synchronizeEncryptedDocuments(activeSession);
      if (sessionRef.current !== activeSession) return;
      await refreshData(activeSession);
      if (sessionRef.current !== activeSession) return;
      setCloudSyncResult(result);
      setCloudVaultInfo(await inspectCloudVault());
      setCloudMessage(result.uploaded + result.downloaded + result.deleted === 0
        ? "Encrypted documents are already in sync."
        : `Sync complete. ${result.uploaded} uploaded, ${result.downloaded} downloaded, ${result.deleted} deletion${result.deleted === 1 ? "" : "s"} applied.`);
    } catch (error) {
      if (sessionRef.current === activeSession) setCloudError(cleanInterfaceMessage(error instanceof Error ? error.message : "Encrypted document sync could not complete."));
    } finally { setCloudBusy(false); }
  }

  async function handleAccess(passphrase: string, confirmation?: string) {
    setAccessBusy(true); setAccessError("");
    let openedSession: VaultSession | null = null;
    try {
      if (accessMode === "setup") {
        if (passphrase.length < 12) throw new Error("Use a passphrase with at least 12 characters.");
        if (passphrase !== confirmation) throw new Error("The passphrases do not match.");
        openedSession = await createVaultSession(passphrase);
        sessionRef.current = openedSession;
        await refreshData(openedSession);
        await recordActivity(openedSession, { type: "vault.created", at: new Date().toISOString(), entityId: "vault", label: "Encrypted vault created" });
        await refreshData(openedSession);
        setSession(openedSession); setAccessMode("locked");
        setNotice("Encrypted vault created on this device.");
      } else if (accessMode === "restore") {
        if (!cloudConfigured || !cloudAccount || !cloudVaultInfo?.vaultSalt) throw new Error("Connect a cloud account and check its encrypted documents before restoring.");
        const verifiedSalt = await validateCloudVaultPassphrase(passphrase);
        if (verifiedSalt !== cloudVaultInfo.vaultSalt) throw new Error("The cloud vault changed while it was being restored. Check it again and retry.");
        openedSession = await createVaultSession(passphrase, { vaultSalt: new Uint8Array(decodeCloudBytes(verifiedSalt)) });
        sessionRef.current = openedSession;
        const result = await synchronizeEncryptedDocuments(openedSession);
        if (sessionRef.current !== openedSession) return;
        await refreshData(openedSession);
        if (sessionRef.current !== openedSession) return;
        setSession(openedSession); setAccessMode("locked"); setCloudSyncResult(result);
        setCloudMessage(`Restored ${result.downloaded} encrypted document${result.downloaded === 1 ? "" : "s"}.`);
        setNotice("Cloud documents restored and decrypted locally. Your passphrase was not sent to Supabase.");
      } else {
        openedSession = await unlockVaultSession(passphrase);
        sessionRef.current = openedSession;
        await refreshData(openedSession); setSession(openedSession); setAccessMode("locked"); setNotice("Vault unlocked on this device.");
      }
    } catch (error) {
      if (openedSession && sessionRef.current === openedSession) {
        sessionRef.current = null;
        lockVaultSession(openedSession);
        setSession(null);
        clearPrivateView();
        setAccessMode("locked");
      }
      setAccessError(cleanInterfaceMessage(error instanceof Error ? error.message : "The vault could not be opened."));
    } finally { setAccessBusy(false); }
  }

  function lockVault() {
    sessionRef.current = null;
    if (session) lockVaultSession(session);
    clearPrivateView();
    setAccessMode("locked"); setNotice("Vault locked. Private content was cleared from the current view.");
    setSession(null);
  }

  async function handleConnect() {
    setWalletBusy(true); setWalletError("");
    try { setWallet(await connectWallet()); }
    catch (error) { setWalletError(walletErrorMessage(error)); }
    finally { setWalletBusy(false); }
  }

  async function handleDisconnect() {
    setWalletBusy(true); setWalletError("");
    try { await disconnectWallet(); setWallet(null); }
    catch (error) { setWalletError(walletErrorMessage(error)); }
    finally { setWalletBusy(false); }
  }

  async function handleUpload(file?: File) {
    if (!session || documentBusy) return;
    setOperationError(""); setNotice("");
    if (!file) { setOperationError("Choose a document to encrypt and save."); return; }
    setLastOperation(null); setTransactionDocumentId(""); dispatchTransaction({ type: "RESET" });
    setDocumentBusy(true);
    try {
      const saved = await saveDocument(session, file, activeWorkspaceId || undefined);
      if (sessionRef.current !== session) return;
      await recordActivity(session, { type: "document.saved", at: new Date().toISOString(), entityId: saved.id, label: `Document saved: ${saved.metadata.fileName}` });
      if (sessionRef.current !== session) return;
      await refreshData(session);
      if (sessionRef.current !== session) return;
      setSelectedDocumentId(saved.id);
      navigate("document-detail");
      setNotice("Document encrypted and saved in this browser.");
    } catch (error) {
      if (sessionRef.current !== session) return;
      setOperationError(cleanInterfaceMessage(error instanceof Error ? error.message : "The document could not be encrypted and saved."));
    } finally {
      setDocumentBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleDownload(documentId: string) {
    if (!session || documentBusy) return;
    setDocumentBusy(true); setOperationError("");
    try {
      const decrypted = await decryptDocument(session, documentId);
      if (sessionRef.current !== session) return;
      const url = URL.createObjectURL(decrypted.blob);
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = decrypted.metadata.fileName; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      await recordActivity(session, { type: "document.downloaded", at: new Date().toISOString(), entityId: documentId, label: `Document downloaded: ${decrypted.metadata.fileName}` });
      if (sessionRef.current !== session) return;
      await refreshData(session);
      if (sessionRef.current !== session) return;
      setNotice("Document decrypted locally and downloaded.");
    } catch (error) { if (sessionRef.current === session) setOperationError(cleanInterfaceMessage(error instanceof Error ? error.message : "The document could not be decrypted.")); }
    finally { setDocumentBusy(false); }
  }

  async function handleDeleteDocument(doc: VaultDocument) {
    if (!session || !window.confirm(`Delete ${doc.metadata.fileName} from this device? This cannot be undone.`)) return;
    try {
      await deleteDocument(session, doc.id);
      if (sessionRef.current !== session) return;
      await recordActivity(session, { type: "document.deleted", at: new Date().toISOString(), entityId: doc.id, label: `Document deleted: ${doc.metadata.fileName}` });
      if (sessionRef.current !== session) return;
      await refreshData(session);
      if (sessionRef.current !== session) return;
      setSelectedDocumentId(""); navigate("all-documents"); setNotice("Document deleted from this device.");
    } catch (error) { if (sessionRef.current === session) setOperationError(cleanInterfaceMessage(error instanceof Error ? error.message : "The document could not be deleted.")); }
  }

  async function handleUpdateDocument(id: string, patch: Partial<VaultDocumentMetadata>) {
    if (!session) return;
    try {
      const current = documents.find((doc) => doc.id === id);
      const activityType = patch.starred !== undefined ? patch.starred ? "document.starred" : "document.unstarred" : Object.prototype.hasOwnProperty.call(patch, "workspaceId") ? "document.moved" : "document.renamed";
      const label = patch.fileName ? `Document renamed: ${current?.metadata.fileName ?? "document"} to ${patch.fileName}` : `${activityDescription(activityType)}: ${current?.metadata.fileName ?? "Document"}`;
      await updateDocument(session, id, patch);
      if (sessionRef.current !== session) return;
      await recordActivity(session, { type: activityType, at: new Date().toISOString(), entityId: id, label });
      if (sessionRef.current !== session) return;
      await refreshData(session);
      if (sessionRef.current !== session) return;
      setNotice("Document details updated."); setRenameEditing(false);
    } catch (error) { if (sessionRef.current === session) setOperationError(cleanInterfaceMessage(error instanceof Error ? error.message : "The document details could not be updated.")); }
  }

  async function handleRegistryOperation(doc: VaultDocument, operation: DocumentOperation) {
    if (!session || !wallet || !contractReady || documentBusy) return;
    const activeSession = session;
    const activeWallet = wallet;
    if (!wallet.network || wallet.network.networkPassphrase !== STELLAR_TESTNET_PASSPHRASE) {
      setWalletError("The connected wallet must be on Stellar Testnet. Switch networks and reconnect before registering."); return;
    }
    setWalletError(""); setOperationError(""); setRegistryResult(""); setRegistryDocumentId(doc.id); setDocumentBusy(true);
    dispatchTransaction({ type: "RESET" });
    setTransactionDocumentId(operation === "register" ? doc.id : "");
    if (operation === "register") dispatchTransaction({ type: "START" });
    setLastOperation(operation);
    try {
      let result: ContractOperationResult;
      try {
        const decrypted = await decryptDocument(activeSession, doc.id);
        if (sessionRef.current !== activeSession) return;
        const original = new File([decrypted.blob], decrypted.metadata.fileName, { type: decrypted.metadata.mimeType });
        const { digest } = await sha256File(original);
        if (sessionRef.current !== activeSession) return;
        if (digest !== doc.metadata.digest) throw new Error("The decrypted document fingerprint does not match its saved record.");
        const { invokeDocumentContract } = await import("./lib/soroban");
        if (sessionRef.current !== activeSession) return;
        const metadataDigest = operation === "register" ? await metadataFingerprint(activeSession, doc.id) : undefined;
        if (sessionRef.current !== activeSession) return;
        result = await invokeDocumentContract({
          operation, digest, metadataDigest,
          sourceAddress: activeWallet.address, config: defaultSorobanConfig,
          onStage: (stage, hash) => {
            if (sessionRef.current !== activeSession) return;
            if (stage === "preparing") dispatchTransaction({ type: "START" });
            if (stage === "awaiting_authorization") dispatchTransaction({ type: "REQUEST_AUTHORIZATION" });
            if (stage === "submitted" && hash) dispatchTransaction({ type: "SUBMITTED", hash });
          },
        });
      } catch (error) {
        if (sessionRef.current !== activeSession) return;
        const txHash = typeof error === "object" && error !== null && "transactionHash" in error && typeof error.transactionHash === "string" ? error.transactionHash : undefined;
        const now = new Date().toISOString();
        const message = cleanInterfaceMessage(error instanceof Error ? error.message : "The registry operation failed.");
        if (operation === "register") {
          dispatchTransaction({ type: "FAILED", message, hash: txHash });
          if (!["registered", "verified"].includes(doc.metadata.verificationState ?? "")) {
            try {
              await updateDocument(activeSession, doc.id, { verificationState: "failed", ...(txHash ? { transactionHash: txHash } : {}), ownerAddress: activeWallet.address, network: "Stellar Testnet" });
              if (sessionRef.current === activeSession) await refreshData(activeSession);
            } catch { /* Keep the transaction error as the primary result. */ }
          }
          if (sessionRef.current !== activeSession) return;
          await recordActivity(activeSession, { type: "integrity.registration-failed", at: now, entityId: doc.id, label: `Fingerprint registration failed: ${doc.metadata.fileName}` });
        } else {
          await recordActivity(activeSession, { type: "integrity.verification-failed", at: now, entityId: doc.id, label: `Integrity verification failed: ${doc.metadata.fileName}` });
          if (sessionRef.current !== activeSession) return;
          setRegistryResult(message);
        }
        if (sessionRef.current === activeSession) setOperationError(message);
        return;
      }

      if (sessionRef.current !== activeSession) return;
      const now = new Date().toISOString();
      if (result.kind === "registered" && result.confirmation === "confirmed") dispatchTransaction({ type: "CONFIRMED" });
      let localRecordSaved = false;
      try {
        if (result.kind === "verification") {
          const updated = result.found
            ? { verificationState: "verified" as const, verifiedAt: now, ownerAddress: activeWallet.address, network: "Stellar Testnet" }
            : { verificationState: "not-registered" as const, verifiedAt: now, ownerAddress: activeWallet.address, network: "Stellar Testnet" };
          await updateDocument(activeSession, doc.id, updated);
          if (sessionRef.current !== activeSession) return;
          localRecordSaved = true;
          await recordActivity(activeSession, { type: result.found ? "integrity.verified" : "integrity.not-registered", at: now, entityId: doc.id, label: `${result.found ? "Integrity verified" : "No matching record found"}: ${doc.metadata.fileName}` });
          if (sessionRef.current !== activeSession) return;
          setRegistryResult(result.found ? "Integrity verified. The local file fingerprint matches a registered Testnet record for this wallet." : "No registry record was found for this fingerprint and wallet.");
        } else {
          await updateDocument(activeSession, doc.id, {
            transactionHash: result.hash,
            verificationState: result.confirmation === "confirmed" ? "registered" : "pending",
            ...(result.confirmation === "confirmed" ? { registeredAt: now } : {}),
            ownerAddress: activeWallet.address, network: "Stellar Testnet",
          });
          if (sessionRef.current !== activeSession) return;
          localRecordSaved = true;
          await recordActivity(activeSession, { type: result.confirmation === "confirmed" ? "integrity.registered" : "integrity.submitted", at: now, entityId: doc.id, label: `${result.confirmation === "confirmed" ? "Fingerprint registered" : "Fingerprint submitted"}: ${doc.metadata.fileName}` });
          if (sessionRef.current !== activeSession) return;
          setRegistryResult(result.confirmation === "confirmed" ? "Registration confirmed on Stellar Testnet." : result.message || "The transaction was submitted. Confirmation is still pending.");
        }
        await refreshData(activeSession);
      } catch (error) {
        if (sessionRef.current !== activeSession) return;
        const reason = cleanInterfaceMessage(error instanceof Error ? error.message : "The local vault could not be updated.");
        if (result.kind === "registered") {
          setRegistryResult(result.confirmation === "confirmed"
            ? `Registration confirmed on Stellar Testnet. ${localRecordSaved ? "The local record was saved, but the view could not refresh." : "The local status could not be saved."} Transaction: ${result.hash}`
            : `Transaction submitted to Stellar Testnet, but confirmation is pending. ${localRecordSaved ? "The local record was saved, but the view could not refresh." : "The local status could not be saved."} Transaction: ${result.hash}`);
        } else {
          setRegistryResult(`The read-only Testnet check ${result.found ? "matched" : "found no record"}. ${localRecordSaved ? "The local record was saved, but the view could not refresh." : "The result could not be saved locally."}`);
        }
        setOperationError(localRecordSaved
          ? `The Testnet result was saved, but the vault view could not refresh: ${reason}`
          : `Testnet returned a result, but the local vault could not save it: ${reason}`);
      }
    } finally { setDocumentBusy(false); }
  }

  function startWorkspaceForm(workspace?: VaultWorkspace) {
    setEditingWorkspace(workspace ?? null); setWorkspaceName(workspace?.name ?? "");
    setWorkspaceDescription(workspace?.description ?? ""); setWorkspaceIcon(workspace?.icon ?? "folder"); setModal("workspace");
  }

  async function submitWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!session || !workspaceName.trim()) return;
    const now = new Date().toISOString();
    const item: VaultWorkspace = {
      id: editingWorkspace?.id ?? crypto.randomUUID(), name: workspaceName.trim(), description: workspaceDescription.trim(),
      icon: workspaceIcon, createdAt: editingWorkspace?.createdAt ?? now, updatedAt: now,
    };
    try {
      await saveWorkspace(session, item);
      if (sessionRef.current !== session) return;
      await recordActivity(session, { type: editingWorkspace ? "workspace.updated" : "workspace.created", at: now, entityId: item.id, label: `${editingWorkspace ? "Project space updated" : "Project space created"}: ${item.name}` });
      if (sessionRef.current !== session) return;
      await refreshData(session);
      if (sessionRef.current !== session) return;
      setModal(null); setEditingWorkspace(null); navigate("project-spaces"); setNotice("Project space saved.");
    } catch (error) { if (sessionRef.current === session) setOperationError(cleanInterfaceMessage(error instanceof Error ? error.message : "The project space could not be saved.")); }
  }

  async function handleDeleteWorkspace(workspace: VaultWorkspace) {
    if (!session || !window.confirm(`Delete the project space “${workspace.name}”? Documents remain in your vault.`)) return;
    try {
      await deleteWorkspace(session, workspace.id);
      if (sessionRef.current !== session) return;
      await recordActivity(session, { type: "workspace.deleted", at: new Date().toISOString(), entityId: workspace.id, label: `Project space deleted: ${workspace.name}` });
      if (sessionRef.current !== session) return;
      await refreshData(session);
      if (sessionRef.current !== session) return;
      if (activeWorkspaceId === workspace.id) setActiveWorkspaceId("");
      setNotice("Project space deleted. Documents remain in your vault.");
    } catch (error) { if (sessionRef.current === session) setOperationError(cleanInterfaceMessage(error instanceof Error ? error.message : "The project space could not be deleted.")); }
  }

  function startLinkForm(link?: VaultSavedLink) {
    setEditingLink(link ?? null); setLinkTitle(link?.title ?? ""); setLinkUrl(link?.url ?? "");
    setLinkDescription(link?.description ?? ""); setLinkCategory(link?.category ?? "Reference"); setLinkTags(link?.tags.join(", ") ?? ""); setModal("link");
  }

  async function submitLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!session) return;
    if (!isSafeWebUrl(linkUrl.trim())) { setOperationError("Enter a valid http or https address."); return; }
    const now = new Date().toISOString();
    const link: VaultSavedLink = {
      id: editingLink?.id ?? crypto.randomUUID(), title: linkTitle.trim(), url: linkUrl.trim(), description: linkDescription.trim(),
      category: linkCategory.trim() || "Reference", tags: linkTags.split(",").map((tag) => tag.trim()).filter(Boolean),
      createdAt: editingLink?.createdAt ?? now, updatedAt: now,
    };
    try {
      await saveSavedLink(session, link);
      if (sessionRef.current !== session) return;
      await recordActivity(session, { type: editingLink ? "link.updated" : "link.saved", at: now, entityId: link.id, label: `${editingLink ? "Saved link updated" : "Link saved"}: ${link.title}` });
      if (sessionRef.current !== session) return;
      await refreshData(session);
      if (sessionRef.current !== session) return;
      setModal(null); setEditingLink(null); navigate("saved-links"); setNotice("Link saved in your encrypted vault.");
    } catch (error) { if (sessionRef.current === session) setOperationError(cleanInterfaceMessage(error instanceof Error ? error.message : "The link could not be saved.")); }
  }

  async function handleDeleteLink(link: VaultSavedLink) {
    if (!session || !window.confirm(`Delete “${link.title}” from Saved Links?`)) return;
    try {
      await deleteSavedLink(session, link.id);
      if (sessionRef.current !== session) return;
      await recordActivity(session, { type: "link.deleted", at: new Date().toISOString(), entityId: link.id, label: `Saved link deleted: ${link.title}` });
      if (sessionRef.current !== session) return;
      await refreshData(session);
      if (sessionRef.current === session) setNotice("Saved link deleted.");
    } catch (error) { if (sessionRef.current === session) setOperationError(cleanInterfaceMessage(error instanceof Error ? error.message : "The link could not be deleted.")); }
  }

  function launchAction(action: string) {
    setCommandOpen(false); setCommandQuery("");
    if (action === "upload") { fileInputRef.current?.click(); return; }
    if (action === "workspace") { startWorkspaceForm(); return; }
    if (action === "link") { startLinkForm(); return; }
    if (action === "recovery") { navigate("recovery-shield"); return; }
    if (action === "ledger") { navigate("integrity-ledger"); return; }
    if (action === "verify") { navigate("all-documents"); setNotice("Choose a document, then select Verify Integrity."); return; }
    if (action.startsWith("route:")) navigate(action.slice(6) as Section);
  }

  const contractConfigured = contractReady;
  const activeSection = section === "document-detail" ? "all-documents" : section;
  const selectedDocument = documents.find((doc) => doc.id === selectedDocumentId) ?? null;
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null;
  const sortedDocuments = useMemo(() => {
    const result = [...documents];
    if (documentSort === "oldest") result.sort((a, b) => a.metadata.createdAt.localeCompare(b.metadata.createdAt));
    else if (documentSort === "name") result.sort((a, b) => a.metadata.fileName.localeCompare(b.metadata.fileName, undefined, { sensitivity: "base" }));
    else if (documentSort === "size") result.sort((a, b) => b.metadata.size - a.metadata.size);
    else result.sort((a, b) => b.metadata.createdAt.localeCompare(a.metadata.createdAt));
    return result;
  }, [documents, documentSort]);
  const visibleDocuments = useMemo(() => {
    let list = sortedDocuments;
    if (section === "recent") list = list.slice(0, 12);
    if (section === "starred") list = list.filter((doc) => doc.metadata.starred);
    if (activeWorkspaceId) list = list.filter((doc) => doc.metadata.workspaceId === activeWorkspaceId);
    const query = searchQuery.trim().toLocaleLowerCase();
    if (query) list = list.filter((doc) => `${doc.metadata.fileName} ${doc.metadata.mimeType} ${doc.metadata.digest}`.toLocaleLowerCase().includes(query));
    return list;
  }, [sortedDocuments, section, activeWorkspaceId, searchQuery]);
  const verifiedCount = documents.filter((doc) => doc.metadata.verificationState === "verified").length;
  const storageEstimate = useMemo(() => getVaultStorageEstimate(), []);
  const activities = useMemo(() => activityRecords
    .map((record) => ({ at: record.at, label: record.label, detail: activityDescription(record.type), icon: activityIcon(record.type), docId: record.entityId }))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 100), [activityRecords]);
  const ledgerRows = documents.filter((doc) => doc.metadata.transactionHash || ["registered", "verified", "pending", "failed", "not-registered"].includes(doc.metadata.verificationState ?? ""));
  const filteredLedger = ledgerRows.filter((doc) => ledgerFilter === "all" || doc.metadata.verificationState === ledgerFilter);
  const globalResults = useMemo(() => {
    const query = commandQuery.trim().toLocaleLowerCase();
    if (!query) return [];
    return [
      ...documents.filter((doc) => `${doc.metadata.fileName} ${doc.metadata.digest}`.toLocaleLowerCase().includes(query)).slice(0, 5).map((doc) => ({ label: doc.metadata.fileName, detail: "Document", icon: "file" as const, action: () => { setSelectedDocumentId(doc.id); navigate("document-detail"); setCommandOpen(false); } })),
      ...workspaces.filter((space) => `${space.name} ${space.description}`.toLocaleLowerCase().includes(query)).slice(0, 3).map((space) => ({ label: space.name, detail: "Project space", icon: "spaces" as const, action: () => { setActiveWorkspaceId(space.id); navigate("project-spaces"); setCommandOpen(false); } })),
      ...savedLinks.filter((link) => `${link.title} ${link.url} ${link.description} ${link.category} ${link.tags.join(" ")}`.toLocaleLowerCase().includes(query)).slice(0, 3).map((link) => ({ label: link.title, detail: "Saved link", icon: "link" as const, action: () => { navigate("saved-links"); setCommandOpen(false); } })),
    ];
  }, [commandQuery, documents, workspaces, savedLinks]);

  const quickActions = [
    { id: "upload", label: "Upload Document", hint: "Encrypt and save locally", icon: "upload" as const },
    { id: "workspace", label: "Create Project Space", hint: "Organize documents", icon: "spaces" as const },
    { id: "link", label: "Save a Link", hint: "Keep a private reference", icon: "link" as const },
    { id: "verify", label: "Verify Document", hint: "Check a saved fingerprint", icon: "shield" as const },
    { id: "recovery", label: "Open Recovery Shield", hint: "Review current recovery status", icon: "lock" as const },
    { id: "ledger", label: "Open Integrity Ledger", hint: "View saved registry records", icon: "ledger" as const },
  ];

  function renderDocumentList(list: VaultDocument[]) {
    if (!list.length) return <EmptyState icon="documents" title={searchQuery ? "No matching documents" : "Your vault is empty"} text={searchQuery ? "Try another search term." : "Encrypt a document on this device to start your vault."} actionLabel={!searchQuery ? "Encrypt a document" : undefined} onAction={!searchQuery ? () => fileInputRef.current?.click() : undefined} />;
    return <div className="document-list">{list.map((doc) => <article className="document-row" key={doc.id}>
      <button className="document-open" onClick={() => { setSelectedDocumentId(doc.id); navigate("document-detail"); }}>
        <span className={`file-tile ${fileKind(doc.metadata).toLowerCase()}`}><Icon name="file" size={18} /></span>
        <span className="document-main"><strong>{doc.metadata.fileName}</strong><small>{fileKind(doc.metadata)} · {formatBytes(doc.metadata.size)} · Added {formatDate(doc.metadata.createdAt)}</small></span>
      </button>
      <span className={`status-pill ${doc.metadata.verificationState ?? "not-registered"}`}>{statusLabel(doc.metadata.verificationState)}</span>
      <button className={`icon-button star-button${doc.metadata.starred ? " is-starred" : ""}`} aria-label={doc.metadata.starred ? `Unstar ${doc.metadata.fileName}` : `Star ${doc.metadata.fileName}`} onClick={() => void handleUpdateDocument(doc.id, { starred: !doc.metadata.starred })}><Icon name="star" size={16} /></button>
      <button className="icon-button" aria-label={`Open details for ${doc.metadata.fileName}`} onClick={() => { setSelectedDocumentId(doc.id); navigate("document-detail"); }}><Icon name="chevron" size={17} /></button>
    </article>)}</div>;
  }

  const renderOverview = () => (
    <>
      <section className="welcome-panel">
        <div><span className="eyebrow"><span /> PERSONAL VAULT</span><h1>Your documents, <em>in your hands.</em></h1><p>Encrypt files on this device, organize them into project spaces, and check their fingerprints on Stellar Testnet.</p></div>
        <div className="welcome-actions"><button className="button button-primary" onClick={() => fileInputRef.current?.click()}><Icon name="upload" size={17} />Encrypt a document</button><button className="button button-secondary" onClick={() => setCommandOpen(true)}><Icon name="spark" size={16} />Quick actions <kbd>⌘ K</kbd></button></div>
      </section>
      <div className="summary-grid" aria-label="Vault summary">
        <Summary label="Documents" value={documents.length} icon="documents" caption="Encrypted on this device" />
        <Summary label="Project Spaces" value={workspaces.length} icon="spaces" caption="Private organization" />
        <Summary label="Saved Links" value={savedLinks.length} icon="link" caption="Encrypted references" />
        <Summary label="Integrity Verified" value={verifiedCount} icon="shield" caption="Matched against Testnet" />
      </div>
      <div className="overview-grid">
        <section className="panel recent-panel"><div className="panel-heading"><div><span className="section-kicker">YOUR VAULT</span><h2>Recent documents</h2></div><button className="text-link" onClick={() => navigate("all-documents")}>All documents <Icon name="arrow" size={14} /></button></div>
          {renderDocumentList(sortedDocuments.slice(0, 5))}
        </section>
        <section className="panel security-panel"><div className="panel-heading"><div><span className="section-kicker">SECURITY STATUS</span><h2>Vault status</h2></div><Icon name="shield" className="panel-heading-icon" /></div>
          <StatusRow icon="wallet" title="Stellar wallet" status={wallet ? `Connected · ${shortAddress(wallet.address)}` : "Not connected"} state={wallet ? "good" : "neutral"} />
          <StatusRow icon="lock" title="Encryption" status="AES-256-GCM · unlocked" state="good" />
          <StatusRow icon="shield" title="Recovery Shield" status="Not set up" state="warning" />
          <StatusRow icon="network" title="Stellar registry" status={contractConfigured ? "Testnet contract ID set · reachability unverified" : "Contract ID not configured"} state={contractConfigured ? "neutral" : "warning"} />
          <button className="subtle-link" onClick={() => navigate("recovery-shield")}>Review security details <Icon name="arrow" size={14} /></button>
        </section>
      </div>
      <section className="panel activity-panel"><div className="panel-heading"><div><span className="section-kicker">RECENT CHANGES</span><h2>Activity</h2></div><button className="text-link" onClick={() => navigate("security-activity")}>View activity <Icon name="arrow" size={14} /></button></div><ActivityList items={activities.slice(0, 5)} /></section>
      <p className="local-storage-note"><Icon name="lock" size={14} /> {cloudConfigured ? "Documents stay on this device until you run encrypted sync. Project spaces, links, and activity remain local." : "Your vault is stored in this browser. Cloud sync and guardian recovery are not configured."}</p>
    </>
  );

  const renderDocumentsPage = () => (
    <>
      <PageIntro eyebrow={section === "starred" ? "YOUR SHORTLIST" : section === "recent" ? "LATEST FIRST" : "PRIVATE FILES"} title={pageTitles[section]} description={activeWorkspace ? `Documents in ${activeWorkspace.name}.` : "Files are encrypted before they are saved in this browser."} action={<button className="button button-primary" onClick={() => fileInputRef.current?.click()}><Icon name="upload" size={16} />Encrypt a document</button>} />
      <div className="toolbar"><label className="search-field"><Icon name="search" size={17} /><input value={searchQuery} onChange={(event) => setSearchQuery(event.currentTarget.value)} placeholder="Search your documents" aria-label="Search documents" /></label><label className="select-field"><Icon name="spaces" size={15} /><select value={activeWorkspaceId} onChange={(event) => setActiveWorkspaceId(event.currentTarget.value)} aria-label="Filter by project space"><option value="">All project spaces</option>{workspaces.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}</select></label><label className="select-field"><Icon name="sort" size={15} /><select value={documentSort} onChange={(event) => setDocumentSort(event.currentTarget.value as typeof documentSort)} aria-label="Sort documents"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="name">Name</option><option value="size">Largest first</option></select></label><span className="toolbar-count">{visibleDocuments.length} {visibleDocuments.length === 1 ? "file" : "files"}</span></div>
      <section className="panel document-table-panel">{renderDocumentList(visibleDocuments)}</section>
      <p className="fine-print">Files are limited to 25 MiB. Original bytes are encrypted in this browser and never sent to a server.</p>
    </>
  );

  const renderDocumentDetail = () => {
    if (!selectedDocument) return <EmptyState icon="documents" title="Document not selected" text="Choose a document from your vault to see its details." actionLabel="Open all documents" onAction={() => navigate("all-documents")} />;
    const doc = selectedDocument;
    return <>
      <button className="back-link" onClick={() => navigate("all-documents")}><Icon name="chevron" className="back-chevron" size={15} /> All Documents</button>
      <PageIntro eyebrow="ENCRYPTED DOCUMENT" title={doc.metadata.fileName} description={`${fileKind(doc.metadata)} · ${formatBytes(doc.metadata.size)} · Added ${formatDate(doc.metadata.createdAt)}`} action={<button className="button button-primary" onClick={() => void handleDownload(doc.id)} disabled={documentBusy}><Icon name="download" size={16} />{documentBusy ? "Working…" : "Decrypt and download"}</button>} />
      <div className="detail-layout">
        <section className="panel detail-main"><div className="panel-heading"><div><span className="section-kicker">DOCUMENT DETAILS</span><h2>File information</h2></div><span className={`status-pill ${doc.metadata.verificationState ?? "not-registered"}`}>{statusLabel(doc.metadata.verificationState)}</span></div>
          <dl className="detail-list"><Detail label="File type" value={doc.metadata.mimeType || fileKind(doc.metadata)} /><Detail label="File size" value={formatBytes(doc.metadata.size)} /><Detail label="Date added" value={formatDateTime(doc.metadata.createdAt)} /><Detail label="Project space" value={workspaces.find((space) => space.id === doc.metadata.workspaceId)?.name ?? "Personal vault"} /><Detail label="Original fingerprint" value={doc.metadata.digest} code /><Detail label="Fingerprint status" value="SHA-256 computed locally from the original file" /><Detail label="Network" value={doc.metadata.network || "Not registered"} /><Detail label="Owner" value={doc.metadata.ownerAddress || "Not recorded"} code /><Detail label="Transaction" value={doc.metadata.transactionHash || "No transaction reference"} code /></dl>
          <div className="detail-actions"><button className="button button-secondary" onClick={() => void handleUpdateDocument(doc.id, { starred: !doc.metadata.starred })}><Icon name="star" size={16} />{doc.metadata.starred ? "Remove star" : "Star document"}</button><button className="button button-secondary" onClick={() => setRenameEditing((value) => !value)}><Icon name="edit" size={15} />Rename</button><button className="button button-danger" onClick={() => void handleDeleteDocument(doc)}><Icon name="trash" size={15} />Delete</button></div>
          {renameEditing && <form className="inline-edit" onSubmit={(event) => { event.preventDefault(); if (detailRename.trim()) void handleUpdateDocument(doc.id, { fileName: detailRename.trim() }); }}><label className="field-label" htmlFor="document-rename">Document name</label><input id="document-rename" value={detailRename} onChange={(event) => setDetailRename(event.currentTarget.value)} /><button className="button button-primary">Save name</button></form>}
          <label className="field-label move-label" htmlFor="move-workspace">Project space</label><select id="move-workspace" className="full-select" value={doc.metadata.workspaceId ?? ""} onChange={(event) => void handleUpdateDocument(doc.id, { workspaceId: event.currentTarget.value || undefined })}><option value="">Personal vault</option>{workspaces.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}</select>
        </section>
        <section className="panel registry-panel"><div className="panel-heading"><div><span className="section-kicker">STELLAR TESTNET</span><h2>Integrity registry</h2></div><Icon name="network" className="panel-heading-icon" /></div>
          <p className="panel-copy">Register this file's SHA-256 fingerprint after you review the public, permanent Testnet record. The file and its name stay off-chain.</p>
          {!contractConfigured && <div className="inline-notice"><Icon name="alert" size={16} /><span>Registry actions are disabled until a Testnet contract ID is configured.</span></div>}
          {walletError && <div className="form-error" role="alert">{walletError}</div>}
          <div className="registry-actions">{!wallet ? <button className="button button-secondary full-button" onClick={() => void handleConnect()} disabled={walletBusy}><Icon name="wallet" size={16} />{walletBusy ? "Connecting…" : "Connect Varial wallet"}</button> : <button className="button button-secondary full-button" onClick={() => void handleDisconnect()} disabled={walletBusy}><Icon name="wallet" size={16} />{shortAddress(wallet.address)} · Disconnect</button>}
            <button className="button button-primary full-button" onClick={() => void handleRegistryOperation(doc, "register")} disabled={!contractConfigured || !wallet || documentBusy || !wallet.network || wallet.network.networkPassphrase !== STELLAR_TESTNET_PASSPHRASE}><Icon name="ledger" size={16} />{documentBusy && lastOperation === "register" ? "Registering…" : "Register fingerprint"}</button>
            <button className="button button-secondary full-button" onClick={() => void handleRegistryOperation(doc, "verify")} disabled={!contractConfigured || !wallet || documentBusy}><Icon name="shield" size={16} />{documentBusy && lastOperation === "verify" ? "Checking…" : "Verify integrity"}</button>
          </div>
          {registryDocumentId === doc.id && registryResult && <div className="registry-result" role="status">{registryResult}</div>}
          {transactionDocumentId === doc.id && transaction.stage !== "idle" && <TransactionStatus state={transaction} operation={lastOperation} />}
          {doc.metadata.transactionHash && <a className="text-link explorer-link" href={explorerTransactionUrl(doc.metadata.transactionHash)} target="_blank" rel="noreferrer">Open transaction on Stellar Expert <Icon name="external" size={14} /></a>}
          <p className="fine-print">A wallet signature authorizes registration. A submitted transaction is not confirmed until the Testnet RPC reports success.</p>
        </section>
      </div>
    </>;
  };

  const renderSpaces = () => (
    <>
      <PageIntro eyebrow="ORGANIZE YOUR VAULT" title="Project Spaces" description="Group documents by project. Spaces and descriptions are encrypted in this browser." action={<button className="button button-primary" onClick={() => startWorkspaceForm()}><Icon name="plus" size={16} />Create space</button>} />
      {!workspaces.length ? <EmptyState icon="spaces" title="No project spaces yet" text="Create a space to group related documents. Your personal vault remains the home for every file." actionLabel="Create a project space" onAction={() => startWorkspaceForm()} /> : <div className="space-grid">{workspaces.map((space) => {
        const count = documents.filter((doc) => doc.metadata.workspaceId === space.id).length;
        return <article className={`space-card${activeWorkspaceId === space.id ? " selected" : ""}`} key={space.id}>
          <button className="space-card-open" onClick={() => { setActiveWorkspaceId(space.id); navigate("all-documents"); }}><span className="space-icon"><Icon name="spaces" size={20} /></span><strong>{space.name}</strong><p>{space.description || "No description"}</p><small>{count} {count === 1 ? "document" : "documents"} · Created {formatDate(space.createdAt)}</small></button>
          <div className="space-actions"><button className="icon-button" onClick={() => startWorkspaceForm(space)} aria-label={`Edit ${space.name}`}><Icon name="edit" size={15} /></button><button className="icon-button" onClick={() => void handleDeleteWorkspace(space)} aria-label={`Delete ${space.name}`}><Icon name="trash" size={15} /></button></div>
        </article>;
      })}</div>}
      {activeWorkspace && <section className="panel workspace-contents"><div className="panel-heading"><div><span className="section-kicker">SPACE CONTENTS</span><h2>{activeWorkspace.name}</h2></div><button className="text-link" onClick={() => navigate("all-documents")}>Open documents <Icon name="arrow" size={14} /></button></div><label className="search-field"><Icon name="search" size={17} /><input value={searchQuery} onChange={(event) => setSearchQuery(event.currentTarget.value)} placeholder="Search in this space" aria-label="Search in this project space" /></label>{renderDocumentList(documents.filter((doc) => doc.metadata.workspaceId === activeWorkspace.id && (!searchQuery || `${doc.metadata.fileName} ${doc.metadata.digest}`.toLowerCase().includes(searchQuery.toLowerCase()))))}</section>}
    </>
  );

  const renderLinks = () => {
    const query = searchQuery.trim().toLocaleLowerCase();
    const filtered = [...savedLinks].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).filter((link) => !query || `${link.title} ${link.url} ${link.description} ${link.category} ${link.tags.join(" ")}`.toLocaleLowerCase().includes(query));
    return <>
      <PageIntro eyebrow="PRIVATE REFERENCES" title="Saved Links" description="URLs, descriptions, and tags are encrypted in your local vault. Only http and https links are accepted." action={<button className="button button-primary" onClick={() => startLinkForm()}><Icon name="plus" size={16} />Save a link</button>} />
      <div className="toolbar"><label className="search-field"><Icon name="search" size={17} /><input value={searchQuery} onChange={(event) => setSearchQuery(event.currentTarget.value)} placeholder="Search links and tags" aria-label="Search saved links" /></label><span className="toolbar-count">{filtered.length} {filtered.length === 1 ? "link" : "links"}</span></div>
      {!filtered.length ? <EmptyState icon="link" title={query ? "No matching links" : "No saved links"} text={query ? "Try a different word or tag." : "Save a trusted reference URL to keep it beside your files."} actionLabel={!query ? "Save a link" : undefined} onAction={!query ? () => startLinkForm() : undefined} /> : <div className="link-grid">{filtered.map((link) => <article className="link-card" key={link.id}><div className="link-card-top"><span className="link-icon"><Icon name="link" size={17} /></span><span className="link-category">{link.category}</span><button className="icon-button" aria-label={`Edit ${link.title}`} onClick={() => startLinkForm(link)}><Icon name="edit" size={15} /></button><button className="icon-button" aria-label={`Delete ${link.title}`} onClick={() => void handleDeleteLink(link)}><Icon name="trash" size={15} /></button></div><h3>{link.title}</h3><p>{link.description || "No description"}</p><a href={link.url} target="_blank" rel="noopener noreferrer" className="saved-url">{link.url}<Icon name="external" size={14} /></a><div className="tag-row">{link.tags.map((tag) => <span className="tag" key={`${link.id}-${tag}`}>{tag}</span>)}</div></article>)}</div>}
    </>;
  };

  const renderLedger = () => (
    <>
      <PageIntro eyebrow="PUBLIC TESTNET RECORDS" title="Integrity Ledger" description="This ledger shows registry results saved with your encrypted local documents. It is not a network-wide index." />
      <div className="toolbar"><label className="select-field"><Icon name="filter" size={15} /><select value={ledgerFilter} onChange={(event) => setLedgerFilter(event.currentTarget.value)} aria-label="Filter integrity records"><option value="all">All states</option><option value="verified">Integrity verified</option><option value="registered">Registered</option><option value="pending">Pending</option><option value="failed">Failed</option></select></label><span className="toolbar-count">{filteredLedger.length} {filteredLedger.length === 1 ? "record" : "records"}</span></div>
      {!filteredLedger.length ? <EmptyState icon="ledger" title="No registry records" text="Only real results from contract calls are shown here. Register a document fingerprint on Testnet to add a record." actionLabel="Open documents" onAction={() => navigate("all-documents")} /> : <div className="ledger-list">{filteredLedger.map((doc) => <article className="ledger-row" key={doc.id}><span className={`ledger-icon ${doc.metadata.verificationState ?? "not-registered"}`}><Icon name="ledger" size={18} /></span><div className="ledger-info"><strong>{doc.metadata.fileName}</strong><code>{doc.metadata.digest}</code><small>{doc.metadata.network || "Stellar Testnet"} · {doc.metadata.ownerAddress ? shortAddress(doc.metadata.ownerAddress) : "Owner not recorded"}</small></div><span className={`status-pill ${doc.metadata.verificationState ?? "not-registered"}`}>{statusLabel(doc.metadata.verificationState)}</span><div className="ledger-date">{formatDateTime(doc.metadata.registeredAt || doc.metadata.verifiedAt)}</div>{doc.metadata.transactionHash && <a className="icon-button" href={explorerTransactionUrl(doc.metadata.transactionHash)} target="_blank" rel="noreferrer" aria-label="Open transaction on Stellar Expert"><Icon name="external" size={15} /></a>}</article>)}</div>}
    </>
  );

  const renderRecovery = () => (
    <>
      <PageIntro eyebrow="ACCOUNT RESILIENCE" title="Recovery Shield" description="No guardian recovery is enabled for this vault." />
      <section className="recovery-banner"><span className="recovery-symbol"><Icon name="shield" size={23} /></span><div><span className="status-pill warning">NOT SET UP</span><h2>Your passphrase is the only recovery method on this device.</h2><p>If you forget it or lose this browser profile, the encrypted files cannot be recovered. There is no server-side reset.</p></div></section>
      <div className="content-cards"><article className="panel"><span className="section-kicker">WHY RECOVERY MATTERS</span><h2>Encryption protects against access, and it can also lock you out.</h2><p className="panel-copy">The vault passphrase encrypts each document key. It is not stored in the browser or sent to a service. No account login can restore it.</p></article><article className="panel"><span className="section-kicker">PLANNED DESIGN</span><h2>Independent threshold guardians</h2><p className="panel-copy">The design notes propose a 2-of-3 approval threshold across independent authorities, with a public delay and a cancellation window for the current owner. A single guardian would not receive the vault key.</p><p className="panel-copy">Enrollment, key shares, delays, cancellation, key rotation, and recovery transactions are not implemented or tested.</p></article></div>
      <div className="inline-notice wide-notice"><Icon name="alert" size={18} /><span>Do not use this device-only vault as the only copy of important files. Keep a separate backup you control. Recovery features must pass independent cryptographic review before any security claim.</span></div>
    </>
  );

  const renderActivity = () => (
    <>
      <PageIntro eyebrow="LOCAL RECORDS" title="Security Activity" description="Activity entries are encrypted in this browser and remain after documents or links are deleted. They are not a tamper-proof audit log." />
      <section className="panel activity-page"><ActivityList items={activities} /></section>
      <p className="fine-print">Activity entries are encrypted in this browser and remain after a document or link is deleted. They are not a tamper-proof audit log.</p>
      {!activities.length && <EmptyState icon="activity" title="No activity yet" text="Saved documents, spaces, links, and integrity checks will appear here." />}
    </>
  );

  const renderCloudControls = (variant: "access" | "settings") => <CloudSyncPanel
    variant={variant}
    configured={cloudConfigured}
    account={cloudAccount}
    busy={cloudBusy}
    error={cloudError}
    message={cloudMessage}
    info={cloudVaultInfo}
    syncResult={cloudSyncResult}
    canSync={Boolean(session)}
    canRestore={!session && accessMode === "setup" && Boolean(cloudVaultInfo?.documentCount)}
    restoring={accessMode === "restore"}
    onRequestLink={(email) => void handleRequestCloudLink(email)}
    onInspect={() => void handleInspectCloud()}
    onSync={() => void handleCloudSync()}
    onSignOut={() => void handleSignOutCloud()}
  />;

  const renderPage = () => {
    switch (section) {
      case "overview": return renderOverview();
      case "all-documents": case "recent": case "starred": return renderDocumentsPage();
      case "document-detail": return renderDocumentDetail();
      case "project-spaces": return renderSpaces();
      case "saved-links": return renderLinks();
      case "integrity-ledger": return renderLedger();
      case "recovery-shield": return renderRecovery();
      case "security-activity": return renderActivity();
      case "shared-with-me": return <UnavailablePage icon="share" title="Sharing is not enabled" text="This Phase 1 vault has no document-sharing service. Your files remain private on this device." />;
      case "notes": return <UnavailablePage icon="note" title="Notes are not enabled" text="This Phase 1 build stores encrypted documents, project spaces, and saved links. Notes are not available yet." />;
      case "settings": return <SettingsPage storageEstimate={storageEstimate} wallet={wallet} onLock={lockVault} onDisconnect={() => void handleDisconnect()} cloudControls={renderCloudControls("settings")} />;
      default: return renderOverview();
    }
  };

  if (!session) return <AccessScreen mode={accessMode} busy={accessBusy} error={accessError} onSubmit={(passphrase, confirmation) => void handleAccess(passphrase, confirmation)} cloudControls={renderCloudControls("access")} onCancelRestore={() => setAccessMode("setup")} />;

  return (
    <div className={`vault-shell${collapsed ? " rail-collapsed" : ""}`}>
      <aside className={`vault-rail${drawerOpen ? " drawer-open" : ""}`} aria-label="VaultRail navigation">
        <div className="rail-brand"><Brand /><button className="rail-toggle" onClick={() => { const next = !collapsed; setCollapsed(next); try { window.localStorage.setItem("vaultora-rail-collapsed", String(next)); } catch { /* Optional preference. */ } }} aria-label={collapsed ? "Expand navigation" : "Collapse navigation"} title={collapsed ? "Expand navigation" : "Collapse navigation"}><Icon name="menu" size={17} /></button></div>
        <div className="rail-workspace"><span className="workspace-avatar">{activeWorkspace ? activeWorkspace.name.slice(0, 1).toUpperCase() : "P"}</span><span className="workspace-info"><small>PERSONAL WORKSPACE</small><strong>{activeWorkspace?.name ?? "Personal Vault"}</strong></span><Icon name="chevron" size={15} /></div>
        <nav className="rail-nav" aria-label="Main navigation">{navigation.map((group) => <div className="nav-group" key={group.group}><span className="nav-group-label">{group.group}</span>{group.items.map((item) => <button key={item.id} className={`rail-link${activeSection === item.id ? " active" : ""}`} title={collapsed ? item.label : undefined} aria-current={activeSection === item.id ? "page" : undefined} onClick={() => navigate(item.id)}><Icon name={item.icon} size={17} /><span>{item.label}</span>{activeSection === item.id && <i />}</button>)}</div>)}</nav>
        <button className="rail-create" onClick={() => setCommandOpen(true)}><span className="create-icon"><Icon name="plus" size={18} /></span><span>Create</span><kbd>⌘ K</kbd></button>
        <div className="rail-bottom"><div className="rail-network"><span className="network-dot" /><span>STELLAR TESTNET</span><small>Public network</small></div><button className="rail-user" onClick={() => navigate("settings")}><span className="user-avatar">{wallet ? "W" : "V"}</span><span><strong>{wallet ? shortAddress(wallet.address) : "Local vault"}</strong><small>{wallet ? "Wallet connected" : "Encrypted on device"}</small></span><Icon name="dots" size={16} /></button></div>
      </aside>
      {drawerOpen && <button className="drawer-scrim" aria-label="Close navigation drawer" onClick={() => setDrawerOpen(false)} />}
      <div className="vault-main">
        <header className="app-header">
          <button className="mobile-menu" onClick={() => setDrawerOpen(true)} aria-label="Open navigation"><Icon name="menu" size={20} /></button>
          <a className="mobile-wordmark" href="#overview" aria-label="VAULTORA overview"><span className="brand-mark"><Icon name="shield" size={16} /></span><strong>VAULTORA</strong></a>
          <div className="header-title"><span className="header-kicker">PERSONAL WORKSPACE</span><h1>{pageTitles[section]}</h1></div>
          <label className="header-workspace"><Icon name="spaces" size={16} /><select aria-label="Select project space" value={activeWorkspaceId} onChange={(event) => setActiveWorkspaceId(event.currentTarget.value)}><option value="">Personal Vault</option>{workspaces.map((space) => <option value={space.id} key={space.id}>{space.name}</option>)}</select><Icon name="chevron" size={14} /></label>
          <button className="header-search" onClick={() => { setCommandQuery(""); setCommandOpen(true); }}><Icon name="search" size={17} /><span>Search</span><kbd>⌘ K</kbd></button>
          <span className="header-testnet"><span className="network-dot" />TESTNET</span>
          <button className={`header-wallet${wallet ? " connected" : ""}`} onClick={() => wallet ? void handleDisconnect() : void handleConnect()} disabled={walletBusy} title={wallet ? `Disconnect ${wallet.address}` : "Connect Varial wallet"}><Icon name="wallet" size={16} /><span>{wallet ? shortAddress(wallet.address) : walletBusy ? "Connecting" : "Connect wallet"}</span></button>
        </header>
        <main className="page-content">
          {walletError && <div className="global-alert error" role="alert"><Icon name="alert" size={17} /><span>{walletError}</span><button onClick={() => setWalletError("")} aria-label="Dismiss message"><Icon name="close" size={16} /></button></div>}
          {operationError && <div className="global-alert error" role="alert"><Icon name="alert" size={17} /><span>{operationError}</span><button onClick={() => setOperationError("")} aria-label="Dismiss message"><Icon name="close" size={16} /></button></div>}
          {notice && <div className="global-alert success" role="status"><Icon name="check" size={17} /><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Dismiss message"><Icon name="close" size={16} /></button></div>}
          <input ref={fileInputRef} type="file" className="visually-hidden" accept={supportedAccept} aria-label="Choose document to encrypt" onChange={(event) => void handleUpload(event.currentTarget.files?.[0])} disabled={documentBusy} />
          {documentBusy && lastOperation === null && <div className="progress-banner" role="status"><span className="spinner" />Encrypting and saving in this browser. Keep this tab open.</div>}
          {renderPage()}
          <footer className="app-footer"><span>VAULTORA <b>/</b> Personal Digital Vault</span><span><Icon name="lock" size={13} /> Encrypted on this device</span></footer>
        </main>
      </div>
      <nav className="mobile-dock" aria-label="Mobile navigation"><button className={section === "overview" ? "active" : ""} onClick={() => navigate("overview")}><Icon name="overview" size={19} /><span>Home</span></button><button className={["all-documents", "recent", "starred", "document-detail"].includes(section) ? "active" : ""} onClick={() => navigate("all-documents")}><Icon name="documents" size={19} /><span>Vault</span></button><button className="dock-create" onClick={() => setCommandOpen(true)} aria-label="Create"><span><Icon name="plus" size={21} /></span><small>Create</small></button><button className={section === "project-spaces" ? "active" : ""} onClick={() => navigate("project-spaces")}><Icon name="spaces" size={19} /><span>Spaces</span></button><button className={section === "security-activity" ? "active" : ""} onClick={() => navigate("security-activity")}><Icon name="activity" size={19} /><span>Activity</span></button></nav>

      {commandOpen && <div className="modal-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCommandOpen(false); }}><section className="command-dialog" role="dialog" aria-modal="true" aria-label="Search and quick actions"><label className="command-search"><Icon name="search" size={20} /><input ref={commandInputRef} value={commandQuery} onChange={(event) => setCommandQuery(event.currentTarget.value)} placeholder="Search your vault or choose an action" aria-label="Search your vault or choose an action" /><kbd>ESC</kbd></label>{commandQuery ? <div className="command-results">{globalResults.map((result, index) => <button key={`${result.detail}-${index}`} onClick={result.action}><Icon name={result.icon} size={17} /><span><strong>{result.label}</strong><small>{result.detail}</small></span><Icon name="arrow" size={14} /></button>)}{!globalResults.length && <p className="empty-hint">No matches in your local vault.</p>}</div> : <><span className="command-label">QUICK ACTIONS</span><div className="command-actions">{quickActions.map((action) => <button key={action.id} onClick={() => launchAction(action.id)}><span className="command-icon"><Icon name={action.icon} size={17} /></span><span><strong>{action.label}</strong><small>{action.hint}</small></span><Icon name="chevron" size={15} /></button>)}</div><span className="command-footnote">Search stays on this device.</span></>}</section></div>}

      {modal && <div className="modal-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null); }}><section className="form-dialog" role="dialog" aria-modal="true" aria-labelledby="form-title"><div className="dialog-heading"><div><span className="section-kicker">ENCRYPTED VAULT</span><h2 id="form-title">{modal === "workspace" ? editingWorkspace ? "Edit project space" : "Create project space" : editingLink ? "Edit saved link" : "Save a link"}</h2></div><button className="icon-button" onClick={() => setModal(null)} aria-label="Close dialog"><Icon name="close" size={18} /></button></div>
        {modal === "workspace" ? <form onSubmit={(event) => void submitWorkspace(event)}><label className="field-label" htmlFor="space-name">Name</label><input id="space-name" value={workspaceName} onChange={(event) => setWorkspaceName(event.currentTarget.value)} maxLength={80} required autoFocus /><label className="field-label" htmlFor="space-description">Description</label><textarea id="space-description" value={workspaceDescription} onChange={(event) => setWorkspaceDescription(event.currentTarget.value)} maxLength={240} rows={3} /><label className="field-label" htmlFor="space-icon">Identifier</label><select id="space-icon" value={workspaceIcon} onChange={(event) => setWorkspaceIcon(event.currentTarget.value)}><option value="folder">Folder</option><option value="work">Work</option><option value="personal">Personal</option><option value="archive">Archive</option></select><div className="dialog-actions"><button type="button" className="button button-secondary" onClick={() => setModal(null)}>Cancel</button><button className="button button-primary">{editingWorkspace ? "Save changes" : "Create space"}</button></div></form> : <form onSubmit={(event) => void submitLink(event)}><label className="field-label" htmlFor="link-title">Title</label><input id="link-title" value={linkTitle} onChange={(event) => setLinkTitle(event.currentTarget.value)} maxLength={120} required autoFocus /><label className="field-label" htmlFor="link-url">URL</label><input id="link-url" type="url" inputMode="url" value={linkUrl} onChange={(event) => setLinkUrl(event.currentTarget.value)} placeholder="https://example.com" required /><small className="field-hint">Only http and https addresses are accepted.</small><label className="field-label" htmlFor="link-description">Description</label><textarea id="link-description" value={linkDescription} onChange={(event) => setLinkDescription(event.currentTarget.value)} maxLength={500} rows={3} /><div className="field-row"><label><span className="field-label">Category</span><input value={linkCategory} onChange={(event) => setLinkCategory(event.currentTarget.value)} maxLength={40} /></label><label><span className="field-label">Tags</span><input value={linkTags} onChange={(event) => setLinkTags(event.currentTarget.value)} placeholder="comma separated" /></label></div><div className="dialog-actions"><button type="button" className="button button-secondary" onClick={() => setModal(null)}>Cancel</button><button className="button button-primary">{editingLink ? "Save changes" : "Save link"}</button></div></form>}
      </section></div>}
    </div>
  );
}

function statusLabel(state?: VaultDocumentMetadata["verificationState"]): string {
  if (state === "verified") return "Integrity verified";
  if (state === "registered") return "Registered";
  if (state === "pending") return "Pending";
  if (state === "failed") return "Registration failed";
  if (state === "not-registered") return "No matching record";
  return "Not checked";
}

function Summary({ label, value, icon, caption }: { label: string; value: number; icon: IconName; caption: string }) {
  return <article className="summary-card"><div className="summary-top"><span>{label}</span><span className="summary-icon"><Icon name={icon} size={17} /></span></div><strong>{value}</strong><small>{caption}</small></article>;
}

function StatusRow({ icon, title, status, state }: { icon: IconName; title: string; status: string; state: "good" | "warning" | "neutral" }) {
  return <div className="status-row"><span className="status-row-icon"><Icon name={icon} size={16} /></span><span className="status-row-text"><strong>{title}</strong><small>{status}</small></span><span className={`status-indicator ${state}`} /></div>;
}

function PageIntro({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="page-intro"><div><span className="eyebrow"><span />{eyebrow}</span><h2>{title}</h2><p>{description}</p></div>{action}</div>;
}

function EmptyState({ icon, title, text, actionLabel, onAction }: { icon: IconName; title: string; text: string; actionLabel?: string; onAction?: () => void }) {
  return <div className="empty-state"><span className="empty-icon"><Icon name={icon} size={22} /></span><h3>{title}</h3><p>{text}</p>{actionLabel && onAction && <button className="button button-secondary" onClick={onAction}>{actionLabel}<Icon name="arrow" size={14} /></button>}</div>;
}

function UnavailablePage({ icon, title, text }: { icon: IconName; title: string; text: string }) {
  return <><PageIntro eyebrow="PHASE 1 STATUS" title={title} description={text} /><EmptyState icon={icon} title={title} text={text} /></>;
}

function ActivityList({ items }: { items: { at: string; label: string; detail: string; icon: IconName; docId?: string }[] }) {
  if (!items.length) return <EmptyState icon="activity" title="No activity yet" text="Your saved vault records will appear here." />;
  return <div className="activity-list">{items.map((item, index) => <div className="activity-row" key={`${item.at}-${item.label}-${index}`}><span className="activity-icon"><Icon name={item.icon} size={16} /></span><span className="activity-copy"><strong>{item.label}</strong><small>{item.detail}</small></span><time dateTime={item.at}>{formatDateTime(item.at)}</time></div>)}</div>;
}

function Detail({ label, value, code = false }: { label: string; value: string; code?: boolean }) {
  return <div className="detail-item"><dt>{label}</dt><dd className={code ? "detail-code" : ""}>{value}</dd></div>;
}
function TransactionStatus({ state, operation }: { state: ReturnType<typeof transactionReducer>; operation: DocumentOperation | null }) {
  const label = state.stage === "idle" ? "No transaction" : { preparing: "Preparing transaction", awaiting_authorization: "Awaiting wallet authorization", submitted: "Submitted to Testnet", confirmed: "Confirmed on Testnet", failed: "Transaction failed" }[state.stage];
  return <section className={`transaction-status ${state.stage === "failed" ? "failed" : ""}`} aria-live="polite"><div className="transaction-status-top"><strong>{label}</strong><small>{operation === "register" ? "Fingerprint registration" : "Read-only verification"}</small></div>{state.message && <p>{cleanInterfaceMessage(state.message)}</p>}{state.hash && <a href={explorerTransactionUrl(state.hash)} target="_blank" rel="noreferrer">{shortAddress(state.hash)} · View transaction <Icon name="external" size={13} /></a>}</section>;
}
function CloudSyncPanel({
  variant, configured, account, busy, error, message, info, syncResult, canSync, canRestore, restoring,
  onRequestLink, onInspect, onSync, onSignOut,
}: {
  variant: "access" | "settings";
  configured: boolean;
  account: string | null;
  busy: boolean;
  error: string;
  message: string;
  info: CloudVaultInfo | null;
  syncResult: CloudSyncResult | null;
  canSync: boolean;
  canRestore: boolean;
  restoring: boolean;
  onRequestLink: (email: string) => void;
  onInspect: () => void;
  onSync: () => void;
  onSignOut: () => void;
}) {
  const [email, setEmail] = useState("");
  const access = variant === "access";
  return <section className={`cloud-sync-panel${access ? " cloud-access" : " panel settings-card"}`}>
    <span className="section-kicker">PRIVATE CLOUD</span>
    <h2>Encrypted document sync</h2>
    <p className="panel-copy">Only encrypted file bytes, encrypted details, and wrapped keys are stored remotely. Your passphrase is never sent.</p>
    {!configured ? <div className="cloud-state"><strong>Not configured</strong><small>This deployment has no Supabase project settings yet. The device-only vault remains available.</small></div> : account ? <>
      <div className="cloud-state"><strong>Cloud account connected</strong><small>{account} · Account access identifies the storage owner, not the vault key.</small></div>
      <div className="cloud-panel-actions"><button className="button button-secondary" onClick={onInspect} disabled={busy}>{busy ? "Checking…" : "Check cloud documents"}</button>{canSync && <button className="button button-primary" onClick={onSync} disabled={busy}>{busy ? "Syncing…" : "Sync encrypted documents"}</button>}</div>
      {info && <p className="cloud-detail">{info.documentCount} encrypted document{info.documentCount === 1 ? "" : "s"} in this account. Project spaces, saved links, and activity remain on this device.</p>}
      {canRestore && <p className="cloud-detail">Use the same vault passphrase to restore these documents on this device.</p>}
      {restoring && <p className="cloud-detail">Enter the vault passphrase above. Supabase sign-in cannot decrypt these files.</p>}
      {!canSync && !canRestore && !restoring && <p className="cloud-detail">Unlock this device vault before syncing its encrypted documents.</p>}
      <button className="text-link cloud-signout" onClick={onSignOut} disabled={busy}>Sign out of cloud account</button>
    </> : <form className="cloud-auth-form" onSubmit={(event) => { event.preventDefault(); onRequestLink(email); }}>
      <label className="field-label" htmlFor={`cloud-email-${variant}`}>Email for cloud sign-in</label>
      <input id={`cloud-email-${variant}`} type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.currentTarget.value)} placeholder="you@example.com" required />
      <button className="button button-secondary" type="submit" disabled={busy}>{busy ? "Sending…" : "Email a sign-in link"}</button>
    </form>}
    {message && <p className="cloud-feedback" role="status">{message}</p>}
    {syncResult && variant === "settings" && <small className="cloud-feedback">Last sync: {syncResult.uploaded} uploaded, {syncResult.downloaded} downloaded, {syncResult.deleted} deletions.</small>}
    {error && <p className="cloud-error" role="alert">{error}</p>}
  </section>;
}

function SettingsPage({ storageEstimate, wallet, onLock, onDisconnect, cloudControls }: { storageEstimate: Promise<{ usage: number; quota: number }>; wallet: ConnectedWallet | null; onLock: () => void; onDisconnect: () => void; cloudControls: ReactNode }) {
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null);
  useEffect(() => { let alive = true; void storageEstimate.then((value) => { if (alive) setEstimate(value); }).catch(() => undefined); return () => { alive = false; }; }, [storageEstimate]);
  return <><PageIntro eyebrow="PREFERENCES" title="Settings" description="Your vault is encrypted in this browser. The passphrase is not stored." />
    <div className="settings-grid"><section className="panel settings-card"><span className="section-kicker">LOCAL VAULT</span><h2>Storage and encryption</h2><StatusRow icon="lock" title="Encryption" status="AES-256-GCM with passphrase-wrapped document keys" state="good" /><StatusRow icon="lock" title="Session lock" status="Manual or after 15 minutes without activity." state="good" /><StatusRow icon="network" title="Storage" status="Encrypted in this browser; cloud availability is shown below." state="neutral" /><div className="settings-data">Browser storage used<strong>{estimate ? formatBytes(estimate.usage) : "Checking…"}</strong></div>{estimate?.quota ? <small className="field-hint">Browser quota estimate: {formatBytes(estimate.quota)}. This varies by device and browser.</small> : null}<button className="button button-secondary" onClick={onLock}><Icon name="lock" size={16} />Lock vault</button></section>
    {cloudControls}
    <section className="panel settings-card"><span className="section-kicker">STELLAR TESTNET</span><h2>Wallet connection</h2><StatusRow icon="wallet" title="Varial wallet" status={wallet ? shortAddress(wallet.address) : "Not connected"} state={wallet ? "good" : "neutral"} />{wallet && <button className="button button-secondary" onClick={onDisconnect}><Icon name="wallet" size={16} />Disconnect wallet</button>}<p className="panel-copy">Registration requires wallet approval. VAULTORA does not store wallet secret keys.</p></section></div>
  </>;
}

export default App;
