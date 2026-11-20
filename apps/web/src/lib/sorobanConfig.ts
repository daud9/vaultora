export type DocumentOperation = "register" | "verify";

export interface SorobanConfig {
  rpcUrl: string;
  networkPassphrase: string;
  contractId: string;
  registerMethod: string;
  verifyMethod: string;
}

export const defaultSorobanConfig: SorobanConfig = {
  rpcUrl: import.meta.env.VITE_STELLAR_RPC_URL || "https://soroban-testnet.stellar.org",
  networkPassphrase:
    import.meta.env.VITE_STELLAR_NETWORK_PASSPHRASE || "Test SDF Network ; September 2015",
  contractId: import.meta.env.VITE_STELLAR_CONTRACT_ID?.trim() || "",
  registerMethod: import.meta.env.VITE_STELLAR_REGISTER_METHOD || "register_document",
  verifyMethod: import.meta.env.VITE_STELLAR_VERIFY_METHOD || "verify_document",
};

export const explorerTransactionUrl = (hash: string): string =>
  `https://stellar.expert/explorer/testnet/tx/${encodeURIComponent(hash)}`;
