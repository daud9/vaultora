/**
 * Passkey smart-account wallet (Stellar Testnet only).
 *
 * Uses `smart-account-kit` 0.10.0 (Stellar-maintained) to create and connect
 * OpenZeppelin smart accounts (stellar-accounts v0.8.0) secured by a WebAuthn
 * passkey. The app itself stays on `@stellar/stellar-sdk` 17.4.0, so every
 * value that crosses the SDK 16 / SDK 17 boundary is a base64 XDR string —
 * never an SDK 17 object passed to the kit (see the kit README's
 * "Using the kit from an app on Stellar SDK 17" section).
 *
 * Security status: the Smart Account Kit integration is unaudited and
 * Testnet-only. Do not hold valuable assets in these accounts. No private
 * keys are stored anywhere: passkey private material never leaves the
 * authenticator, and credentials/sessions are kept only through the kit's
 * IndexedDB storage adapter. See docs/PASSKEY_WALLET.md.
 */
import {
  Account,
  Address,
  Operation,
  TransactionBuilder,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { IndexedDBStorage, SmartAccountKit } from "smart-account-kit";
import type { TransactionResult } from "smart-account-kit";
import { STELLAR_TESTNET_PASSPHRASE, STELLAR_TESTNET_RPC_URL } from "./sorobanConfig";
import { cleanInterfaceMessage } from "./uiText";
import type { ConnectedWallet, WalletKind } from "./wallet";

/** Verified Testnet configuration (stellar-accounts v0.8.0 set). */
export const PASSKEY_ACCOUNT_WASM_HASH =
  import.meta.env.VITE_PASSKEY_ACCOUNT_WASM_HASH?.trim() ||
  "c514d35ea67eaea9bfc1fb3327854c0c06111bc1ddebd4fe217c504c1004b9e1";
export const PASSKEY_WEBAUTHN_VERIFIER =
  import.meta.env.VITE_PASSKEY_WEBAUTHN_VERIFIER?.trim() ||
  "CC7EKIHQP3TN4CARQDND6CEOY2UXLWWC2X5GHTD5NLAT7BG5GPZIOM3F";
export const PASSKEY_ED25519_VERIFIER =
  import.meta.env.VITE_PASSKEY_ED25519_VERIFIER?.trim() ||
  "CAAVTMCBXEIBPR64EAASKFXERVPYFZA2JYP5A3BG6PESWEFUJX5IHKN4";
export const PASSKEY_NATIVE_TOKEN_CONTRACT =
  import.meta.env.VITE_PASSKEY_NATIVE_TOKEN_CONTRACT?.trim() ||
  "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
export const PASSKEY_THRESHOLD_POLICY =
  import.meta.env.VITE_PASSKEY_THRESHOLD_POLICY?.trim() ||
  "CAZ2WFUDXGX265LOEARFEOYYUL6F4BYWXZLGUAWZNJY3MRFPNLSZVS4S";
export const PASSKEY_WEIGHTED_THRESHOLD_POLICY =
  import.meta.env.VITE_PASSKEY_WEIGHTED_THRESHOLD_POLICY?.trim() ||
  "CDBYLFLUNPAYGE3AHZSMB4TFWECFCCHX6CJFMFO6HRPKK2W5PFU2LCKE";
export const PASSKEY_SPENDING_LIMIT_POLICY =
  import.meta.env.VITE_PASSKEY_SPENDING_LIMIT_POLICY?.trim() ||
  "CC3CEYQAP6NPNFIYSWL5MVZRCPJZGWX4XO7WDEJOUVGO2FZX5OONYPA5";
/**
 * Self-hosted VAULTORA relayer (Testnet only), same origin as the app:
 * `POST /api/relayer` (see `apps/web/api/relayer.ts`). It holds no
 * VAULTORA secret in the bundle: the sponsor keypair lives only in the
 * `VAULTORA_RELAYER_SPONSOR_SECRET` Vercel env var (preview), and the
 * function sponsors only smart-account deployments, registry
 * `register_document` calls, and signer-admin calls on genuine
 * VAULTORA smart accounts.
 *
 * The shared SDF-ecosystem proxy used to be the default. It is no longer
 * usable: it returns 403 `{"success":false,"error":"Origin is not
 * allowed"}` for every request carrying an `Origin` header (verified
 * 2026-11-27 for the preview domain, the production domain, localhost
 * and lab.stellar.org), and browsers always send `Origin`. Keep
 * `VITE_RELAYER_URL` only as an escape hatch to point at another
 * relayer URL; see docs/PASSKEY_WALLET.md.
 */
export const PASSKEY_RELAYER_URL =
  import.meta.env.VITE_RELAYER_URL?.trim() || "/api/relayer";
export const PASSKEY_INDEXER_URL = import.meta.env.VITE_PASSKEY_INDEXER_URL?.trim() || undefined;
export const PASSKEY_SESSION_EXPIRY_MS = Number(
  import.meta.env.VITE_PASSKEY_SESSION_EXPIRY_MS?.trim() || 7 * 24 * 60 * 60 * 1000,
);
export const PASSKEY_APP_NAME = "VAULTORA";
/** Default context rule id for a fresh smart account (its default rule). */
export const PASSKEY_DEFAULT_CONTEXT_RULE_ID = 0;

/** Deterministic simulation-only source used by the kit for read-only calls. */
export const SIMULATION_SOURCE_ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

export const PASSKEY_KIND: WalletKind = "passkey";
export const PASSKEY_PROVIDER = "Passkey smart account";

/**
 * Passkey smart-account dependencies for the Soroban registry, injected by
 * the caller (App passes the real Smart Account Kit). Kept narrow so tests
 * can substitute a mock kit without a browser.
 */
export interface PasskeyRegistryDeps {
  /** Sign one auth entry; input and output are base64 XDR strings. */
  signAuthEntry: (
    entryBase64: string,
    options: { contextRuleIds: number[] },
  ) => Promise<string>;
  /** Submit a host function + signed auth entries through the Testnet relayer. */
  relayerSend: (
    funcBase64: string,
    authBase64: string[],
  ) => Promise<{ success: boolean; hash?: string; error?: string }>;
}

export class PasskeyAmbiguousError extends Error {
  readonly candidates: string[];
  constructor(candidates: string[]) {
    super(
      candidates.length > 1
        ? "This passkey is linked to more than one smart account. Choose which wallet to connect."
        : "This passkey is linked to a smart account. Choose which wallet to connect.",
    );
    this.name = "PasskeyAmbiguousError";
    this.candidates = candidates;
  }
}

/** Minimal surface of SmartAccountKit used by VAULTORA (mockable in tests). */
export interface PasskeyKitLike {
  createWallet: (
    appName: string,
    userName: string,
    options?: {
      autoSubmit?: boolean;
      autoFund?: boolean;
      nativeTokenContract?: string;
    },
  ) => Promise<{
    contractId: string;
    credentialId: string;
    submitResult?: TransactionResult;
  }>;
  connectWallet: (options?: {
    credentialId?: string;
    contractId?: string;
    fresh?: boolean;
    prompt?: boolean;
  }) => Promise<{ contractId: string; credentialId: string } | null>;
  disconnect: () => Promise<void>;
  fundWallet: (
    nativeTokenContract: string,
    options?: Record<string, unknown>,
  ) => Promise<TransactionResult & { amount?: number }>;
  signAuthEntry: (
    entry: string,
    options?: { credentialId?: string; expiration?: number; contextRuleIds?: number[] },
  ) => Promise<string>;
  authenticatePasskey?: () => Promise<{ credentialId: string }>;
  discoverContractsByCredential?: (credentialId: string) => Promise<{ contract_id: string }[] | null>;
  /** Signer manager (kit.signers) — present on the real kit. */
  signers?: {
    addPasskey: (
      contextRuleId: number,
      appName: string,
      userName: string,
      options?: { nickname?: string },
    ) => Promise<{ credentialId: string; transaction: unknown }>;
  };
  /** Admin submission (kit.signAndSubmitAdmin) — present on the real kit. */
  signAndSubmitAdmin?: (transaction: unknown) => Promise<{
    success: boolean;
    hash?: string;
    error?: unknown;
  }>;
  relayer?: { send: (func: string, auth: string[]) => Promise<{ success: boolean; hash?: string; error?: string }> } | null;
  contractId?: string | undefined;
  credentialId?: string | undefined;
}

let kitInstance: PasskeyKitLike | null = null;

/** Test seam: inject a mock kit. Production code always uses the real one. */
export function setPasskeyKitForTests(kit: PasskeyKitLike | null): void {
  kitInstance = kit;
}

export function resetPasskeyKitForTests(): void {
  kitInstance = null;
}

export function getPasskeyKit(): PasskeyKitLike {
  if (kitInstance) return kitInstance;
  const kit = new SmartAccountKit({
    rpcUrl: STELLAR_TESTNET_RPC_URL,
    networkPassphrase: STELLAR_TESTNET_PASSPHRASE,
    accountWasmHash: PASSKEY_ACCOUNT_WASM_HASH,
    acceptedWasmHashes: [PASSKEY_ACCOUNT_WASM_HASH],
    acceptedBirthWasmHashes: [PASSKEY_ACCOUNT_WASM_HASH],
    webauthnVerifierAddress: PASSKEY_WEBAUTHN_VERIFIER,
    ed25519VerifierAddress: PASSKEY_ED25519_VERIFIER,
    relayerUrl: PASSKEY_RELAYER_URL,
    indexerUrl: PASSKEY_INDEXER_URL,
    sessionExpiryMs: PASSKEY_SESSION_EXPIRY_MS,
    rpName: PASSKEY_APP_NAME,
    storage: new IndexedDBStorage(),
  });
  kitInstance = kit as unknown as PasskeyKitLike;
  return kitInstance;
}

export function isPasskeySupported(): boolean {
  if (typeof window === "undefined") return false;
  if (!window.isSecureContext) return false;
  if (typeof window.PublicKeyCredential === "undefined") return false;
  return Boolean(window.navigator?.credentials);
}

export function passkeySupportMessage(): string {
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return "Passkeys need a secure (HTTPS) connection. Open VAULTORA over HTTPS and try again.";
  }
  if (typeof window === "undefined" || typeof window.PublicKeyCredential === "undefined" || !window.navigator?.credentials) {
    return "This browser does not support passkeys. Use a current version of Chrome, Safari, Edge, or Firefox, or connect an existing Stellar wallet instead.";
  }
  return "";
}

