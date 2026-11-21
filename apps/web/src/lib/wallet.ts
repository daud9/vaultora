import {
  disconnect,
  getNetworkDetails,
  requestAccess,
} from "@stellar/varial-sdk";
import { cleanInterfaceMessage } from "./uiText";

export interface WalletNetwork {
  network: string;
  networkPassphrase: string;
  sorobanRpcUrl?: string;
}

export interface ConnectedWallet {
  address: string;
  network: WalletNetwork | null;
}

interface AccessResult {
  address: string;
  error?: { message?: string } | string;
}

interface NetworkResult extends WalletNetwork {
  error?: { message?: string } | string;
}

export interface WalletApi {
  requestAccess: () => Promise<AccessResult>;
  getNetworkDetails: () => Promise<NetworkResult>;
}

const varialWalletApi: WalletApi = { requestAccess, getNetworkDetails };

function throwSdkError(error: { message?: string } | string | undefined): void {
  if (!error) return;
  const message = typeof error === "string" ? error : error.message;
  throw new Error(message || "The wallet returned an unspecified error.");
}

export async function connectWallet(
  api: WalletApi = varialWalletApi,
): Promise<ConnectedWallet> {
  const result = await api.requestAccess();
  throwSdkError(result.error);
  if (!result.address?.trim()) {
    throw new Error("The wallet did not return a public address.");
  }

  let network: WalletNetwork | null = null;
  try {
    const details = await api.getNetworkDetails();
    throwSdkError(details.error);
    network = {
      network: details.network,
      networkPassphrase: details.networkPassphrase,
      sorobanRpcUrl: details.sorobanRpcUrl,
    };
  } catch {
    // Address access succeeded; keep the connection visible, but do not claim a network.
  }

  return { address: result.address, network };
}

export async function disconnectWallet(): Promise<void> {
  const result = await disconnect();
  throwSdkError(result.error);
}

export function walletErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = cleanInterfaceMessage(error.message.trim());
    if (/extension|wallet.*not found|not installed|unavailable/i.test(message)) {
      return "Could not reach Varial. Check that the wallet extension is installed and unlocked, then try again.";
    }
    return cleanInterfaceMessage(message || "Wallet connection failed. Try again.");
  }
  return "Wallet connection failed. Try again.";
}
