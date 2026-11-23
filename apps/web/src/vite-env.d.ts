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
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
