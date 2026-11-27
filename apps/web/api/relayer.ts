/**
 * Self-hosted VAULTORA Testnet relayer (`POST /api/relayer`).
 *
 * Same-origin Vercel serverless function (Node runtime). The browser posts
 * `{ func, auth }` base64 XDR strings — exactly what
 * `smart-account-kit`'s `RelayerClient.send()` posts — and this function
 * builds the transaction envelope with a sponsor Testnet account as
 * source, simulates it, signs it with the sponsor keypair, submits it to
 * Soroban Testnet RPC, and returns `{ success: true, hash }`. The kit
 * polls RPC itself for confirmation after it receives the hash, so this
 * function returns as soon as the transaction is accepted (PENDING);
 * it does not wait for confirmation.
 *
 * Why this exists: the shared SDF relayer proxy
 * (smart-account-relayer-proxy.sdf-ecosystem.workers.dev) returns
 * 403 `{"success":false,"error":"Origin is not allowed"}` for every
 * request carrying an `Origin` header — preview, production, localhost
 * and lab.stellar.org were all rejected (verified 2026-11-27). Browsers
 * always send `Origin` on cross-origin fetch, so no browser app can use
 * it. This function runs on the same origin as the app, so there is no
 * cross-origin fetch and no CORS problem at all.
 *
 * Security model (Testnet only):
 *  - Every payload is classified by `api/relayer-validation.ts` first.
 *    Only a smart-account deployment (known WASM hash), a
 *    `register_document` call on the registry contract, or an
 *    `add_signer` / `batch_add_signer` call on a contract whose on-chain
 *    code hash is the known smart-account WASM hash is sponsored.
 *    Everything else is rejected before any RPC call is made.
 *  - A failed simulation means nothing is submitted and no fee is spent.
 *  - The sponsor secret lives only in the `VAULTORA_RELAYER_SPONSOR_SECRET`
 *    Vercel env var (target: preview). It is read from `process.env`
 *    here and nowhere else, never logged, never returned, and never
 *    stored in the repo. The sponsor holds only Testnet XLM, which has
 *    no monetary value.
 *  - Best-effort per-IP rate limiting (20 requests / 10 minutes) and a
 *    64 KB body cap. The limit is per function instance, so it is
 *    approximate under concurrency — the real control is the payload
 *    allowlist. Residual abuse surface is documented in
 *    docs/PASSKEY_WALLET.md.
 *
 * The faucet (`kit.fundWallet`) does NOT use this endpoint: it funds
 * through Friendbot plus direct RPC submission. Do not reroute it here.
 */
import {
  Account,
  Address,
  BASE_FEE,
  Keypair,
  Operation,
  TransactionBuilder,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import {
  RELAYER_ACCOUNT_WASM_HASH,
  RELAYER_MAX_BODY_BYTES,
  classifyRelayerPayload,
  hexEncode,
} from "./relayer-validation";

// `process` is declared locally so this file typechecks under the app's
// tsconfig, which does not include `@types/node`.
declare const process: { env: Record<string, string | undefined> };

const STELLAR_TESTNET_RPC_URL = "https://soroban-testnet.stellar.org";
const STELLAR_TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
const SPONSOR_SECRET_ENV = "VAULTORA_RELAYER_SPONSOR_SECRET";

/** Origins that may read relayer responses (the app's own origins). */
const ALLOWED_ORIGINS = new Set([
  "https://vaultora-git-passkey-smart-wallet-sheik-s-projects1.vercel.app",
  "https://vaultora-flax.vercel.app",
  "http://localhost:5173",
]);

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 20;
const SUBMIT_ATTEMPTS = 3;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

type RpcServer = Pick<
  rpc.Server,
  "getAccount" | "getLedgerEntries" | "simulateTransaction" | "sendTransaction"
>;

export interface RelayerRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  socket?: { remoteAddress?: string };
}

export interface RelayerResponse {
  status(code: number): RelayerResponse;
  setHeader(name: string, value: string): void;
  json(body: unknown): void;
  end(): void;
}

export interface RelayerHandlerDeps {
  /** Overrides `process.env[VAULTORA_RELAYER_SPONSOR_SECRET]` (tests). */
  sponsorSecret?: string;
  /** Overrides `new rpc.Server(...)` (tests). */
  createServer?: () => RpcServer;
  /** Overrides the module-level rate-limit store (tests). */
  rateLimitStore?: Map<string, { count: number; resetAt: number }>;
  /** Overrides `Date.now()` (tests). */
  now?: () => number;
}

