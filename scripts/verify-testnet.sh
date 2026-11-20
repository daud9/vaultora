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
  echo "Refusing verification: only the canonical Stellar Testnet network, RPC, and passphrase are allowed." >&2
  exit 2
fi
if ! command -v stellar >/dev/null 2>&1; then
  echo "Stellar CLI is required; see docs/TESTNET_DEPLOYMENT.md." >&2
  exit 127
fi
if [[ -n "${STELLAR_CONTRACT_ID:-}" ]]; then
  CONTRACT_ID="$STELLAR_CONTRACT_ID"
else
  METADATA="$ROOT/.deployments/testnet.json"
  if [[ ! -f "$METADATA" ]]; then
    echo "Set STELLAR_CONTRACT_ID or deploy first with scripts/deploy-testnet.sh." >&2
    exit 1
  fi
  CONTRACT_ID="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["contract_id"])' "$METADATA")"
fi
if [[ ! "$CONTRACT_ID" =~ ^C[A-Z2-7]{55}$ ]]; then
  echo "Invalid contract ID; expected a Stellar contract address." >&2
  exit 2
fi
if [[ "$SOURCE" =~ ^G[A-Z2-7]{55}$ ]]; then
  OWNER="$SOURCE"
else
  if ! stellar keys address "$SOURCE" >/dev/null 2>&1; then
    echo "Identity alias '$SOURCE' is not available; run scripts/initialize-testnet.sh or set STELLAR_SOURCE to a public Testnet address." >&2
    exit 1
  fi
  OWNER="$(stellar keys address "$SOURCE")"
fi
if [[ ! "$OWNER" =~ ^G[A-Z2-7]{55}$ ]]; then
  echo "The source did not resolve to a valid Stellar public address." >&2
  exit 2
fi

# The all-zero fingerprint is an intentionally unknown value. A successful
# `false` result proves the read-only function is callable without inventing
# a record or submitting a transaction. The contract's parameter names are
# document_fingerprint; update only if the contract ABI changes deliberately.
set +e
RESULT="$(stellar contract invoke --id "$CONTRACT_ID" --source-account "$SOURCE" \
  --network "$TESTNET_NETWORK" --rpc-url "$TESTNET_RPC" \
  --network-passphrase "$TESTNET_PASSPHRASE" --send=no -- \
  document_exists --owner "$OWNER" --document_fingerprint "$(printf '0%.0s' {1..64})")"
STATUS=$?
set -e
if [[ $STATUS -ne 0 ]]; then
  echo "Read-only contract invocation failed (exit $STATUS). The deployment is not verified." >&2
  exit "$STATUS"
fi
if [[ "$RESULT" != "false" ]]; then
  echo "Unexpected read-only result: $RESULT" >&2
  echo "The deployment call completed, but the expected unknown-record result was not verified." >&2
  exit 1
fi
printf 'Read-only verification succeeded: document_exists returned false for an unknown fingerprint.\n'
printf 'Contract ID: %s\n' "$CONTRACT_ID"
printf 'No transaction was submitted.\n'
printf 'Explorer: https://steexp.com/contract/%s?network=testnet\n' "$CONTRACT_ID"
