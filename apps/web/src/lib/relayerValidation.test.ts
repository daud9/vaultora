/**
 * Unit tests for the self-hosted Testnet relayer allowlist
 * (`apps/web/api/relayer-validation.ts`) and for the response shape of
 * the handler (`apps/web/api/relayer.ts`) on its rejection paths.
 *
 * The happy path (a real sponsored submission returning a hash) is not
 * faked here: it is verified live against the deployed preview in
 * step 7 of the relayer work, because faking `simulateTransaction` /
 * `assembleTransaction` would test the fake, not the SDK. These tests
 * prove the security boundary instead: nothing but a known
 * smart-account deployment, a registry `register_document` call, or a
 * signer-admin call on a genuine VAULTORA smart account is sponsored.
 */
import { describe, expect, it } from "vitest";
import { Address, Keypair, StrKey, xdr } from "@stellar/stellar-sdk";
import {
  RELAYER_ACCOUNT_WASM_HASH,
  RELAYER_REGISTRY_CONTRACT_ID,
  classifyRelayerFunc,
  classifyRelayerPayload,
  parseRelayerAuth,
} from "../../api/relayer-validation";
import { createRelayerHandler } from "../../api/relayer-handler";
import type { RelayerRequest, RelayerResponse } from "../../api/relayer-handler";

const ZERO_ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const OTHER_CONTRACT = StrKey.encodeContract(new Uint8Array(32).fill(9));
const SAC_CONTRACT = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

function hexDecode(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function asciiBytes(value: string): Uint8Array {
  return Uint8Array.from([...value].map((c) => c.charCodeAt(0)));
}

function deployFunc(wasmHashHex: string = RELAYER_ACCOUNT_WASM_HASH): string {
  const salt = new Uint8Array(32).fill(7);
  const preimage = xdr.ContractIdPreimage.contractIdPreimageFromAddress(
    new xdr.ContractIdPreimageFromAddress({
      address: new Address(ZERO_ADDRESS).toScAddress(),
      salt,
    }),
  );
  return xdr.HostFunction.hostFunctionTypeCreateContractV2(
    new xdr.CreateContractArgsV2({
      contractIdPreimage: preimage,
      executable: xdr.ContractExecutable.contractExecutableWasm(
        hexDecode(wasmHashHex),
      ),
      constructorArgs: [],
    }),
  ).toXDR("base64");
}

function deployFuncV1(): string {
  const salt = new Uint8Array(32).fill(7);
  const preimage = xdr.ContractIdPreimage.contractIdPreimageFromAddress(
    new xdr.ContractIdPreimageFromAddress({
      address: new Address(ZERO_ADDRESS).toScAddress(),
      salt,
    }),
  );
  return xdr.HostFunction.hostFunctionTypeCreateContract(
    new xdr.CreateContractArgs({
      contractIdPreimage: preimage,
      executable: xdr.ContractExecutable.contractExecutableWasm(
        hexDecode(RELAYER_ACCOUNT_WASM_HASH),
      ),
    }),
  ).toXDR("base64");
}

function deployFuncStellarAsset(): string {
  const salt = new Uint8Array(32).fill(7);
  const preimage = xdr.ContractIdPreimage.contractIdPreimageFromAddress(
    new xdr.ContractIdPreimageFromAddress({
      address: new Address(ZERO_ADDRESS).toScAddress(),
      salt,
    }),
  );
  return xdr.HostFunction.hostFunctionTypeCreateContractV2(
    new xdr.CreateContractArgsV2({
      contractIdPreimage: preimage,
      executable: xdr.ContractExecutable.contractExecutableStellarAsset(),
      constructorArgs: [],
    }),
  ).toXDR("base64");
}

function invokeFunc(contractId: string, functionName: string): string {
  return xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: new Address(contractId).toScAddress(),
      functionName: asciiBytes(functionName),
      args: [],
    }),
  ).toXDR("base64");
}

function validAuthEntry(): string {
  const salt = new Uint8Array(32).fill(7);
  const preimage = xdr.ContractIdPreimage.contractIdPreimageFromAddress(
    new xdr.ContractIdPreimageFromAddress({
      address: new Address(ZERO_ADDRESS).toScAddress(),
      salt,
    }),
  );
  const createArgs = new xdr.CreateContractArgsV2({
    contractIdPreimage: preimage,
    executable: xdr.ContractExecutable.contractExecutableWasm(
      hexDecode(RELAYER_ACCOUNT_WASM_HASH),
    ),
    constructorArgs: [],
  });
  const fn =
    xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeCreateContractHostFn(
      createArgs,
    );
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: fn,
    subInvocations: [],
  });
  const entry = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
    rootInvocation: invocation,
  });
  return entry.toXDR("base64");
}

