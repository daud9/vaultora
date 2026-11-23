import { describe, expect, it, vi } from "vitest";
import { Account, Address, Keypair, StrKey, rpc, scValToNative, xdr } from "@stellar/stellar-sdk";
import { InvalidFileError, sha256File, validateFile } from "./fileHash";
import { connectWallet, walletErrorMessage } from "./wallet";
import { initialTransactionState, transactionReducer } from "./transactionState";
import { buildDocumentContractArgs, fingerprintToScVal, invokeDocumentContract } from "./soroban";

const abcSha256 = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

function fileWithArrayBuffer(name: string, contents: Uint8Array): File {
  const file = new File([contents.slice().buffer as ArrayBuffer], name);
  Object.defineProperty(file, "arrayBuffer", {
    value: async () => contents.slice().buffer,
  });
  return file;
}

describe("local SHA-256 file handling", () => {
  it("hashes file bytes with Web Crypto and returns a lowercase digest", async () => {
    const file = fileWithArrayBuffer("hello.txt", new TextEncoder().encode("abc"));
    const originalCrypto = globalThis.crypto;
    const digestBytes = Uint8Array.from(abcSha256.match(/.{2}/g)!, (byte) => Number.parseInt(byte, 16));
    const digest = vi.fn(async (algorithm: AlgorithmIdentifier, data: BufferSource) => {
      expect(algorithm).toBe("SHA-256");
      expect(new TextDecoder().decode(data as ArrayBuffer)).toBe("abc");
      return digestBytes.slice().buffer;
    });
    vi.stubGlobal("crypto", {
      subtle: { digest },
    });

    try {
      await expect(sha256File(file)).resolves.toEqual({
        fileName: "hello.txt",
        size: file.size,
        digest: abcSha256,
      });
      expect(digest).toHaveBeenCalledTimes(1);
    } finally {
      vi.stubGlobal("crypto", originalCrypto);
    }
  });

  it("rejects empty files and missing selections instead of hashing them", () => {
    const emptyFile = new File([], "empty.txt");
    expect(() => validateFile(emptyFile)).toThrow(InvalidFileError);
    expect(() => validateFile(null)).toThrow("Choose a file");
  });
});

describe("Soroban contract arguments and verification", () => {
  it("encodes registration fingerprints as exactly 32 bytes in contract order", () => {
    const owner = Keypair.random().publicKey();
    const args = buildDocumentContractArgs({
      operation: "register",
      digest: "ab".repeat(32),
      metadataDigest: "cd".repeat(32),
      ownerAddress: owner,
    });

    expect(args).toHaveLength(3);
    expect(Array.from(scValToNative(args[0]) as Uint8Array)).toEqual(Array.from(new Uint8Array(32).fill(0xab)));
    expect(Array.from(scValToNative(args[1]) as Uint8Array)).toEqual(Array.from(new Uint8Array(32).fill(0xcd)));
    expect(Address.fromScVal(args[2]).toString()).toBe(owner);
  });

  it("rejects malformed and missing fixed-size fingerprints", () => {
    expect(() => fingerprintToScVal("ab".repeat(31))).toThrow(/32-byte SHA-256/i);
    expect(() => buildDocumentContractArgs({
      operation: "register",
      digest: "ab".repeat(32),
      ownerAddress: Keypair.random().publicKey(),
    })).toThrow(/encrypted-metadata SHA-256 fingerprint is required/i);
  });

  it("orders verification arguments as owner then fingerprint", () => {
    const owner = Keypair.random().publicKey();
    const args = buildDocumentContractArgs({ operation: "verify", digest: "ef".repeat(32), ownerAddress: owner });
    expect(args).toHaveLength(2);
    expect(Address.fromScVal(args[0]).toString()).toBe(owner);
    expect(Array.from(scValToNative(args[1]) as Uint8Array)).toEqual(Array.from(new Uint8Array(32).fill(0xef)));
  });

  it("uses an unsigned read-only simulation and never prepares or sends a transaction", async () => {
    const owner = Keypair.random().publicKey();
    const server = {
      getAccount: vi.fn(async () => new Account(owner, "0")),
      simulateTransaction: vi.fn(async () => ({ result: { retval: xdr.ScVal.scvBool(true) } })),
      prepareTransaction: vi.fn(),
      sendTransaction: vi.fn(),
    };
    const onStage = vi.fn();
    const result = await invokeDocumentContract({
      operation: "verify",
      digest: "01".repeat(32),
      sourceAddress: owner,
      config: {
        rpcUrl: "https://soroban-testnet.stellar.org",
        networkPassphrase: "Test SDF Network ; September 2015",
        contractId: StrKey.encodeContract(new Uint8Array(32).fill(3)),
        registerMethod: "register_document",
        verifyMethod: "verify_document",
      },
      server: server as unknown as rpc.Server,
      onStage,
    });

    expect(result).toEqual({ kind: "verification", found: true });
    expect(server.simulateTransaction).toHaveBeenCalledTimes(1);
    expect(server.prepareTransaction).not.toHaveBeenCalled();
    expect(server.sendTransaction).not.toHaveBeenCalled();
    expect(onStage).not.toHaveBeenCalled();
  });

  it("rejects a non-Testnet RPC or passphrase before making an RPC request", async () => {
    const owner = Keypair.random().publicKey();
    const server = { getAccount: vi.fn() };
    await expect(invokeDocumentContract({
      operation: "verify",
      digest: "01".repeat(32),
      sourceAddress: owner,
      config: {
        rpcUrl: "https://soroban-mainnet.stellar.org",
        networkPassphrase: "Public Global Stellar Network ; September 2015",
        contractId: StrKey.encodeContract(new Uint8Array(32).fill(3)),
        registerMethod: "register_document",
        verifyMethod: "verify_document",
      },
      server: server as unknown as rpc.Server,
    })).rejects.toThrow(/Stellar Testnet only/i);
    expect(server.getAccount).not.toHaveBeenCalled();
  });
});

