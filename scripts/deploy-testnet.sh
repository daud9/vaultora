#!/usr/bin/env bash
set -euo pipefail

readonly TESTNET_NETWORK="testnet"
readonly TESTNET_RPC="https://soroban-testnet.stellar.org"
readonly TESTNET_PASSPHRASE="Test SDF Network ; September 2015"
readonly ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NETWORK="${STELLAR_NETWORK:-$TESTNET_NETWORK}"
SOURCE="${STELLAR_SOURCE:-vaultora-testnet}"
RPC_URL="${STELLAR_RPC_URL:-$TESTNET_RPC}"
PASSPHRASE="${STELLAR_NETWORK_PASSPHRASE:-$TESTNET_PASSPHRASE}"

if [[ "$NETWORK" != "$TESTNET_NETWORK" || "$RPC_URL" != "$TESTNET_RPC" || "$PASSPHRASE" != "$TESTNET_PASSPHRASE" ]]; then
  echo "Refusing deployment: only the canonical Stellar Testnet network, RPC, and passphrase are allowed." >&2
  exit 2
fi
if ! command -v stellar >/dev/null 2>&1; then
  echo "Stellar CLI is required; see docs/TESTNET_DEPLOYMENT.md." >&2
  exit 127
fi
if ! stellar keys address "$SOURCE" >/dev/null 2>&1; then
  echo "Identity alias '$SOURCE' is not available. Run scripts/initialize-testnet.sh first." >&2
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 is required to write deployment metadata safely." >&2
  exit 127
fi

cd "$ROOT"
echo "Building Soroban contract with Stellar CLI on Testnet..."
stellar contract build --locked --package document-registry
WASM="$ROOT/target/wasm32v1-none/release/document_registry.wasm"
if [[ ! -s "$WASM" ]]; then
  echo "Expected Wasm artifact was not produced: $WASM" >&2
  exit 1
fi

echo "Deploying '$WASM' to Stellar Testnet using identity '$SOURCE'."
# Stellar CLI intentionally writes the contract ID alone to stdout. Do not mix
# stderr log messages into the parsed value.
CONTRACT_ID="$(stellar contract deploy --wasm "$WASM" --source-account "$SOURCE" \
  --network "$TESTNET_NETWORK" --rpc-url "$TESTNET_RPC" \
  --network-passphrase "$TESTNET_PASSPHRASE")"
if [[ ! "$CONTRACT_ID" =~ ^C[A-Z2-7]{55}$ ]]; then
  echo "Deployment returned no valid contract ID; no metadata was written." >&2
  exit 1
fi

mkdir -p "$ROOT/.deployments"
chmod 700 "$ROOT/.deployments"
python3 - "$ROOT/.deployments/testnet.json" "$CONTRACT_ID" "$SOURCE" "$RPC_URL" "$PASSPHRASE" <<'PY'
import json, os, subprocess, sys
path, contract_id, source, rpc_url, passphrase = sys.argv[1:]
try:
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True, stderr=subprocess.DEVNULL).strip()
except Exception:
    commit = None
record = {
    "network": "testnet",
    "rpc_url": rpc_url,
    "network_passphrase": passphrase,
    "contract_id": contract_id,
    "source_identity_alias": source,
    "deployed_at_utc": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
    "git_commit": commit,
}
tmp = path + ".tmp"
with open(tmp, "w", encoding="utf-8") as f:
    json.dump(record, f, indent=2)
    f.write("\n")
os.chmod(tmp, 0o600)
os.replace(tmp, path)
PY

printf 'Contract ID: %s\n' "$CONTRACT_ID"
printf 'Deployment metadata (local and Git-ignored): %s\n' "$ROOT/.deployments/testnet.json"
printf 'Explorer: https://steexp.com/contract/%s?network=testnet\n' "$CONTRACT_ID"
printf 'Next: scripts/verify-testnet.sh\n'