describe("classifyRelayerFunc", () => {
  it("allows a deployment of the known account WASM hash", () => {
    const result = classifyRelayerFunc(deployFunc());
    expect(result).toEqual({ ok: true, kind: "deploy" });
  });

  it("rejects a deployment of an unknown WASM hash", () => {
    const result = classifyRelayerFunc(deployFunc("00".repeat(32)));
    expect(result.ok).toBe(false);
  });

  it("rejects V1 contract creation", () => {
    const result = classifyRelayerFunc(deployFuncV1());
    expect(result.ok).toBe(false);
  });

  it("rejects a Stellar-asset executable", () => {
    const result = classifyRelayerFunc(deployFuncStellarAsset());
    expect(result.ok).toBe(false);
  });

  it("allows register_document on the registry contract", () => {
    const result = classifyRelayerFunc(
      invokeFunc(RELAYER_REGISTRY_CONTRACT_ID, "register_document"),
    );
    expect(result).toEqual({
      ok: true,
      kind: "register",
      contractId: RELAYER_REGISTRY_CONTRACT_ID,
      functionName: "register_document",
    });
  });

  it("rejects register_document on any other contract", () => {
    const result = classifyRelayerFunc(invokeFunc(OTHER_CONTRACT, "register_document"));
    expect(result.ok).toBe(false);
  });

  it("rejects a token transfer on the native-token SAC", () => {
    const result = classifyRelayerFunc(invokeFunc(SAC_CONTRACT, "transfer"));
    expect(result.ok).toBe(false);
  });

  it("rejects an arbitrary contract call", () => {
    const result = classifyRelayerFunc(invokeFunc(OTHER_CONTRACT, "execute"));
    expect(result.ok).toBe(false);
  });

  it("classifies add_signer on a contract as wallet-admin (on-chain WASM check still required)", () => {
    const result = classifyRelayerFunc(invokeFunc(OTHER_CONTRACT, "add_signer"));
    expect(result).toEqual({
      ok: true,
      kind: "wallet-admin",
      contractId: OTHER_CONTRACT,
      functionName: "add_signer",
    });
  });

  it("classifies batch_add_signer as wallet-admin", () => {
    const result = classifyRelayerFunc(invokeFunc(OTHER_CONTRACT, "batch_add_signer"));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.kind).toBe("wallet-admin");
  });

  it("rejects malformed, empty, and non-string func values", () => {
    expect(classifyRelayerFunc("not-base64!!!").ok).toBe(false);
    expect(classifyRelayerFunc("").ok).toBe(false);
    expect(classifyRelayerFunc(undefined).ok).toBe(false);
    expect(classifyRelayerFunc(42).ok).toBe(false);
    // Valid base64 that is not a HostFunction.
    expect(classifyRelayerFunc(btoa("hello")).ok).toBe(false);
  });
});

describe("parseRelayerAuth", () => {
  it("accepts a decodable authorization entry", () => {
    const result = parseRelayerAuth([validAuthEntry()]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.entries).toHaveLength(1);
  });

  it("rejects garbage, empty, oversized, and non-array auth", () => {
    expect(parseRelayerAuth(["%%%"]).ok).toBe(false);
    expect(parseRelayerAuth([]).ok).toBe(false);
    expect(parseRelayerAuth(undefined).ok).toBe(false);
    expect(parseRelayerAuth("x").ok).toBe(false);
    expect(parseRelayerAuth(Array.from({ length: 11 }, () => validAuthEntry())).ok).toBe(
      false,
    );
  });
});

describe("classifyRelayerPayload", () => {
  it("accepts a deployment with a valid auth entry", () => {
    const result = classifyRelayerPayload(deployFunc(), [validAuthEntry()]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.kind).toBe("deploy");
  });

  it("rejects a valid func with invalid auth", () => {
    const result = classifyRelayerPayload(deployFunc(), ["%%%"]);
    expect(result.ok).toBe(false);
  });
});

