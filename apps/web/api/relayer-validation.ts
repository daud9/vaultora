/**
 * Pure validation for the self-hosted VAULTORA Testnet relayer
 * (`apps/web/api/relayer.ts`).
 *
 * The relayer fee-sponsors Soroban transactions for passkey smart-account
 * wallets. It must never become an open fee faucet for arbitrary
 * transactions, so every `{ func, auth }` payload is classified from the
 * decoded host-function XDR before anything is simulated or submitted.
 *
 * Allowed payloads only:
 *  - "deploy": a `hostFunctionTypeCreateContractV2` whose executable is the
 *    known VAULTORA smart-account WASM hash. Anyone may deploy their own
 *    wallet; the sponsor only pays the (tiny, Testnet) deployment fee.
 *  - "register": an `invokeContract` call to `register_document` on the
 *    VAULTORA document-registry contract.
 *  - "wallet-admin": an `invokeContract` call to `add_signer` or
 *    `batch_add_signer` on a contract whose on-chain code hash is the
 *    known smart-account WASM hash. The WASM check itself needs RPC, so
 *    this module only classifies the call and returns the target contract
 *    id; the handler verifies the code hash before sponsoring. This is
 *    what the mandatory backup-passkey flow (`kit.signers.addPasskey` +
 *    `kit.signAndSubmitAdmin`) submits through the relayer.
 *
 * Everything else — token transfers, arbitrary contract calls, V1
 * contract creation, Stellar-asset executables, unknown code — is
 * rejected. The auth entries are never trusted for allowlisting: the
 * chain re-validates them at simulation time, and a failed simulation
 * means nothing is submitted and no fee is spent.
 *
 * This module is pure (no I/O) so it can be unit-tested directly. It
 * uses `@stellar/stellar-sdk` 17 XDR accessors: union discriminants are
 * the `.type` string, arm values are properties, `Hash` values expose
 * `.value` (Buffer), and `S` symbol values expose `.bytes`.
 */
import { Address, xdr } from "@stellar/stellar-sdk";

/** stellar-accounts v0.8.0 smart-account WASM hash (Testnet). */
export const RELAYER_ACCOUNT_WASM_HASH =
  "c514d35ea67eaea9bfc1fb3327854c0c06111bc1ddebd4fe217c504c1004b9e1";

/** VAULTORA document-registry contract (Testnet, unchanged). */
export const RELAYER_REGISTRY_CONTRACT_ID =
  "CAQK2Q7I7Q5BAVP4LEOPRWSVRPPKAWIV4CVZPWH6AHIUYUDZTN67KWZQ";

/** The only registry function the relayer sponsors. */
export const RELAYER_REGISTRY_FUNCTION = "register_document";

/** Smart-account admin functions the relayer sponsors (backup passkeys). */
export const RELAYER_WALLET_ADMIN_FUNCTIONS = [
  "add_signer",
  "batch_add_signer",
] as const;

/** Hard cap on auth entries per request (deploy/register/admin send one). */
export const RELAYER_MAX_AUTH_ENTRIES = 10;

/** Hard cap on the JSON request body, in bytes. */
export const RELAYER_MAX_BODY_BYTES = 65536;

export type RelayerFuncKind = "deploy" | "register" | "wallet-admin";

export type RelayerFuncClassification =
  | {
      ok: true;
      kind: RelayerFuncKind;
      /** Target contract for "register" and "wallet-admin". */
      contractId?: string;
      /** Invoked function name for "register" and "wallet-admin". */
      functionName?: string;
    }
  | { ok: false; error: string };

export type RelayerAuthParse =
  | { ok: true; entries: xdr.SorobanAuthorizationEntry[] }
  | { ok: false; error: string };

export type RelayerPayloadClassification =
  | {
      ok: true;
      kind: RelayerFuncKind;
      func: xdr.HostFunction;
      auth: xdr.SorobanAuthorizationEntry[];
      contractId?: string;
      functionName?: string;
    }
  | { ok: false; error: string };