class RelayerFailure extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function clientIp(req: RelayerRequest): string {
  const forwarded = firstHeader(req.headers["x-forwarded-for"]);
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return req.socket?.remoteAddress || "unknown";
}

function corsHeaders(req: RelayerRequest): Record<string, string> {
  const origin = firstHeader(req.headers["origin"]);
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    return { "Access-Control-Allow-Origin": origin, Vary: "Origin" };
  }
  return {};
}

function sendJson(
  res: RelayerResponse,
  req: RelayerRequest,
  status: number,
  body: unknown,
): void {
  for (const [name, value] of Object.entries(corsHeaders(req))) {
    res.setHeader(name, value);
  }
  res.setHeader("Content-Type", "application/json");
  res.status(status).json(body);
}

function failureBody(message: string): { success: false; error: string; message: string } {
  return { success: false, error: message, message };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Read the WASM hash of a deployed contract from its on-chain instance
 * entry. Returns null when the entry is missing or is not a WASM
 * contract. Defensive property traversal: the SDK 17 XDR accessors are
 * properties, and a malformed entry must read as "not verified", never
 * throw into the handler.
 */
function contractWasmHashFromEntry(entry: unknown): string | null {
  try {
    const e = entry as {
      val?: {
        contractData?: {
          val?: { instance?: { executable?: { type?: unknown; wasmHash?: { value?: unknown } } } };
        };
      };
    };
    const executable = e.val?.contractData?.val?.instance?.executable;
    if (!executable || executable.type !== "contractExecutableWasm") return null;
    const value = executable.wasmHash?.value;
    if (!(value instanceof Uint8Array)) return null;
    return hexEncode(value);
  } catch {
    return null;
  }
}

async function verifyWalletAdminTarget(
  server: RpcServer,
  contractId: string,
): Promise<void> {
  const ledgerKey = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contractId).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent,
    }),
  );
  let entries: unknown[];
  try {
    const result = await server.getLedgerEntries(ledgerKey);
    entries = result.entries ?? [];
  } catch {
    throw new RelayerFailure(502, "The Testnet network did not respond. Try again.");
  }
  const hash = entries.length === 1 ? contractWasmHashFromEntry(entries[0]) : null;
  if (hash !== RELAYER_ACCOUNT_WASM_HASH) {
    throw new RelayerFailure(400, "Target is not a VAULTORA smart account.");
  }
}

async function submitSponsored(
  server: RpcServer,
  sponsor: Keypair,
  func: xdr.HostFunction,
  auth: xdr.SorobanAuthorizationEntry[],
): Promise<string> {
  let lastError: RelayerFailure | null = null;
  for (let attempt = 1; attempt <= SUBMIT_ATTEMPTS; attempt += 1) {
    try {
      const source: Account = await server.getAccount(sponsor.publicKey());
      const transaction = new TransactionBuilder(source, {
        fee: BASE_FEE,
        networkPassphrase: STELLAR_TESTNET_PASSPHRASE,
      })
        .setTimeout(180)
        .addOperation(Operation.invokeHostFunction({ func, auth }))
        .build();
      const simulation = await server.simulateTransaction(transaction);
      if ("error" in simulation) {
        const detail = typeof simulation.error === "string" ? simulation.error : "";
        throw new RelayerFailure(
          400,
          `Transaction simulation failed${detail ? `: ${detail.slice(0, 200)}` : "."}`,
        );
      }
      const prepared = rpc.assembleTransaction(transaction, simulation).build();
      prepared.sign(sponsor);
      const sent = await server.sendTransaction(prepared);
      if (sent.status === "PENDING" || sent.status === "DUPLICATE") {
        const hash = typeof sent.hash === "string" ? sent.hash.toLowerCase() : "";
        if (!HASH_PATTERN.test(hash)) {
          throw new RelayerFailure(502, "The network returned an invalid transaction hash.");
        }
        return hash;
      }
      if (sent.status === "TRY_AGAIN_LATER") {
        lastError = new RelayerFailure(502, "The network is busy. Try again.");
        if (attempt < SUBMIT_ATTEMPTS) {
          await sleep(1000);
          continue;
        }
        throw lastError;
      }
      throw new RelayerFailure(400, "The network rejected the transaction.");
    } catch (error) {
      if (error instanceof RelayerFailure) {
        // Simulation / rejection failures are final; transport failures
        // and busy-network responses are retried with a fresh sequence.
        if (error.status === 400 || attempt >= SUBMIT_ATTEMPTS) throw error;
        lastError = error;
        await sleep(1000);
        continue;
      }
      lastError = new RelayerFailure(502, "The Testnet network did not respond. Try again.");
      if (attempt >= SUBMIT_ATTEMPTS) throw lastError;
      await sleep(1000);
    }
  }
  throw lastError ?? new RelayerFailure(502, "The Testnet network did not respond. Try again.");
}

