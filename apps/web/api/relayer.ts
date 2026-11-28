/**
 * Self-hosted VAULTORA Testnet relayer entry point (`POST /api/relayer`).
 *
 * Thin wrapper on purpose: this file has NO runtime imports, so it can
 * always load. It dynamically imports the real implementation
 * (`./relayer-handler`, which pulls in `@stellar/stellar-sdk`) inside the
 * request handler and answers with JSON even when that import fails.
 *
 * Why: on 2026-11-28 the live preview answered a real wallet deployment
 * with a bare platform 500 and no JSON body, while the identical handler
 * code returned 200 and deployed a real smart account locally (Testnet
 * tx 60ce5ec6…e3314a, ledger 5961664). The handler's own code paths never
 * return 500, so the failure happened outside them — at module load or
 * in the response helpers. Both are fixed here: the implementation loads
 * lazily behind a try/catch that returns the real error as JSON, and all
 * responses use raw Node methods (see `relayer-handler.ts`).
 *
 * If the next attempt still fails, the app will now show the actual
 * cause instead of "status 500".
 */
import type { RelayerRequest, RelayerResponse } from "./relayer-handler";

function sendJsonError(res: RelayerResponse, status: number, message: string): void {
  const body = JSON.stringify({ success: false, error: message, message });
  try {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(body);
    return;
  } catch {
    // Fall through to the Express-style helpers.
  }
  try {
    res.setHeader("Content-Type", "application/json");
    res.status?.(status)?.json?.({ success: false, error: message, message });
  } catch {
    try {
      res.end();
    } catch {
      // Nothing left to do.
    }
  }
}

export default async function relayerEntry(
  req: RelayerRequest,
  res: RelayerResponse,
): Promise<void> {
  try {
    const { createRelayerHandler } = await import("./relayer-handler.js");
    const handler = createRelayerHandler();
    await handler(req, res);
  } catch (error) {
    // Load/start failure: say so in JSON (never a bare platform 500).
    // Messages here come from the SDK / runtime, never from secrets.
    const message =
      error instanceof Error && error.message
        ? `Relayer failed to start: ${error.message.slice(0, 200)}`
        : "Relayer failed to start.";
    sendJsonError(res, 502, message);
  }
}
