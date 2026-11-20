#!/usr/bin/env bash
set -euo pipefail

readonly TESTNET_NETWORK="testnet"
readonly TESTNET_RPC="https://soroban-testnet.stellar.org"
readonly TESTNET_PASSPHRASE="Test SDF Network ; September 2015"

NETWORK="${STELLAR_NETWORK:-$TESTNET_NETWORK}"
IDENTITY="${STELLAR_SOURCE:-vaultora-testnet}"
RPC_URL="${STELLAR_RPC_URL:-$TESTNET_RPC}"
PASSPHRASE="${STELLAR_NETWORK_PASSPHRASE:-$TESTNET_PASSPHRASE}"

if [[ "$NETWORK" != "$TESTNET_NETWORK" || "$RPC_URL" != "$TESTNET_RPC" || "$PASSPHRASE" != "$TESTNET_PASSPHRASE" ]]; then
  echo "Refusing to initialize a non-canonical Stellar Testnet configuration." >&2
  exit 2
fi
if ! command -v stellar >/dev/null 2>&1; then
  echo "Stellar CLI is required; see docs/TESTNET_DEPLOYMENT.md." >&2
  exit 127
fi

if stellar keys address "$IDENTITY" >/dev/null 2>&1; then
  echo "Identity alias '$IDENTITY' already exists; it was not overwritten."
else
  # CLI identity-generation output is captured and removed so a seed phrase can
  # never enter this script's normal output or CI logs.
  umask 077
  output_file="$(mktemp)"
  trap 'if command -v shred >/dev/null 2>&1; then shred -u "$output_file" 2>/dev/null || rm -f "$output_file"; else rm -f "$output_file"; fi' EXIT
  if ! stellar keys generate "$IDENTITY" --fund --network "$TESTNET_NETWORK" \
      --rpc-url "$TESTNET_RPC" --network-passphrase "$TESTNET_PASSPHRASE" \
      >"$output_file" 2>&1; then
    echo "Testnet identity creation/funding failed. No command output was shown to avoid exposing key material." >&2
    exit 1
  fi
  echo "Created and funded a dedicated Testnet identity alias '$IDENTITY'."
fi

ADDRESS="$(stellar keys address "$IDENTITY")"
if [[ ! "$ADDRESS" =~ ^G[A-Z2-7]{55}$ ]]; then
  echo "Stellar CLI did not return a valid public Testnet address; refusing to continue." >&2
  exit 1
fi
printf 'Network: %s\nPublic address: %s\n' "$TESTNET_NETWORK" "$ADDRESS"
printf 'Funded XLM is test-only. Identity secret remains in the local Stellar CLI configuration.\n'
printf 'To request test XLM manually if needed: https://friendbot.stellar.org/?addr=%s\n' "$ADDRESS"