function mockResponse(): { res: RelayerResponse; captured: { status?: number; body?: unknown } } {
  const captured: { status?: number; body?: unknown } = {};
  const res = {
    // Raw Node path (what the handler uses first).
    writeHead(code: number) {
      captured.status = code;
    },
    setHeader() {},
    end(payload?: string) {
      if (payload) captured.body = JSON.parse(payload);
    },
    // Express-style fallback path.
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(body: unknown) {
      captured.body = body;
    },
  } as unknown as RelayerResponse;
  return { res, captured };
}

function mockRequest(
  method: string | undefined,
  body?: unknown,
  headers: Record<string, string> = {},
): RelayerRequest {
  return { method, headers, body, socket: { remoteAddress: "127.0.0.1" } };
}

describe("relayer handler response shape", () => {
  it("rejects non-POST methods with 405 and a {success:false} body", async () => {
    const handler = createRelayerHandler({ rateLimitStore: new Map() });
    const { res, captured } = mockResponse();
    await handler(mockRequest("GET"), res);
    expect(captured.status).toBe(405);
    expect(captured.body).toMatchObject({ success: false });
  });

  it("answers OPTIONS with 204", async () => {
    const handler = createRelayerHandler({ rateLimitStore: new Map() });
    const { res, captured } = mockResponse();
    await handler(mockRequest("OPTIONS"), res);
    expect(captured.status).toBe(204);
  });

  it("rejects an arbitrary transfer with 400 before touching RPC", async () => {
    let rpcCalls = 0;
    const handler = createRelayerHandler({
      rateLimitStore: new Map(),
      sponsorSecret: Keypair.random().secret(),
      createServer: () => {
        rpcCalls += 1;
        throw new Error("must not be called");
      },
    });
    const { res, captured } = mockResponse();
    await handler(
      mockRequest("POST", {
        func: invokeFunc(SAC_CONTRACT, "transfer"),
        auth: [validAuthEntry()],
      }),
      res,
    );
    expect(captured.status).toBe(400);
    expect(captured.body).toMatchObject({ success: false });
    expect(rpcCalls).toBe(0);
  });

  it("returns 503 when the sponsor secret is not configured", async () => {
    const handler = createRelayerHandler({
      rateLimitStore: new Map(),
      sponsorSecret: "",
      createServer: () => {
        throw new Error("must not be called");
      },
    });
    const { res, captured } = mockResponse();
    await handler(
      mockRequest("POST", { func: deployFunc(), auth: [validAuthEntry()] }),
      res,
    );
    expect(captured.status).toBe(503);
    expect(captured.body).toMatchObject({ success: false });
  });

  it("rejects a wallet-admin call on a contract whose code is not the account WASM", async () => {
    const fakeEntry = {
      val: {
        contractData: {
          val: {
            instance: {
              executable: {
                type: "contractExecutableWasm",
                wasmHash: { value: new Uint8Array(32).fill(0) },
              },
            },
          },
        },
      },
    };
    const handler = createRelayerHandler({
      rateLimitStore: new Map(),
      sponsorSecret: Keypair.random().secret(),
      createServer: () =>
        ({
          getLedgerEntries: async () => ({ entries: [fakeEntry], latestLedger: 1 }),
          getAccount: async () => {
            throw new Error("must not be called");
          },
          simulateTransaction: async () => {
            throw new Error("must not be called");
          },
          sendTransaction: async () => {
            throw new Error("must not be called");
          },
        }) as never,
    });
    const { res, captured } = mockResponse();
    await handler(
      mockRequest("POST", {
        func: invokeFunc(OTHER_CONTRACT, "add_signer"),
        auth: [validAuthEntry()],
      }),
      res,
    );
    expect(captured.status).toBe(400);
    expect(captured.body).toMatchObject({ success: false });
  });

  it("rate-limits a single IP after 20 requests", async () => {
    const handler = createRelayerHandler({
      rateLimitStore: new Map(),
      now: () => 0,
    });
    // POSTs reach the rate limiter (GETs are rejected as 405 first);
    // the first 20 fail validation with 400, the 21st is rate-limited.
    let lastStatus: number | undefined;
    for (let i = 0; i < 21; i += 1) {
      const { res, captured } = mockResponse();
      await handler(mockRequest("POST", {}), res);
      lastStatus = captured.status;
    }
    expect(lastStatus).toBe(429);
  });
});
