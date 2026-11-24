import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import * as localVault from "./lib/localVault";
import * as supabaseVault from "./lib/supabaseVault";
import * as wallet from "./lib/wallet";

vi.mock("./lib/localVault", () => ({
  addActivity: vi.fn(),
  createVaultSession: vi.fn(),
  decryptDocument: vi.fn(),
  deleteDocument: vi.fn(),
  deleteSavedLink: vi.fn(),
  deleteWorkspace: vi.fn(),
  getVaultStorageEstimate: vi.fn(),
  hasLocalVault: vi.fn(),
  listActivity: vi.fn(),
  listDocuments: vi.fn(),
  listSavedLinks: vi.fn(),
  listWorkspaces: vi.fn(),
  lockVaultSession: vi.fn(),
  metadataFingerprint: vi.fn(),
  saveDocument: vi.fn(),
  saveSavedLink: vi.fn(),
  saveWorkspace: vi.fn(),
  unlockVaultSession: vi.fn(),
  updateDocument: vi.fn(),
}));

vi.mock("./lib/supabaseVault", () => ({
  decodeCloudBytes: vi.fn(),
  inspectCloudVault: vi.fn(),
  isSupabaseConfigured: vi.fn(() => false),
  requestCloudSignInLink: vi.fn(),
  signOutCloudAccount: vi.fn(),
  subscribeToCloudAuth: vi.fn(() => () => undefined),
  synchronizeEncryptedDocuments: vi.fn(),
  validateCloudVaultPassphrase: vi.fn(),
}));

const session = {} as localVault.VaultSession;

function setEmptyVaultMocks() {
  vi.mocked(localVault.hasLocalVault).mockResolvedValue(false);
  vi.mocked(localVault.createVaultSession).mockResolvedValue(session);
  vi.mocked(localVault.unlockVaultSession).mockResolvedValue(session);
  vi.mocked(localVault.listDocuments).mockResolvedValue([]);
  vi.mocked(localVault.listWorkspaces).mockResolvedValue([]);
  vi.mocked(localVault.listSavedLinks).mockResolvedValue([]);
  vi.mocked(localVault.listActivity).mockResolvedValue([]);
  vi.mocked(localVault.addActivity).mockResolvedValue({ type: "vault.created", at: new Date().toISOString(), entityId: "vault", label: "Encrypted vault created" });
  vi.mocked(localVault.getVaultStorageEstimate).mockResolvedValue({ usage: 0, quota: 0 });
  vi.mocked(localVault.lockVaultSession).mockImplementation(() => undefined);
  vi.mocked(localVault.saveSavedLink).mockImplementation(async (_session, input) => ({
    ...input,
    id: input.id ?? "link-id",
    createdAt: input.createdAt ?? new Date().toISOString(),
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  }));
}

async function createEmptyVault() {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("heading", { name: "Connect your wallet" });
  await user.click(screen.getByRole("button", { name: "Connect Varial wallet" }));
  await screen.findByRole("heading", { name: "Set up your vault" });
  await user.type(screen.getByLabelText("Vault passphrase"), "correct horse battery staple");
  await user.type(screen.getByLabelText("Confirm passphrase"), "correct horse battery staple");
  await user.click(screen.getByRole("button", { name: "Create encrypted vault" }));
  await screen.findByRole("heading", { name: "Add a backup email" });
  expect(screen.getByText(/Email backup is not configured|no Supabase project settings/i)).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Continue with device-only vault" }));
  await screen.findByRole("heading", { name: /Your documents, in your hands\./ });
  return user;
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  setEmptyVaultMocks();
  vi.mocked(supabaseVault.isSupabaseConfigured).mockReset().mockReturnValue(false);
  vi.mocked(supabaseVault.subscribeToCloudAuth).mockReset().mockImplementation(() => () => undefined);
  vi.mocked(supabaseVault.requestCloudSignInLink).mockReset().mockResolvedValue(undefined);
  vi.spyOn(wallet, "connectWallet").mockResolvedValue({
    address: "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXYZ234567",
    network: { network: "TESTNET", networkPassphrase: "Test SDF Network ; September 2015" },
  });
  window.location.hash = "#overview";
});