function assertPasskeySupported(): void {
  const message = passkeySupportMessage();
  if (message) throw new Error(message);
}

/**
 * Whether this device has a platform authenticator that can verify the
 * user (screen lock, fingerprint, or Face ID) — the thing a passkey
 * creation actually needs. Returns null when the browser does not expose
 * the check, so an unknown browser is never blocked on a guess.
 */
export async function hasPlatformAuthenticator(): Promise<boolean | null> {
  try {
    if (typeof window === "undefined") return null;
    const credential = window.PublicKeyCredential;
    if (
      !credential ||
      typeof credential.isUserVerifyingPlatformAuthenticatorAvailable !== "function"
    ) {
      return null;
    }
    return await credential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return null;
  }
}

function toConnectedWallet(address: string, credentialId?: string): ConnectedWallet {
  return {
    address,
    network: { network: "Testnet", networkPassphrase: STELLAR_TESTNET_PASSPHRASE },
    kind: PASSKEY_KIND,
    provider: PASSKEY_PROVIDER,
    credentialId,
    balance: null,
  };
}

function describeKitFailure(error: unknown): string {
  if (error instanceof Error) return cleanInterfaceMessage(error.message.trim());
  return "The passkey wallet request failed.";
}

/**
 * Create a real smart account on Stellar Testnet and connect to it.
 * Only returns after the kit confirms deployment (autoSubmit). Never
 * reports success before deployment is confirmed.
 */
