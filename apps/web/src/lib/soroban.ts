import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  Operation,
  TransactionBuilder,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { signTransaction } from "@stellar/varial-sdk";
import { STELLAR_TESTNET_PASSPHRASE, STELLAR_TESTNET_RPC_URL, type DocumentOperation, type SorobanConfig } from "./sorobanConfig";
import { PASSKEY_DEFAULT_CONTEXT_RULE_ID, SIMULATION_SOURCE_ADDRESS, type PasskeyRegistryDeps } from "./passkeyWallet";
export type { DocumentOperation, SorobanConfig } from "./sorobanConfig";
export type { PasskeyRegistryDeps } from "./passkeyWallet";

export type ContractOperationResult =
  | { kind: "registered"; hash: string; confirmation: "confirmed" | "pending"; message?: string }
  | { kind: "verification"; found: boolean };

export class TransactionSubmissionError extends Error {
  constructor(message: string, readonly transactionHash: string) {
    super(message);
    this.name = "TransactionSubmissionError";
  }
}

export function fingerprintToScVal(fingerprint: string): xdr.ScVal {
  if (!/^[a-f\d]{64}$/i.test(fingerprint)) {
    throw new Error("A valid 32-byte SHA-256 fingerprint is required.");
  }
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(fingerprint.slice(index * 2, index * 2 + 2), 16);
  }
  return xdr.ScVal.scvBytes(bytes);
}

function contractFunctionBytes(method: string): Uint8Array {
  if (!/^[A-Za-z_][A-Za-z\d_]{0,31}$/.test(method)) {
    throw new Error("Contract method names must be valid ASCII identifiers of at most 32 characters.");
  }
  const bytes = new Uint8Array(method.length);
  for (let index = 0; index < method.length; index += 1) {
    bytes[index] = method.charCodeAt(index);
  }
  return bytes;
}

export function buildDocumentContractArgs(args: {
  operation: DocumentOperation;
  digest: string;
  metadataDigest?: string;
  ownerAddress: string;
}): xdr.ScVal[] {
  const documentFingerprint = fingerprintToScVal(args.digest);
  const owner = new Address(args.ownerAddress).toScVal();
  if (args.operation === "verify") return [owner, documentFingerprint];
  if (!args.metadataDigest) {
    throw new Error("An encrypted-metadata SHA-256 fingerprint is required for registration.");
  }
  return [documentFingerprint, fingerprintToScVal(args.metadataDigest), owner];
}