describe("VAULTORA Phase 1 app", () => {
  it("requires a wallet connection before showing first-use passphrase setup", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Connect your wallet" });
    expect(screen.queryByLabelText("Vault passphrase")).toBeNull();
    expect(localVault.createVaultSession).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Connect Varial wallet" }));
    expect(await screen.findByRole("heading", { name: "Set up your vault" })).toBeTruthy();
    expect(screen.getByText(/Wallet connected/)).toBeTruthy();
    expect(wallet.connectWallet).toHaveBeenCalledOnce();
  });

  it("completes configured first-use setup after backup-email sign-in", async () => {
    const authListeners: Array<(email: string | null) => void> = [];
    vi.mocked(supabaseVault.isSupabaseConfigured).mockReturnValue(true);
    vi.mocked(supabaseVault.subscribeToCloudAuth).mockImplementation((onAccount) => {
      authListeners.push(onAccount);
      return () => undefined;
    });
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("heading", { name: "Connect your wallet" });
    await user.click(screen.getByRole("button", { name: "Connect Varial wallet" }));
    await screen.findByRole("heading", { name: "Set up your vault" });
    await user.type(screen.getByLabelText("Vault passphrase"), "correct horse battery staple");
    await user.type(screen.getByLabelText("Confirm passphrase"), "correct horse battery staple");
    await user.click(screen.getByRole("button", { name: "Create encrypted vault" }));
    await screen.findByRole("heading", { name: "Add a backup email" });
    expect(screen.queryByRole("button", { name: "Continue with device-only vault" })).toBeNull();

    await user.type(screen.getByLabelText("Backup email"), "backup@example.test");
    await user.click(screen.getByRole("button", { name: "Email a backup sign-in link" }));
    expect(await screen.findByRole("status")).toBeTruthy();
    expect(supabaseVault.requestCloudSignInLink).toHaveBeenCalledWith("backup@example.test");

    act(() => authListeners[authListeners.length - 1]?.("backup@example.test"));
    expect(await screen.findByRole("heading", { name: /Your documents, in your hands\./ })).toBeTruthy();
    expect(screen.getByText(/Backup email connected/)).toBeTruthy();
  });

  it("lets returning local vault users unlock without reconnecting their wallet", async () => {
    vi.mocked(localVault.hasLocalVault).mockResolvedValue(true);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Unlock your vault" });
    expect(screen.queryByRole("button", { name: "Connect Varial wallet" })).toBeNull();

    await user.type(screen.getByLabelText("Vault passphrase"), "correct horse battery staple");
    await user.click(screen.getByRole("button", { name: "Unlock vault" }));
    expect(await screen.findByRole("heading", { name: /Your documents, in your hands\./ })).toBeTruthy();
    expect(wallet.connectWallet).not.toHaveBeenCalled();
  });

  it("creates an encrypted local vault and shows real zero states without fabricated data", async () => {
    await createEmptyVault();

    expect(localVault.createVaultSession).toHaveBeenCalledWith("correct horse battery staple");
    expect(screen.getAllByText("Encrypted on this device").length).toBeGreaterThan(0);
    expect(screen.getByText("Your vault is stored in this browser. Cloud sync and guardian recovery are not configured.")).toBeTruthy();
    expect(screen.getByText("Your vault is empty")).toBeTruthy();
    expect(document.body.textContent).not.toContain(String.fromCharCode(0x2014));
  });

  it("routes to Recovery Shield and Settings and closes the vault session when locked", async () => {
    const user = await createEmptyVault();

    await user.click(screen.getByRole("button", { name: "Recovery Shield" }));
    expect(await screen.findByRole("heading", { name: "Recovery Shield", level: 2 })).toBeTruthy();
    expect(screen.getByText("No guardian recovery is enabled for this vault.")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(await screen.findByRole("heading", { name: "Storage and encryption" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Lock vault" }));
    expect(await screen.findByRole("heading", { name: "Unlock your vault" })).toBeTruthy();
    expect(localVault.lockVaultSession).toHaveBeenCalledWith(session);
  });

  it("locks the vault after 15 minutes of inactivity", async () => {
    const timeoutSpy = vi.spyOn(window, "setTimeout");
    await createEmptyVault();
    const idleCallback = timeoutSpy.mock.calls
      .filter(([, delay]) => delay === 15 * 60 * 1000)
      .map(([handler]) => handler)
      .find((handler) => typeof handler === "function") as (() => void) | undefined;
    expect(idleCallback).toBeDefined();

    const dateNow = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 16 * 60 * 1000);
    try {
      act(() => idleCallback?.());
      expect(await screen.findByRole("heading", { name: "Unlock your vault" })).toBeTruthy();
      expect(localVault.lockVaultSession).toHaveBeenCalledWith(session);
    } finally {
      dateNow.mockRestore();
      timeoutSpy.mockRestore();
    }
  });

  it("labels an unchecked document Not checked rather than Not registered", async () => {
    const user = await createEmptyVault();
    const doc: localVault.VaultDocument = {
      id: "document-id",
      metadata: {
        fileName: "report.txt",
        mimeType: "text/plain",
        size: 1,
        createdAt: "2026-11-23T00:00:00.000Z",
        updatedAt: "2026-11-23T00:00:00.000Z",
        digest: "a".repeat(64),
        starred: false,
      },
    };
    vi.mocked(localVault.saveDocument).mockResolvedValue(doc);
    vi.mocked(localVault.listDocuments).mockResolvedValue([doc]);

    await user.upload(screen.getByLabelText("Choose document to encrypt"), new File(["x"], "report.txt", { type: "text/plain" }));

    expect(await screen.findByRole("heading", { name: "report.txt" })).toBeTruthy();
    expect(screen.getByText("Not checked").classList.contains("status-pill")).toBe(true);
    expect(screen.queryByText("No matching record")).toBeNull();
  });

  it("rejects unsafe saved-link schemes before persistence", async () => {
    const user = await createEmptyVault();
    await user.click(screen.getByRole("button", { name: "Saved Links" }));
    await screen.findByRole("heading", { name: "Saved Links", level: 2 });
    await user.click(screen.getAllByRole("button", { name: "Save a link" })[0]);
    await user.type(screen.getByLabelText("Title"), "Unsafe link");
    await user.type(screen.getByLabelText("URL"), "javascript://example.com/alert");
    fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);

    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/http or https/i));
    expect(localVault.saveSavedLink).not.toHaveBeenCalled();
  });

  it("sanitizes wallet errors and keeps first-use passphrase setup gated", async () => {
    const emDash = String.fromCharCode(0x2014);
    vi.mocked(wallet.connectWallet).mockRejectedValueOnce(new Error(`Wallet request${emDash}rejected`));
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Connect your wallet" });
    await user.click(screen.getByRole("button", { name: "Connect Varial wallet" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Wallet request; rejected");
    expect(alert.textContent).not.toContain(emDash);
    expect(screen.queryByLabelText("Vault passphrase")).toBeNull();
    expect(localVault.createVaultSession).not.toHaveBeenCalled();
  });
});