describe("Varial wallet adapter errors", () => {
  it("surfaces an extension/API rejection and does not invent a connected address", async () => {
    const api = {
      requestAccess: vi.fn().mockRejectedValue(new Error("Varial extension not found")),
      getNetworkDetails: vi.fn(),
    };
    await expect(connectWallet(api)).rejects.toThrow("Varial extension not found");
    expect(api.getNetworkDetails).not.toHaveBeenCalled();
    expect(walletErrorMessage(new Error("Varial extension not found"))).toMatch(/extension is installed/i);
  });

  it("rejects explicit wallet API errors", async () => {
    const api = {
      requestAccess: vi.fn().mockResolvedValue({ address: "", error: { message: "User rejected access" } }),
      getNetworkDetails: vi.fn(),
    };
    await expect(connectWallet(api)).rejects.toThrow("User rejected access");
  });
});

describe("transaction state handling", () => {
  it("keeps preparation, authorization, submission, and confirmation distinct", () => {
    const preparing = transactionReducer(initialTransactionState, { type: "START" });
    expect(preparing.stage).toBe("preparing");
    const authorizing = transactionReducer(preparing, { type: "REQUEST_AUTHORIZATION" });
    expect(authorizing.stage).toBe("awaiting_authorization");
    const submitted = transactionReducer(authorizing, { type: "SUBMITTED", hash: "abc123" });
    expect(submitted).toEqual({ stage: "submitted", hash: "abc123" });
    expect(transactionReducer(submitted, { type: "CONFIRMED" })).toEqual({
      stage: "confirmed",
      hash: "abc123",
    });
  });

  it("does not show a hash before submission and preserves it when a submitted transaction fails", () => {
    const preparing = transactionReducer(initialTransactionState, { type: "START" });
    expect(preparing.hash).toBeUndefined();
    const failedBeforeSubmit = transactionReducer(preparing, { type: "FAILED", message: "Rejected" });
    expect(failedBeforeSubmit).toEqual({ stage: "failed", message: "Rejected" });

    const submitted = transactionReducer(
      transactionReducer(preparing, { type: "REQUEST_AUTHORIZATION" }),
      { type: "SUBMITTED", hash: "real-network-hash" },
    );
    expect(transactionReducer(submitted, { type: "FAILED", message: "On-chain failure" })).toEqual({
      stage: "failed",
      message: "On-chain failure",
      hash: "real-network-hash",
    });
  });

  it("ignores invalid state skips", () => {
    expect(transactionReducer(initialTransactionState, { type: "SUBMITTED", hash: "not-submitted" })).toBe(initialTransactionState);
  });
});
