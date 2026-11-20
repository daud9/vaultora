import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  TransactionBuilder,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { signTransaction } from "@stellar/varial-sdk";
import { type DocumentOperation, type SorobanConfig } from "./sorobanConfig";
export type { DocumentOperation, SorobanConfig } from "./sorobanConfig";

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
}): Promise<ContractOperationResult> {
  const { operation, digest, metadataDigest, sourceAddress, config, onStage } = args;
  if (!config.contractId.trim()) {
    throw new Error("No contract is configured. Set VITE_STELLAR_CONTRACT_ID to enable on-chain actions.");
  }
  if (!sourceAddress.trim()) {
    throw new Error("Connect a wallet before invoking the contract.");
  }
  const contractArguments = buildDocumentContractArgs({
    operation,
    digest,
    metadataDigest,
    ownerAddress: sourceAddress,
  });
  const server = args.server ?? new rpc.Server(config.rpcUrl);
  if (operation === "register") onStage?.("preparing");
  const sourceAccount = await server.getAccount(sourceAddress);
  const contract = new Contract(config.contractId);
  const method = operation === "register" ? config.registerMethod : config.verifyMethod;
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

  const wait = args.wait ?? ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  for (let attempt = 0; attempt < 20; attempt += 1) {
    let result: Awaited<ReturnType<typeof server.getTransaction>>;
    try {
      result = await server.getTransaction(sent.hash);
    } catch (error) {
      const detail = error instanceof Error ? ` (${error.message})` : "";
      return {
        kind: "registered",
        hash: sent.hash,
        confirmation: "pending",
        message: `Submitted; the RPC confirmation lookup is unavailable${detail}. Check the transaction on the explorer.`,
      };
    }
    if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      return { kind: "registered", hash: sent.hash, confirmation: "confirmed" };
    }
    if (result.status === rpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`The submitted transaction failed on Testnet (${sent.hash}).`);
    }
    await wait(1_500);
  }
  return {
    kind: "registered",
    hash: sent.hash,
    confirmation: "pending",
    message: "Submitted; confirmation has not appeared yet. You can check the transaction on the explorer.",
  };
}