/** Hex-encode bytes without `Buffer` (the app has no `@types/node`). */
export function hexEncode(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexOfHash(hash: { value: Uint8Array }): string {
  return hexEncode(hash.value);
}

/**
 * Classify one base64 host-function XDR string. Returns the kind when
 * the call is one the relayer sponsors, or a safe (non-echoing) error.
 */
export function classifyRelayerFunc(funcBase64: unknown): RelayerFuncClassification {
  if (typeof funcBase64 !== "string" || !funcBase64.trim()) {
    return { ok: false, error: "Missing host function." };
  }
  let func: xdr.HostFunction;
  try {
    func = xdr.HostFunction.fromXDR(funcBase64, "base64");
  } catch {
    return { ok: false, error: "Invalid host function XDR." };
  }

  if (func.type === "hostFunctionTypeCreateContractV2") {
    const create = func.createContractV2;
    if (!create || !create.executable || create.executable.type !== "contractExecutableWasm") {
      return { ok: false, error: "Only smart-account deployments are accepted." };
    }
    const wasmHash = create.executable.wasmHash;
    if (!wasmHash || hexOfHash(wasmHash) !== RELAYER_ACCOUNT_WASM_HASH) {
      return { ok: false, error: "Unknown account code." };
    }
    return { ok: true, kind: "deploy" };
  }

  if (func.type === "hostFunctionTypeInvokeContract") {
    const invoke = func.invokeContract;
    if (!invoke) {
      return { ok: false, error: "Invalid contract invocation." };
    }
    let contractId: string;
    try {
      contractId = Address.fromScAddress(invoke.contractAddress).toString();
    } catch {
      return { ok: false, error: "Invalid contract address." };
    }
    let functionName: string;
    try {
      functionName = Array.from(invoke.functionName.bytes, (byte) =>
        String.fromCharCode(byte),
      ).join("");
    } catch {
      return { ok: false, error: "Invalid function name." };
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(functionName)) {
      return { ok: false, error: "Invalid function name." };
    }
    if (
      contractId === RELAYER_REGISTRY_CONTRACT_ID &&
      functionName === RELAYER_REGISTRY_FUNCTION
    ) {
      return { ok: true, kind: "register", contractId, functionName };
    }
    if (
      (RELAYER_WALLET_ADMIN_FUNCTIONS as readonly string[]).includes(functionName)
    ) {
      return { ok: true, kind: "wallet-admin", contractId, functionName };
    }
    return { ok: false, error: "This contract call is not sponsored by the relayer." };
  }

  return { ok: false, error: "Unsupported host function." };
}

/**
 * Parse and bound the base64 auth-entry array. Every entry must decode
 * as a Soroban authorization entry.
 */
export function parseRelayerAuth(auth: unknown): RelayerAuthParse {
  if (!Array.isArray(auth)) {
    return { ok: false, error: "Missing authorization entries." };
  }
  if (auth.length < 1 || auth.length > RELAYER_MAX_AUTH_ENTRIES) {
    return { ok: false, error: "Invalid authorization entries." };
  }
  const entries: xdr.SorobanAuthorizationEntry[] = [];
  for (const entry of auth) {
    if (typeof entry !== "string" || !entry.trim()) {
      return { ok: false, error: "Invalid authorization entries." };
    }
    try {
      entries.push(xdr.SorobanAuthorizationEntry.fromXDR(entry, "base64"));
    } catch {
      return { ok: false, error: "Invalid authorization entries." };
    }
  }
  return { ok: true, entries };
}

/**
 * Classify a whole relayer payload `{ func, auth }` as posted by
 * `RelayerClient.send()`. Validates the host function first, then the
 * auth entries.
 */
export function classifyRelayerPayload(
  func: unknown,
  auth: unknown,
): RelayerPayloadClassification {
  const classified = classifyRelayerFunc(func);
  if (!classified.ok) return classified;
  const parsed = parseRelayerAuth(auth);
  if (!parsed.ok) return parsed;
  return {
    ok: true,
    kind: classified.kind,
    func: xdr.HostFunction.fromXDR(func as string, "base64"),
    auth: parsed.entries,
    contractId: classified.contractId,
    functionName: classified.functionName,
  };
}