export async function invokeDocumentContract(args: {
  operation: DocumentOperation;
  digest: string;
  metadataDigest?: string;
  sourceAddress: string;
  config: SorobanConfig;
  onStage?: (stage: "preparing" | "awaiting_authorization" | "submitted", hash?: string) => void;
  wait?: (milliseconds: number) => Promise<void>;
  server?: rpc.Server;
  /**
   * Wallet kind. Defaults to "varial" (the original Varial path, unchanged).
   * "passkey" uses the Smart Account Kit path below; a C… address is a
   * contract, not a classic account, so it must never go through
   * getAccount(C…) or Varial signTransaction.
   */
  walletKind?: "passkey" | "varial";
  /** Required when walletKind is "passkey". */
  passkey?: PasskeyRegistryDeps;
}): Promise<ContractOperationResult> {
  const { operation, digest, metadataDigest, sourceAddress, config, onStage } = args;
  const walletKind = args.walletKind ?? "varial";
  if (config.rpcUrl !== STELLAR_TESTNET_RPC_URL || config.networkPassphrase !== STELLAR_TESTNET_PASSPHRASE) {
    throw new Error("VAULTORA supports Stellar Testnet only. The RPC URL and network passphrase are fixed.");
  }
  if (!config.contractId.trim()) {
    throw new Error("No contract is configured. Set VITE_STELLAR_CONTRACT_ID to enable on-chain actions.");
  }
  if (!sourceAddress.trim()) {
    throw new Error("Connect a wallet before invoking the contract.");
  }
  if (walletKind === "passkey" && !args.passkey) {
    throw new Error("The passkey wallet is not connected. Reconnect with your passkey and try again.");
  }
  const contractArguments = buildDocumentContractArgs({
    operation,
    digest,
    metadataDigest,
    ownerAddress: sourceAddress,
  });
  const server = args.server ?? new rpc.Server(config.rpcUrl);
  const method = operation === "register" ? config.registerMethod : config.verifyMethod;
  const wait = args.wait ?? ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));

  async function pollConfirmation(hash: string): Promise<ContractOperationResult> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      let result: Awaited<ReturnType<typeof server.getTransaction>>;
      try {
        result = await server.getTransaction(hash);
      } catch (error) {
        const detail = error instanceof Error ? ` (${error.message})` : "";
        return {
          kind: "registered",
          hash,
          confirmation: "pending",
          message: `Submitted; the RPC confirmation lookup is unavailable${detail}. Check the transaction on the explorer.`,
        };
      }
      if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) {
        return { kind: "registered", hash, confirmation: "confirmed" };
      }
      if (result.status === rpc.Api.GetTransactionStatus.FAILED) {
        throw new Error(`The submitted transaction failed on Testnet (${hash}).`);
      }
      await wait(1_500);
    }
    return {
      kind: "registered",
      hash,
      confirmation: "pending",
      message: "Submitted; confirmation has not appeared yet. You can check the transaction on the explorer.",
    };
  }

  // ---- Passkey smart-account path (C… owner) ----
  // The registry contract accepts an Address, so a C… owner needs no
  // contract change — but records are per-owner, so a C… account's records
  // live in a separate namespace from a G… account's records.
  // UNPROVEN ON A REAL TESTNET RUN: this path is implemented from the
  // kit 0.10.0 README + SDK 17 docs and covered by unit tests with mocks,
  // but no live passkey ceremony, deployment, or registration has been run
  // yet. See docs/PASSKEY_WALLET.md.
  if (walletKind === "passkey") {
    const passkey = args.passkey as PasskeyRegistryDeps;
    // Build the host function once (SDK 17) so the same func can be sent
    // to the relayer after signing. The transaction source below is a
    // deterministic placeholder used for simulation only; the envelope is
    // discarded and the relayer's channel account sources and pays the
    // submitted transaction.
    const hostFunction = xdr.HostFunction.hostFunctionTypeInvokeContract(
      new xdr.InvokeContractArgs({
        contractAddress: new Address(config.contractId).toScAddress(),
        // SDK 17's XDR writer expects the symbol as bytes, not a string.
        functionName: contractFunctionBytes(method),
        args: contractArguments,
      }),
    );
    const buildSimulationTx = (auth: xdr.SorobanAuthorizationEntry[] = []) => {
      const source = new Account(SIMULATION_SOURCE_ADDRESS, "0");
      return new TransactionBuilder(source, { fee: BASE_FEE })
        .setNetworkPassphrase(config.networkPassphrase)
        .setTimeout(30)
        .addOperation(Operation.invokeHostFunction({ func: hostFunction, auth }))
        .build();
    };

    if (operation === "verify") {
      const simulation = await server.simulateTransaction(buildSimulationTx());
      if ("error" in simulation) throw new Error(`Read-only contract verification failed: ${simulation.error}`);
      if (!simulation.result) throw new Error("RPC simulation did not return a contract result.");
      const found = scValToNative(simulation.result.retval);
      if (typeof found !== "boolean") throw new Error("The contract verification method did not return a boolean.");
      return { kind: "verification", found };
    }

    if (operation === "register") onStage?.("preparing");
    const simulation = await server.simulateTransaction(buildSimulationTx());
    if ("error" in simulation) throw new Error(`Registry simulation failed: ${simulation.error}`);
    if (!simulation.result?.auth?.length) {
      throw new Error("The registry call produced no authorization entries to sign with the passkey.");
    }
    onStage?.("awaiting_authorization");
    const signedAuthEntries: xdr.SorobanAuthorizationEntry[] = [];
    for (const entry of simulation.result.auth) {
      const signedBase64 = await passkey.signAuthEntry(entry.toXdr("base64"), {
        contextRuleIds: [PASSKEY_DEFAULT_CONTEXT_RULE_ID],
      });
      signedAuthEntries.push(xdr.SorobanAuthorizationEntry.fromXdr(signedBase64, "base64"));
    }
    // WebAuthn signatures are larger than the simulation placeholder, so
    // re-simulate with the signed entries before submitting.
    const resimulation = await server.simulateTransaction(buildSimulationTx(signedAuthEntries));
    if ("error" in resimulation) throw new Error(`Registry re-simulation failed: ${resimulation.error}`);
    const sent = await passkey.relayerSend(
      hostFunction.toXdr("base64"),
      signedAuthEntries.map((entry) => entry.toXdr("base64")),
    );
    if (!sent.success || !sent.hash) {
      throw new Error(`The Testnet relayer did not accept the transaction${sent.error ? `: ${sent.error}` : "."}`);
    }
    onStage?.("submitted", sent.hash);
    return pollConfirmation(sent.hash);
  }

  // ---- Varial path (G… owner), unchanged ----
  if (operation === "register") onStage?.("preparing");
  const sourceAccount = await server.getAccount(sourceAddress);
  const contract = new Contract(config.contractId);
  const operationCall = Reflect.apply(contract.call, contract, [
    contractFunctionBytes(method),
    ...contractArguments,
  ]) as ReturnType<Contract["call"]>;
  const transaction = new TransactionBuilder(sourceAccount as Account, { fee: BASE_FEE })
    .setNetworkPassphrase(config.networkPassphrase)
    .setTimeout(30)
    .addOperation(operationCall)
    .build();

  if (operation === "verify") {
    const simulation = await server.simulateTransaction(transaction);
    if ("error" in simulation) throw new Error(`Read-only contract verification failed: ${simulation.error}`);
    if (!simulation.result) throw new Error("RPC simulation did not return a contract result.");
    const found = scValToNative(simulation.result.retval);
    if (typeof found !== "boolean") throw new Error("The contract verification method did not return a boolean.");
    return { kind: "verification", found };
  }

  const preparedTransaction = await server.prepareTransaction(transaction);
  onStage?.("awaiting_authorization");
  const signed = await signTransaction(preparedTransaction.toXDR(), {
    networkPassphrase: config.networkPassphrase,
    address: sourceAddress,
  });
  if (signed.error) {
    const error = typeof signed.error === "string" ? signed.error : signed.error.message;
    throw new Error(error || "Wallet authorization failed.");
  }
  if (!signed.signedTxXdr) throw new Error("The wallet did not return a signed transaction.");

  const signedTransaction = TransactionBuilder.fromXDR(signed.signedTxXdr, config.networkPassphrase);
  const sent = await server.sendTransaction(signedTransaction);
  if (!sent.hash) {
    throw new Error(`The RPC server did not return a transaction hash (status: ${sent.status}).`);
  }
  if (sent.status === "ERROR" || sent.status === "TRY_AGAIN_LATER") {
    throw new TransactionSubmissionError(
      `The RPC server did not accept the transaction (status: ${sent.status}).`,
      sent.hash,
    );
  }
  onStage?.("submitted", sent.hash);
  return pollConfirmation(sent.hash);
}