export function createRelayerHandler(deps: RelayerHandlerDeps = {}) {
  const store = deps.rateLimitStore ?? rateLimitStore;
  const now = deps.now ?? Date.now;
  const createServer =
    deps.createServer ?? (() => new rpc.Server(STELLAR_TESTNET_RPC_URL));

  return async function relayerHandler(req: RelayerRequest, res: RelayerResponse): Promise<void> {
    try {
      if (req.method === "OPTIONS") {
        const headers = corsHeaders(req);
        for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
        res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
        res.setHeader(
          "Access-Control-Allow-Headers",
          "Content-Type, X-Client-Name, X-Client-Version",
        );
        res.setHeader("Access-Control-Max-Age", "86400");
        res.status(204).end();
        return;
      }
      if (req.method !== "POST") {
        sendJson(res, req, 405, failureBody("Method not allowed."));
        return;
      }

      const contentLength = Number(firstHeader(req.headers["content-length"]) ?? 0);
      if (Number.isFinite(contentLength) && contentLength > RELAYER_MAX_BODY_BYTES) {
        sendJson(res, req, 413, failureBody("Request is too large."));
        return;
      }

      const ip = clientIp(req);
      const startedAt = now();
      const bucket = store.get(ip);
      if (!bucket || startedAt >= bucket.resetAt) {
        store.set(ip, { count: 1, resetAt: startedAt + RATE_LIMIT_WINDOW_MS });
      } else if (bucket.count >= RATE_LIMIT_MAX_REQUESTS) {
        sendJson(res, req, 429, failureBody("Too many requests. Try again later."));
        return;
      } else {
        bucket.count += 1;
      }

      let body: unknown = req.body;
      if (typeof body === "string") {
        if (body.length > RELAYER_MAX_BODY_BYTES) {
          sendJson(res, req, 413, failureBody("Request is too large."));
          return;
        }
        try {
          body = JSON.parse(body) as unknown;
        } catch {
          sendJson(res, req, 400, failureBody("Invalid request body."));
          return;
        }
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        sendJson(res, req, 400, failureBody("Invalid request body."));
        return;
      }
      const payload = body as { func?: unknown; auth?: unknown };
      const classified = classifyRelayerPayload(payload.func, payload.auth);
      if (!classified.ok) {
        sendJson(res, req, 400, failureBody(classified.error));
        return;
      }

      const secret = deps.sponsorSecret ?? process.env[SPONSOR_SECRET_ENV];
      if (!secret || !secret.trim()) {
        sendJson(res, req, 503, failureBody("Relayer is not configured."));
        return;
      }
      let sponsor: Keypair;
      try {
        sponsor = Keypair.fromSecret(secret.trim());
      } catch {
        sendJson(res, req, 503, failureBody("Relayer is not configured."));
        return;
      }

      const server = createServer();
      if (classified.kind === "wallet-admin" && classified.contractId) {
        await verifyWalletAdminTarget(server, classified.contractId);
      }
      const hash = await submitSponsored(server, sponsor, classified.func, classified.auth);
      // The kit polls RPC itself for confirmation; return as soon as the
      // transaction is accepted.
      sendJson(res, req, 200, { success: true, hash });
    } catch (error) {
      if (error instanceof RelayerFailure) {
        sendJson(res, req, error.status, failureBody(error.message));
        return;
      }
      sendJson(res, req, 502, failureBody("The Testnet network did not respond. Try again."));
    }
  };
}

export default createRelayerHandler();
