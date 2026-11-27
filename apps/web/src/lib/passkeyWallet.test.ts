import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { StrKey, nativeToScVal, rpc, xdr } from "@stellar/stellar-sdk";

vi.mock("smart-account-kit", () => ({
  SmartAccountKit: class {},
  IndexedDBStorage: class {},
}));

import {
  PasskeyAmbiguousError,
  addBackupPasskey,
  createPasskeyWallet,
  connectPasskeyWallet,
  connectPasskeyWalletToContract,
  disconnectPasskeyWallet,
  formatXlmFromStroops,
  fundPasskeyWallet,
  getNativeBalance,
  passkeyErrorMessage,
  resetPasskeyKitForTests,
  restorePasskeySession,
  type PasskeyKitLike,
} from "./passkeyWallet";

const contractAddress = StrKey.encodeContract(new Uint8Array(32).fill(7));
const otherContractAddress = StrKey.encodeContract(new Uint8Array(32).fill(9));

function mockKit(overrides: Partial<PasskeyKitLike> = {}): PasskeyKitLike {
  return {
    createWallet: vi.fn().mockResolvedValue({
      contractId: contractAddress,
      credentialId: "cred-1",
      submitResult: { success: true, hash: "deploy-hash" },
    }),
    connectWallet: vi.fn().mockResolvedValue(null),
    disconnect: vi.fn().mockResolvedValue(undefined),
    fundWallet: vi.fn().mockResolvedValue({ success: true, hash: "fund-hash", amount: 10000 }),
    signAuthEntry: vi.fn(async (entry: string) => entry),
    authenticatePasskey: vi.fn().mockResolvedValue({ credentialId: "cred-1" }),
    discoverContractsByCredential: vi.fn().mockResolvedValue([]),
    signers: {
      addPasskey: vi.fn().mockResolvedValue({ credentialId: "cred-backup", transaction: { tx: 1 } }),
    },
    signAndSubmitAdmin: vi.fn().mockResolvedValue({ success: true, hash: "backup-hash" }),
    relayer: { send: vi.fn().mockResolvedValue({ success: true, hash: "relay-hash" }) },
    ...overrides,
  };
}

function stubPasskeySupport() {
  Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
  Object.defineProperty(window, "PublicKeyCredential", { value: class {}, configurable: true });
  Object.defineProperty(window.navigator, "credentials", { value: {}, configurable: true });
}

beforeEach(() => {
  stubPasskeySupport();
  resetPasskeyKitForTests();
});

afterEach(() => {
  resetPasskeyKitForTests();
  vi.restoreAllMocks();
});

describe("passkey wallet creation", () => {
  it("creates a real smart account and only returns after deployment confirms", async () => {
    const kit = mockKit();
    const { wallet, transactionHash } = await createPasskeyWallet("My wallet", kit);
    expect(wallet.kind).toBe("passkey");
    expect(wallet.provider).toBe("Passkey smart account");
    expect(wallet.address).toBe(contractAddress);
    expect(wallet.credentialId).toBe("cred-1");
    expect(transactionHash).toBe("deploy-hash");
    expect(kit.createWallet).toHaveBeenCalledWith("VAULTORA", "My wallet", {
      autoSubmit: true,
      autoFund: false,
      nativeTokenContract: expect.any(String),
    });
  });

  it("throws when deployment does not confirm instead of reporting success", async () => {
    const kit = mockKit({
      createWallet: vi.fn().mockResolvedValue({
        contractId: contractAddress,
        credentialId: "cred-1",
        submitResult: { success: false, error: { message: "relayer unavailable" } },
      }),
    });
    await expect(createPasskeyWallet(undefined, kit)).rejects.toThrow(/deployment failed/i);
  });

  it("refuses to start when the browser cannot do passkeys", async () => {
    Object.defineProperty(window, "isSecureContext", { value: false, configurable: true });
    const kit = mockKit();
    await expect(createPasskeyWallet(undefined, kit)).rejects.toThrow(/secure/i);
    expect(kit.createWallet).not.toHaveBeenCalled();
  });
});

