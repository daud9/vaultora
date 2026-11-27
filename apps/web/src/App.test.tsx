import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import * as localVault from "./lib/localVault";
import * as wallet from "./lib/wallet";
import * as passkeyWallet from "./lib/passkeyWallet";

vi.mock("./lib/passkeyWallet", () => ({
  PasskeyAmbiguousError: class extends Error {
    candidates: string[];
    constructor(candidates: string[]) {
      super("This passkey is linked to more than one smart account.");
      this.name = "PasskeyAmbiguousError";
      this.candidates = candidates;
    }
  },
  addBackupPasskey: vi.fn(),
  connectPasskeyWallet: vi.fn(),
  connectPasskeyWalletToContract: vi.fn(),
  createPasskeyWallet: vi.fn(),
  disconnectPasskeyWallet: vi.fn(),
  explorerAccountUrl: (address: string) => `https://stellar.expert/explorer/testnet/account/${address}`,
  fundPasskeyWallet: vi.fn(),
  getNativeBalance: vi.fn(async () => null),
  getPasskeyKit: vi.fn(() => ({})),
  getPasskeyRegistryDeps: vi.fn(() => undefined),
  passkeyErrorMessage: vi.fn((error: unknown) => (error instanceof Error ? error.message : "Passkey error")),
  restorePasskeySession: vi.fn(async () => null),
}));

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
  // restoreAllMocks does not reset vi.fn() implementations, so reset the
  // passkey mocks explicitly — otherwise a restore mock set by one test
  // leaks into the next and silently connects a wallet there.
  vi.mocked(passkeyWallet.restorePasskeySession).mockResolvedValue(null);
  vi.mocked(passkeyWallet.createPasskeyWallet).mockReset();
  vi.mocked(passkeyWallet.connectPasskeyWallet).mockReset();
  vi.mocked(passkeyWallet.connectPasskeyWalletToContract).mockReset();
  vi.mocked(passkeyWallet.addBackupPasskey).mockReset();
  vi.mocked(passkeyWallet.disconnectPasskeyWallet).mockReset();
  vi.mocked(passkeyWallet.fundPasskeyWallet).mockReset();
  vi.mocked(passkeyWallet.getNativeBalance).mockResolvedValue(null);
  setEmptyVaultMocks();
  window.localStorage.clear();
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
      await user.click(screen.getByRole("menuitem", { name: /Connect existing Stellar wallet/ }));
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain("Wallet request; rejected");
      expect(alert.textContent).not.toContain(emDash);
    } finally {
      connectWallet.mockRestore();
    }
  });

  it("opens a wallet menu instead of disconnecting when the connected address is clicked", async () => {
    const user = await createEmptyVault();
    const address = "G" + "A".repeat(55);
    const connectWallet = vi.spyOn(wallet, "connectWallet").mockResolvedValue({
      address,
      network: { network: "Testnet", networkPassphrase: "Test SDF Network ; September 2015" },
      kind: "varial",
      provider: "Varial",
      balance: null,
    });
    const disconnectWallet = vi.spyOn(wallet, "disconnectWallet").mockResolvedValue(undefined);
    try {
      await user.click(screen.getByRole("button", { name: "Connect wallet" }));
      await user.click(screen.getByRole("menuitem", { name: /Connect existing Stellar wallet/ }));
      const shortAddress = `${address.slice(0, 5)}…${address.slice(-5)}`;
      const addressButton = await screen.findByRole("button", { name: shortAddress });
      expect(disconnectWallet).not.toHaveBeenCalled();
      await user.click(addressButton);
      expect(await screen.findByText("Varial")).toBeTruthy();
      expect(screen.getByText(address)).toBeTruthy();
      expect(disconnectWallet).not.toHaveBeenCalled();
      await user.click(screen.getByRole("menuitem", { name: "Disconnect" }));
      expect(disconnectWallet).toHaveBeenCalledTimes(1);
      expect(await screen.findByRole("button", { name: "Connect wallet" })).toBeTruthy();
    } finally {
      connectWallet.mockRestore();
      disconnectWallet.mockRestore();
    }
  });

  it("creates a passkey wallet from the onboarding modal and shows the real address", async () => {
    const user = await createEmptyVault();
    const address = "C" + "B".repeat(55);
    const createPasskeyWallet = vi.mocked(passkeyWallet.createPasskeyWallet).mockResolvedValue({
      wallet: {
        address,
        network: { network: "Testnet", networkPassphrase: "Test SDF Network ; September 2015" },
        kind: "passkey",
        provider: "Passkey smart account",
        credentialId: "cred-1",
        balance: null,
      },
      transactionHash: "deploy-hash",
    });
    try {
      await user.click(screen.getByRole("button", { name: "Connect wallet" }));
      await user.click(screen.getByRole("menuitem", { name: /Create wallet with passkey/ }));
      await screen.findByRole("heading", { name: "Your vault starts here." });
      const dialog = screen.getByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "Create wallet with passkey" }));
      // Creation now goes to the mandatory recovery step, not success.
      expect(await screen.findByText(/Back up your wallet/)).toBeTruthy();
      expect(screen.getByText(address)).toBeTruthy();
      expect(createPasskeyWallet).toHaveBeenCalledTimes(1);
      await user.type(screen.getByLabelText("Recovery email"), "you@example.com");
      await user.click(screen.getByRole("button", { name: "Email my recovery details" }));
      await user.click(screen.getByRole("button", { name: /I've sent \/ saved my recovery email/ }));
      await user.click(screen.getByRole("button", { name: "Continue to VAULTORA" }));
      expect(await screen.findByText("Wallet ready on Stellar Testnet")).toBeTruthy();
      expect(screen.getByText("Recovery email: you@example.com · No backup passkey yet")).toBeTruthy();
      await user.click(screen.getByRole("button", { name: "Continue to VAULTORA" }));
      expect(screen.queryByRole("heading", { name: "Your vault starts here." })).toBeNull();
    } finally {
      createPasskeyWallet.mockReset();
    }
  });

  it("requires email recovery before continuing after passkey creation", async () => {
    const user = await createEmptyVault();
    const address = "C" + "B".repeat(55);
    const createPasskeyWallet = vi.mocked(passkeyWallet.createPasskeyWallet).mockResolvedValue({
      wallet: {
        address,
        network: { network: "Testnet", networkPassphrase: "Test SDF Network ; September 2015" },
        kind: "passkey",
        provider: "Passkey smart account",
        credentialId: "cred-1",
        balance: null,
      },
      transactionHash: "deploy-hash",
    });
    try {
      await user.click(screen.getByRole("button", { name: "Connect wallet" }));
      await user.click(screen.getByRole("menuitem", { name: /Create wallet with passkey/ }));
      const dialog = screen.getByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "Create wallet with passkey" }));
      await screen.findByText(/Back up your wallet/);
      // Continue and the confirmation are both blocked until recovery
      // is recorded, and the modal cannot be closed in this stage.
      expect(screen.getByRole("button", { name: "Continue to VAULTORA" })).toHaveProperty("disabled", true);
      expect(screen.getByRole("button", { name: /I've sent \/ saved my recovery email/ })).toHaveProperty("disabled", true);
      expect(screen.getByRole("button", { name: "Close wallet onboarding" })).toHaveProperty("disabled", true);
      await user.keyboard("{Escape}");
      expect(screen.getByText(/Back up your wallet/)).toBeTruthy();
      expect(screen.getByText(/Email alone cannot restore this wallet/)).toBeTruthy();
      // An invalid email is rejected before anything is recorded.
      await user.type(screen.getByLabelText("Recovery email"), "not-an-email");
      await user.click(screen.getByRole("button", { name: "Email my recovery details" }));
      expect(await screen.findByRole("alert")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Continue to VAULTORA" })).toHaveProperty("disabled", true);
      await user.clear(screen.getByLabelText("Recovery email"));
      await user.type(screen.getByLabelText("Recovery email"), "you@example.com");
      await user.click(screen.getByRole("button", { name: "Email my recovery details" }));
      await user.click(screen.getByRole("button", { name: /I've sent \/ saved my recovery email/ }));
      expect(screen.getByRole("button", { name: "Continue to VAULTORA" })).toHaveProperty("disabled", false);
    } finally {
      createPasskeyWallet.mockReset();
    }
  });

  it("sends a returning passkey user without recovery to the mandatory recovery step", async () => {
    const address = "C" + "B".repeat(55);
    vi.mocked(passkeyWallet.restorePasskeySession).mockResolvedValue({
      address,
      network: { network: "Testnet", networkPassphrase: "Test SDF Network ; September 2015" },
      kind: "passkey",
      provider: "Passkey smart account",
      credentialId: "cred-1",
      balance: null,
    });
    await createEmptyVault();
    // The silent restore runs when the vault unlocks.
    expect(await screen.findByText(/Back up your wallet/)).toBeTruthy();
    expect(screen.getByText(address)).toBeTruthy();
  });

  it("does not force recovery on a returning passkey user who already completed it", async () => {
    const address = "C" + "B".repeat(55);
    window.localStorage.setItem(
      "vaultora-passkey-recovery:v1",
      JSON.stringify({
        [address]: {
          contractId: address,
          email: "you@example.com",
          sentAt: "2026-11-27T00:00:00.000Z",
          method: "mailto",
          backupPasskeyAdded: false,
        },
      }),
    );
    vi.mocked(passkeyWallet.restorePasskeySession).mockResolvedValue({
      address,
      network: { network: "Testnet", networkPassphrase: "Test SDF Network ; September 2015" },
      kind: "passkey",
      provider: "Passkey smart account",
      credentialId: "cred-1",
      balance: null,
    });
    await createEmptyVault();
    await waitFor(() => expect(screen.queryByText(/Back up your wallet/)).toBeNull());
    expect(screen.getByRole("heading", { name: /Your documents, in your hands\./ })).toBeTruthy();
  });

  it("adds a backup passkey from the recovery step", async () => {
    const user = await createEmptyVault();
    const address = "C" + "B".repeat(55);
    const createPasskeyWallet = vi.mocked(passkeyWallet.createPasskeyWallet).mockResolvedValue({
      wallet: {
        address,
        network: { network: "Testnet", networkPassphrase: "Test SDF Network ; September 2015" },
        kind: "passkey",
        provider: "Passkey smart account",
        credentialId: "cred-1",
        balance: null,
      },
      transactionHash: "deploy-hash",
    });
    const addBackupPasskey = vi.mocked(passkeyWallet.addBackupPasskey).mockResolvedValue({
      credentialId: "cred-backup",
      hash: "backup-hash",
    });
    try {
      await user.click(screen.getByRole("button", { name: "Connect wallet" }));
      await user.click(screen.getByRole("menuitem", { name: /Create wallet with passkey/ }));
      const dialog = screen.getByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "Create wallet with passkey" }));
      await screen.findByText(/Back up your wallet/);
      await user.type(screen.getByLabelText("Recovery email"), "you@example.com");
      await user.click(screen.getByRole("button", { name: "Email my recovery details" }));
      await user.click(screen.getByRole("button", { name: /I've sent \/ saved my recovery email/ }));
      await user.click(screen.getByRole("button", { name: /Add a backup passkey/ }));
      expect(addBackupPasskey).toHaveBeenCalledWith("you@example.com");
      expect(await screen.findByText("Backup passkey added. It can connect this wallet on its own. Transaction: backup-hash")).toBeTruthy();
      expect(screen.getByText(/Recovery email recorded: you@example.com · Backup passkey added/)).toBeTruthy();
    } finally {
      createPasskeyWallet.mockReset();
      addBackupPasskey.mockReset();
    }
  });
});