export async function createPasskeyWallet(
  displayName?: string,
  kit: PasskeyKitLike = getPasskeyKit(),
): Promise<{ wallet: ConnectedWallet; transactionHash?: string }> {
  assertPasskeySupported();
  // Fail fast with a diagnosis instead of letting the OS credential
  // manager fail with an opaque "unknown error": passkey creation needs
  // a screen lock (PIN, pattern, or fingerprint) on this device.
  if ((await hasPlatformAuthenticator()) === false) {
    throw new Error(
      "This device cannot create passkeys yet: no screen lock or fingerprint is set up. Set up a PIN, pattern, or fingerprint in this device's settings, then try again.",
    );
  }
  const userName = displayName?.trim() || "VAULTORA user";
  const result = await kit.createWallet(PASSKEY_APP_NAME, userName, {
    autoSubmit: true,
    autoFund: false,
    nativeTokenContract: PASSKEY_NATIVE_TOKEN_CONTRACT,
  });
  if (result.submitResult && !result.submitResult.success) {
    throw new Error(
      `Smart-account deployment failed: ${describeKitFailure(result.submitResult.error)}`,
    );
  }
  if (!result.contractId?.trim()) {
    throw new Error("The smart account was not deployed. No contract address was returned.");
  }
  return {
    wallet: toConnectedWallet(result.contractId, result.credentialId),
    transactionHash: result.submitResult?.hash,
  };
}

