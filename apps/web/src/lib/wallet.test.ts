import { describe, expect, it } from "vitest";
import { connectWallet, walletErrorMessage, type WalletApi } from "./wallet";

const address = "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function walletApi(overrides: Partial<WalletApi> = {}): WalletApi {
  return {
    requestAccess: async () => ({ address }),
    getNetworkDetails: async () => ({
      network: "TESTNET",
      networkPassphrase: "Test SDF Network ; September 2015",
    }),
    getWalletName: () => "xBull Wallet",
    disconnect: async () => undefined,
    ...overrides,
  };
}

describe("multi-wallet connection adapter", () => {
  it("keeps the selected provider name and network alongside the connected address", async () => {
    await expect(connectWallet(walletApi())).resolves.toEqual({
      address,
      network: {
        network: "TESTNET",
        networkPassphrase: "Test SDF Network ; September 2015",
        sorobanRpcUrl: undefined,
      },
      walletName: "xBull Wallet",
    });
  });

  it("keeps address access available without claiming a network when the provider cannot report it", async () => {
    const api = walletApi({ getNetworkDetails: async () => { throw new Error("Unsupported method"); } });

    await expect(connectWallet(api)).resolves.toEqual({
      address,
      network: null,
      walletName: "xBull Wallet",
    });
  });

  it("rejects a connection that does not return a public Stellar address", async () => {
    const api = walletApi({ requestAccess: async () => ({ address: "  " }) });

    await expect(connectWallet(api)).rejects.toThrow("The wallet did not return a public address.");
  });

  it("shows wallet-specific errors without hard-coding Varial", () => {
    expect(walletErrorMessage({ message: "Wallet extension not found" })).toMatch(/that wallet/i);
    expect(walletErrorMessage(new Error("Wallet request rejected"))).toBe("Wallet request rejected");
  });
});
