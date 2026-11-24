import { Networks, type ModuleInterface } from "@creit-tech/stellar-wallets-kit/types";
import { StellarWalletsKit } from "@creit-tech/stellar-wallets-kit/sdk";
import { cleanInterfaceMessage } from "./uiText";

export interface WalletNetwork {
  network: string;
  networkPassphrase: string;
  sorobanRpcUrl?: string;
}

export interface ConnectedWallet {
  address: string;
  network: WalletNetwork | null;
  walletName?: string;
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
  getWalletName: () => string;
  disconnect: () => Promise<void>;
}

const walletConnectProjectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID?.trim() ?? "";
export const walletConnectConfigured = walletConnectProjectId.length > 0;

const walletTheme = {
  background: "#10151b",
  "background-secondary": "#0c1116",
  "foreground-strong": "#f1f3f4",
  foreground: "#dfe5e6",
  "foreground-secondary": "#a7b2b8",
  primary: "#8dd6b9",
  "primary-foreground": "#10151b",
  transparent: "rgba(0, 0, 0, 0)",
  lighter: "#f1f3f4",
  light: "#dfe5e6",
  "light-gray": "#aab4ba",
  gray: "#748087",
  danger: "#d16060",
  border: "rgba(141, 214, 185, 0.24)",
  shadow: "0 28px 90px rgba(0, 0, 0, 0.45)",
  "border-radius": "10px",
  "font-family": "Inter, ui-sans-serif, system-ui, sans-serif",
};

async function loadWalletModules(): Promise<ModuleInterface[]> {
  // Load the official modules individually. The published defaultModules bundle also imports MetaMask's adapter,
  // which currently references a missing legacy package and prevents the other providers from loading.
  const [albedo, varial, fordefi, rabet, xbull, lobstr, hana, klever, onekey, bitget, cactuslink, dcent, scopuly, ghostsig] = await Promise.all([
    import("@creit-tech/stellar-wallets-kit/modules/albedo"),
    import("@creit-tech/stellar-wallets-kit/modules/varial"),
    import("@creit-tech/stellar-wallets-kit/modules/fordefi"),
    import("@creit-tech/stellar-wallets-kit/modules/rabet"),
    import("@creit-tech/stellar-wallets-kit/modules/xbull"),
    import("@creit-tech/stellar-wallets-kit/modules/lobstr"),
    import("@creit-tech/stellar-wallets-kit/modules/hana"),
    import("@creit-tech/stellar-wallets-kit/modules/klever"),
    import("@creit-tech/stellar-wallets-kit/modules/onekey"),
    import("@creit-tech/stellar-wallets-kit/modules/bitget"),
    import("@creit-tech/stellar-wallets-kit/modules/cactuslink"),
    import("@creit-tech/stellar-wallets-kit/modules/dcent"),
    import("@creit-tech/stellar-wallets-kit/modules/scopuly"),
    import("@creit-tech/stellar-wallets-kit/modules/ghostsig"),
  ]);

  return [
    new albedo.AlbedoModule(),
    new varial.VarialModule(),
    new fordefi.FordefiModule(),
    new rabet.RabetModule(),
    new xbull.xBullModule(),
    new lobstr.LobstrModule(),
    new hana.HanaModule(),
    new klever.KleverModule(),
    new onekey.OneKeyModule(),
    new bitget.BitgetModule(),
    new cactuslink.CactusLinkModule(),
    new dcent.DcentModule(),
    new scopuly.ScopulyModule(),
    new ghostsig.GhostsigModule(),
  ];
}

let initialization: Promise<void> | undefined;

async function initializeWalletKit(): Promise<void> {
  if (!initialization) {
    initialization = (async () => {
      const modules = await loadWalletModules();
      if (walletConnectProjectId) {
        const { WalletConnectModule, WalletConnectTargetChain } = await import(
          "@creit-tech/stellar-wallets-kit/modules/wallet-connect"
        );
        const appUrl = window.location.origin;
        modules.push(new WalletConnectModule({
          projectId: walletConnectProjectId,
          metadata: {
            name: "VAULTORA",
            description: "Private document vault with Stellar Testnet integrity verification.",
            icons: [new URL("/vaultora-mark.svg", appUrl).toString()],
            url: appUrl,
          },
          allowedChains: [WalletConnectTargetChain.TESTNET],
        }));
      }

      StellarWalletsKit.init({
        modules,
        network: Networks.TESTNET,
        theme: walletTheme,
        authModal: { showInstallLabel: true, hideUnsupportedWallets: false },
      });
    })().catch((error: unknown) => {
      initialization = undefined;
      throw error;
    });
  }
  await initialization;
}

const stellarWalletKitApi: WalletApi = {
  async requestAccess() {
    await initializeWalletKit();
    return StellarWalletsKit.authModal();
  },
  async getNetworkDetails() {
    await initializeWalletKit();
    const module = StellarWalletsKit.selectedModule;
    try {
      return await module.getNetwork();
    } catch (error) {
      // WalletConnect negotiates the Testnet chain when it connects, but does not expose getNetwork().
      if (module.productId === "wallet_connect" && walletConnectProjectId) {
        return { network: "Stellar Testnet", networkPassphrase: Networks.TESTNET };
      }
      throw error;
    }
  },
  getWalletName() {
    return StellarWalletsKit.selectedModule.productName;
  },
  async disconnect() {
    await initializeWalletKit();
    await StellarWalletsKit.disconnect();
  },
};

function throwSdkError(error: { message?: string } | string | undefined): void {
  if (!error) return;
  const message = typeof error === "string" ? error : error.message;
  throw new Error(message || "The wallet returned an unspecified error.");
}

export async function connectWallet(api: WalletApi = stellarWalletKitApi): Promise<ConnectedWallet> {
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

  return { address: result.address, network, walletName: api.getWalletName() };
}

export async function disconnectWallet(api: WalletApi = stellarWalletKitApi): Promise<void> {
  await api.disconnect();
}

export function walletErrorMessage(error: unknown): string {
  const message = error instanceof Error
    ? error.message.trim()
    : typeof error === "object" && error !== null && "message" in error && typeof error.message === "string"
      ? error.message.trim()
      : "";
  if (!message) return "Wallet connection failed. Try again.";

  const cleaned = cleanInterfaceMessage(message);
  if (/wallet.*not found|not installed|unavailable|provider not found/i.test(cleaned)) {
    return "Could not reach that wallet. Check that it is available and unlocked, then try again.";
  }
  return cleaned;
}