/** Silent restore from the kit's stored session. Returns null when none exists. */
export async function restorePasskeySession(
  kit: PasskeyKitLike = getPasskeyKit(),
): Promise<ConnectedWallet | null> {
  if (!isPasskeySupported()) return null;
  const result = await kit.connectWallet();
  if (!result?.contractId) return null;
  return toConnectedWallet(result.contractId, result.credentialId);
}

/**
 * Connect a returning passkey wallet: silent restore first, then a
 * WebAuthn prompt. Never creates a new wallet. When the passkey is linked
 * to several accounts, throws PasskeyAmbiguousError with the candidates
 * so the UI can ask the user to choose — never auto-picks one.
 */
export async function connectPasskeyWallet(
  kit: PasskeyKitLike = getPasskeyKit(),
): Promise<ConnectedWallet> {
  assertPasskeySupported();
  try {
    const restored = await restorePasskeySession(kit);
    if (restored) return restored;
    const result = await kit.connectWallet({ prompt: true });
    if (!result?.contractId) {
      throw new Error("No passkey wallet was selected. Try again and approve the passkey prompt.");
    }
    return toConnectedWallet(result.contractId, result.credentialId);
  } catch (error) {
    if (error instanceof Error && error.name === "WalletAmbiguousError") {
      const context = (error as { context?: { contractIds?: unknown } }).context;
      const candidates = Array.isArray(context?.contractIds)
        ? (context.contractIds as unknown[]).filter((id): id is string => typeof id === "string")
        : [];
      if (candidates.length) throw new PasskeyAmbiguousError(candidates);
      // Fall back to discovery when the error carries no candidates.
      if (kit.authenticatePasskey && kit.discoverContractsByCredential) {
        const { credentialId } = await kit.authenticatePasskey();
        const found = await kit.discoverContractsByCredential(credentialId);
        const discovered = (found ?? []).map((entry) => entry.contract_id).filter(Boolean);
        if (discovered.length) throw new PasskeyAmbiguousError(discovered);
      }
      throw new PasskeyAmbiguousError([]);
    }
    throw error;
  }
}

/** Connect to one explicitly chosen smart-account contract. */
export async function connectPasskeyWalletToContract(
  contractId: string,
  credentialId?: string,
  kit: PasskeyKitLike = getPasskeyKit(),
): Promise<ConnectedWallet> {
  assertPasskeySupported();
  if (!contractId.trim()) throw new Error("Choose a smart-account contract to connect.");
  const result = await kit.connectWallet({ contractId, credentialId });
  if (!result?.contractId) {
    throw new Error("That smart account could not be connected. Check the address and try again.");
  }
  return toConnectedWallet(result.contractId, result.credentialId);
}