describe("passkey wallet connection", () => {
  it("restores a stored session silently and does not prompt", async () => {
    const kit = mockKit({
      connectWallet: vi.fn().mockResolvedValue({ contractId: contractAddress, credentialId: "cred-1" }),
    });
    const wallet = await restorePasskeySession(kit);
    expect(wallet?.address).toBe(contractAddress);
    expect(kit.connectWallet).toHaveBeenCalledWith();
  });

  it("returns null when no stored session exists", async () => {
    await expect(restorePasskeySession(mockKit())).resolves.toBeNull();
  });

  it("connects with a prompt only when no session can be restored", async () => {
    const kit = mockKit({
      connectWallet: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ contractId: contractAddress, credentialId: "cred-1" }),
    });
    const wallet = await connectPasskeyWallet(kit);
    expect(wallet?.address).toBe(contractAddress);
    expect(kit.connectWallet).toHaveBeenNthCalledWith(1);
    expect(kit.connectWallet).toHaveBeenNthCalledWith(2, { prompt: true });
  });

  it("never creates a new wallet when connecting a returning user", async () => {
    const kit = mockKit({
      connectWallet: vi.fn().mockResolvedValue({ contractId: contractAddress, credentialId: "cred-1" }),
    });
    await connectPasskeyWallet(kit);
    expect(kit.createWallet).not.toHaveBeenCalled();
  });

  it("surfaces candidate accounts for selection instead of auto-picking one", async () => {
    const ambiguous = new Error("Multiple wallet candidates require an explicit contract selection");
    ambiguous.name = "WalletAmbiguousError";
    (ambiguous as unknown as { context: unknown }).context = {
      contractIds: [contractAddress, otherContractAddress],
    };
    const kit = mockKit({
      connectWallet: vi.fn().mockResolvedValueOnce(null).mockRejectedValueOnce(ambiguous),
    });
    let caught: unknown;
    try {
      await connectPasskeyWallet(kit);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PasskeyAmbiguousError);
    expect((caught as PasskeyAmbiguousError).candidates).toEqual([contractAddress, otherContractAddress]);
    expect(kit.createWallet).not.toHaveBeenCalled();
  });

  it("connects to an explicitly chosen contract", async () => {
    const kit = mockKit({
      connectWallet: vi.fn().mockResolvedValue({ contractId: otherContractAddress, credentialId: "cred-2" }),
    });
    const wallet = await connectPasskeyWalletToContract(otherContractAddress, "cred-2", kit);
    expect(wallet?.address).toBe(otherContractAddress);
    expect(kit.connectWallet).toHaveBeenCalledWith({ contractId: otherContractAddress, credentialId: "cred-2" });
  });

  it("disconnect clears the kit session", async () => {
    const kit = mockKit();
    await disconnectPasskeyWallet(kit);
    expect(kit.disconnect).toHaveBeenCalledTimes(1);
  });
});

describe("backup passkey", () => {
  it("adds a passkey signer on the default rule and submits it as an admin transaction", async () => {
    const kit = mockKit();
    const result = await addBackupPasskey("you@example.com", kit);
    expect(result).toEqual({ credentialId: "cred-backup", hash: "backup-hash" });
    expect(kit.signers?.addPasskey).toHaveBeenCalledWith(0, "VAULTORA", "you@example.com", {
      nickname: "Backup passkey",
    });
    expect(kit.signAndSubmitAdmin).toHaveBeenCalledWith({ tx: 1 });
  });

  it("throws when the admin submission fails instead of reporting a backup", async () => {
    const kit = mockKit({
      signAndSubmitAdmin: vi.fn().mockResolvedValue({ success: false, error: { message: "relayer unavailable" } }),
    });
    await expect(addBackupPasskey("you@example.com", kit)).rejects.toThrow(/adding the backup passkey failed/i);
  });

  it("throws when the kit cannot add a passkey signer", async () => {
    const kit = mockKit({ signers: undefined, signAndSubmitAdmin: undefined });
    await expect(addBackupPasskey("you@example.com", kit)).rejects.toThrow(/does not support adding a backup passkey/i);
  });
});

describe("faucet funding", () => {
  it("returns the real funding result and never invents a balance", async () => {
    const kit = mockKit();
    const result = await fundPasskeyWallet(kit);
    expect(result).toEqual({ hash: "fund-hash", amount: 10000 });
    expect(kit.fundWallet).toHaveBeenCalledWith(expect.stringMatching(/^C/));
  });

  it("throws on a failed funding result", async () => {
    const kit = mockKit({
      fundWallet: vi.fn().mockResolvedValue({ success: false, error: { message: "rate limited" } }),
    });
    await expect(fundPasskeyWallet(kit)).rejects.toThrow(/funding failed/i);
  });
});

describe("native balance", () => {
  it("reads the real SAC balance and formats stroops as XLM", async () => {
    const server = {
      simulateTransaction: vi.fn(async () => ({
        result: { retval: nativeToScVal(25_000_000n, { type: "i128" }) },
      })),
    };
    const balance = await getNativeBalance(contractAddress, server as unknown as rpc.Server);
    expect(balance).toBe("2.5");
    expect(server.simulateTransaction).toHaveBeenCalledTimes(1);
  });

  it("returns null instead of a fabricated balance when the read fails", async () => {
    const failing = {
      simulateTransaction: vi.fn(async () => ({ error: "simulation failed" })),
    };
    await expect(getNativeBalance(contractAddress, failing as unknown as rpc.Server)).resolves.toBeNull();
    const wrongType = {
      simulateTransaction: vi.fn(async () => ({
        result: { retval: xdr.ScVal.scvBool(true) },
      })),
    };
    await expect(getNativeBalance(contractAddress, wrongType as unknown as rpc.Server)).resolves.toBeNull();
  });

  it("formats stroop amounts without trailing zeros", () => {
    expect(formatXlmFromStroops(0n)).toBe("0");
    expect(formatXlmFromStroops(10_000_000n)).toBe("1");
    expect(formatXlmFromStroops(1_500_000n)).toBe("0.15");
    expect(formatXlmFromStroops(1n)).toBe("0.0000001");
  });
});

describe("passkey error mapping", () => {
  it("explains a cancelled passkey prompt in plain language", () => {
    const error = new DOMException("The operation was aborted", "NotAllowedError");
    expect(passkeyErrorMessage(error)).toMatch(/cancelled/i);
  });

  it("explains an unsupported browser without blaming the user", () => {
    expect(passkeyErrorMessage(new Error("WebAuthn is not available in this browser"))).toMatch(
      /not available in this browser|passkeys are not available/i,
    );
  });

  it("keeps the ambiguous-account message for the selection UI", () => {
    expect(passkeyErrorMessage(new PasskeyAmbiguousError([contractAddress]))).toMatch(
      /more than one smart account|linked to a smart account/i,
    );
  });
});
