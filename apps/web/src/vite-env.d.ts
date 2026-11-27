/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_STELLAR_NETWORK?: string;
  readonly VITE_STELLAR_RPC_URL?: string;
  readonly VITE_STELLAR_NETWORK_PASSPHRASE?: string;
  readonly VITE_STELLAR_CONTRACT_ID?: string;
  readonly VITE_STELLAR_REGISTER_METHOD?: string;
  readonly VITE_STELLAR_VERIFY_METHOD?: string;
  readonly VITE_PASSKEY_ACCOUNT_WASM_HASH?: string;
  readonly VITE_PASSKEY_WEBAUTHN_VERIFIER?: string;
  readonly VITE_PASSKEY_ED25519_VERIFIER?: string;
  readonly VITE_PASSKEY_NATIVE_TOKEN_CONTRACT?: string;
  readonly VITE_PASSKEY_THRESHOLD_POLICY?: string;
  readonly VITE_PASSKEY_WEIGHTED_THRESHOLD_POLICY?: string;
  readonly VITE_PASSKEY_SPENDING_LIMIT_POLICY?: string;
  readonly VITE_RELAYER_URL?: string;
  readonly VITE_PASSKEY_INDEXER_URL?: string;
  readonly VITE_PASSKEY_SESSION_EXPIRY_MS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