/** Registry dependencies bound to the live kit (sign + relayer submit). */
export function getPasskeyRegistryDeps(kit: PasskeyKitLike = getPasskeyKit()): PasskeyRegistryDeps {
  return {
    signAuthEntry: (entry, options) => kit.signAuthEntry(entry, options),
    relayerSend: (func, auth) =>
      kit.relayer
        ? kit.relayer.send(func, auth)
        : Promise.resolve({ success: false, error: "No Testnet relayer is configured." }),
  };
}

export async function disconnectPasskeyWallet(
  kit: PasskeyKitLike = getPasskeyKit(),
): Promise<void> {
  await kit.disconnect();
}

/**
 * Add a second passkey signer to the connected smart account, on its
 * default context rule (id 0). This is the real backup: the new passkey
 * can connect the same wallet on its own. The `email` is used only as
 * the passkey's display name — it is not a recovery key and the kit
 * never sends it anywhere. Requires the wallet to already be connected;
 * the admin transaction is authorized by the existing passkey.
 */
export async function addBackupPasskey(
  email: string,
  kit: PasskeyKitLike = getPasskeyKit(),
): Promise<{ credentialId: string; hash?: string }> {
  assertPasskeySupported();
  const userName = email.trim();
  if (!userName) throw new Error("Enter a recovery email before adding a backup passkey.");
  if (!kit.signers?.addPasskey || !kit.signAndSubmitAdmin) {
    throw new Error("This wallet does not support adding a backup passkey. Connect with your passkey and try again.");
  }
  const { credentialId, transaction } = await kit.signers.addPasskey(
    PASSKEY_DEFAULT_CONTEXT_RULE_ID,
    PASSKEY_APP_NAME,
    userName,
    { nickname: "Backup passkey" },
  );
  if (!credentialId?.trim()) {
    throw new Error("The backup passkey was not created. No credential was returned.");
  }
  const result = await kit.signAndSubmitAdmin(transaction);
  if (!result.success) {
    throw new Error(`Adding the backup passkey failed: ${describeKitFailure(result.error)}`);
  }
  return { credentialId, hash: result.hash };
}

/**
 * Request real Testnet XLM for the connected smart account via the kit's
 * Friendbot flow (a temporary account is funded, then transfers XLM to the
 * contract — Friendbot cannot fund a contract address directly). Testnet
 * XLM has no real monetary value. Returns the real result; never a fake
 * funded balance.
 */
export async function fundPasskeyWallet(
  kit: PasskeyKitLike = getPasskeyKit(),
): Promise<{ hash?: string; amount?: number }> {
  const result = await kit.fundWallet(PASSKEY_NATIVE_TOKEN_CONTRACT);
  if (!result.success) {
    throw new Error(`Testnet funding failed: ${describeKitFailure(result.error)}`);
  }
  return { hash: result.hash, amount: result.amount };
}

