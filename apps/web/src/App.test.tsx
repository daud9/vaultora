import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import * as localVault from "./lib/localVault";
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
  await screen.findByRole("heading", { name: "Set up your vault" });
  await user.type(screen.getByLabelText("Vault passphrase"), "correct horse battery staple");
  await user.type(screen.getByLabelText("Confirm passphrase"), "correct horse battery staple");
  await user.click(screen.getByRole("button", { name: "Create encrypted vault" }));
  await screen.findByRole("heading", { name: /Your documents, in your hands\./ });
  return user;
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  setEmptyVaultMocks();
  window.location.hash = "#overview";
});

describe("VAULTORA Phase 1 app", () => {
  it("creates an empty encrypted local vault and shows real zero states without fabricated data", async () => {
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

  it("sanitizes em dashes in wallet errors before displaying them", async () => {
    const emDash = String.fromCharCode(0x2014);
    const connectWallet = vi.spyOn(wallet, "connectWallet").mockRejectedValue(new Error(`Wallet request${emDash}rejected`));
    try {
      const user = await createEmptyVault();
      await user.click(screen.getByRole("button", { name: "Connect wallet" }));
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain("Wallet request; rejected");
      expect(alert.textContent).not.toContain(emDash);
    } finally {
      connectWallet.mockRestore();
    }
  });
});