export function formatXlmFromStroops(stroops: bigint): string {
  const negative = stroops < 0n;
  const absolute = negative ? -stroops : stroops;
  const whole = absolute / 10_000_000n;
  const fraction = (absolute % 10_000_000n).toString().padStart(7, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole.toString()}${fraction ? `.${fraction}` : ""}`;
}

/**
 * Read the connected smart account's real native XLM balance by simulating
 * the native token SAC `balance(address)` call. Returns null when the
 * balance cannot be retrieved — callers must show "unavailable", never a
 * fabricated balance.
 */
export async function getNativeBalance(
  address: string,
  server?: rpc.Server,
): Promise<string | null> {
  if (!address.trim()) return null;
  try {
    const rpcServer = server ?? new rpc.Server(STELLAR_TESTNET_RPC_URL);
    const source = new Account(SIMULATION_SOURCE_ADDRESS, "0");
    // Build the host function directly: SDK 17's XDR writer expects the
    // method symbol as bytes, and Contract.call(string) does not satisfy it.
    const hostFunction = xdr.HostFunction.hostFunctionTypeInvokeContract(
      new xdr.InvokeContractArgs({
        contractAddress: new Address(PASSKEY_NATIVE_TOKEN_CONTRACT).toScAddress(),
        functionName: asciiBytes("balance"),
        args: [new Address(address).toScVal()],
      }),
    );
    const transaction = new TransactionBuilder(source, { fee: "100" })
      .setNetworkPassphrase(STELLAR_TESTNET_PASSPHRASE)
      .setTimeout(30)
      .addOperation(Operation.invokeHostFunction({ func: hostFunction, auth: [] }))
      .build();
    const simulation = await rpcServer.simulateTransaction(transaction);
    if ("error" in simulation) return null;
    if (!simulation.result) return null;
    const native = scValToNative(simulation.result.retval);
    if (typeof native !== "bigint") return null;
    return formatXlmFromStroops(native);
  } catch {
    return null;
  }
}

/** Friendly, non-technical mapping for passkey / WebAuthn failures. */
export function passkeyErrorMessage(error: unknown): string {
  if (error instanceof PasskeyAmbiguousError) return cleanInterfaceMessage(error.message);
  // DOMException (WebAuthn) is not an Error instance, so read name/message
  // from any object that carries them instead of relying on instanceof.
  if (error && typeof error === "object") {
    const maybe = error as { name?: unknown; message?: unknown; code?: unknown };
    const message = cleanInterfaceMessage(
      typeof maybe.message === "string" ? maybe.message.trim() : "",
    );
    const name = typeof maybe.name === "string" ? maybe.name : "";
    // SimpleWebAuthn surfaces the browser's error code (e.g.
    // ERROR_CEREMONY_ABORTED) on `code`; keep it — it is the only precise
    // identifier when the message itself is a generic "unknown error".
    const code = typeof maybe.code === "string" ? maybe.code.trim() : "";
    if (
      name === "NotAllowedError" ||
      /not allowed|user cancelled|cancelled|aborted|operation either timed out/i.test(message)
    ) {
      return "The passkey request was cancelled. Try again when you are ready to approve it on this device.";
    }
    if (
      name === "NotSupportedError" ||
      name === "SecurityError" ||
      /passkey.*not supported|webauthn.*not|secure context|not available/i.test(message)
    ) {
      return "Passkeys are not available in this browser or on this connection. Use a current browser over HTTPS, or connect an existing Stellar wallet instead.";
    }
    if (
      name === "UnknownError" ||
      /unknown error.*credential manager|talking to the credential manager/i.test(message)
    ) {
      return `The device's passkey system could not complete the request${code ? ` (${code})` : ""}. This usually means no screen lock (PIN, pattern, or fingerprint) is set up on this device, or the device passkey service had a problem. Set up a screen lock in the device settings and try again, or try on desktop Chrome.`;
    }
    if (/deployment failed|relayer|rpc|network|timeout|timed out/i.test(message)) {
      return `${message} Check your connection and try again. Nothing was created if deployment did not confirm.`;
    }
    if (/WalletAmbiguousError|multiple wallet/i.test(message)) {
      return "This passkey is linked to more than one smart account. Choose which wallet to connect.";
    }
    return message || "The passkey wallet request failed. Try again.";
  }
  return "The passkey wallet request failed. Try again.";
}

/**
 * ASCII method name as bytes. Built with charCodeAt (not TextEncoder) so
 * the Uint8Array belongs to the same realm as the SDK's instanceof checks
 * in jsdom tests; in a real browser there is only one realm anyway.
 */
function asciiBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i += 1) bytes[i] = value.charCodeAt(i);
  return bytes;
}

/** Explorer link for a Testnet account (G… or C…). */
export function explorerAccountUrl(address: string): string {
  return `https://stellar.expert/explorer/testnet/account/${encodeURIComponent(address)}`;
}


