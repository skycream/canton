#!/usr/bin/env bash
# =============================================================================
# setup-validator.sh - Download Splice bundle, obtain onboarding secret,
#                      and start a Validator Node on Canton DevNet
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
SPLICE_DIR="${SCRIPT_DIR}/splice-node"

# ---------------------------------------------------------------------------
# Load .env
# ---------------------------------------------------------------------------
if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found. Copy .env.example to .env and fill in values."
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"

SPLICE_VERSION="${SPLICE_VERSION:?Set SPLICE_VERSION in .env}"
SV_SPONSOR_URL="${SV_SPONSOR_URL:?Set SV_SPONSOR_URL in .env}"
VALIDATOR_PARTY_HINT="${VALIDATOR_PARTY_HINT:?Set VALIDATOR_PARTY_HINT in .env}"

# ---------------------------------------------------------------------------
# Step 1: Download Splice bundle
# ---------------------------------------------------------------------------
BUNDLE_URL="https://github.com/digital-asset/decentralized-canton-sync/releases/download/v${SPLICE_VERSION}/splice-node-${SPLICE_VERSION}.tar.gz"
BUNDLE_TAR="${SCRIPT_DIR}/splice-node-${SPLICE_VERSION}.tar.gz"

if [[ -d "$SPLICE_DIR" ]]; then
  echo "Splice node directory already exists at ${SPLICE_DIR}"
  echo "Remove it to re-download, or skip to onboarding."
else
  echo "==> Downloading Splice v${SPLICE_VERSION} ..."
  if command -v curl &>/dev/null; then
    curl -fSL -o "$BUNDLE_TAR" "$BUNDLE_URL"
  elif command -v wget &>/dev/null; then
    wget -q -O "$BUNDLE_TAR" "$BUNDLE_URL"
  else
    echo "ERROR: Neither curl nor wget found."
    exit 1
  fi

  echo "==> Extracting to ${SPLICE_DIR} ..."
  mkdir -p "$SPLICE_DIR"
  tar -xzf "$BUNDLE_TAR" -C "$SPLICE_DIR" --strip-components=1
  rm -f "$BUNDLE_TAR"
  echo "==> Splice bundle extracted."
fi

# ---------------------------------------------------------------------------
# Step 2: Obtain onboarding secret from DevNet API
# ---------------------------------------------------------------------------
echo "==> Requesting onboarding secret from SV sponsor ..."
ONBOARD_RESPONSE=$(curl -sf "${SV_SPONSOR_URL}/api/sv/v0/devnet/onboard" \
  -H "Content-Type: application/json" \
  -d "{\"partyHint\": \"${VALIDATOR_PARTY_HINT}\"}" 2>&1) || {
  echo "ERROR: Failed to obtain onboarding secret."
  echo "Response: ${ONBOARD_RESPONSE}"
  echo ""
  echo "Ensure:"
  echo "  1. Your IP is whitelisted or VPN is active"
  echo "  2. SV_SPONSOR_URL is correct"
  echo "  3. DevNet is operational"
  exit 1
}

ONBOARDING_SECRET=$(echo "$ONBOARD_RESPONSE" | grep -o '"secret":"[^"]*"' | cut -d'"' -f4)
if [[ -z "$ONBOARDING_SECRET" ]]; then
  echo "ERROR: Could not parse onboarding secret from response."
  echo "Response: ${ONBOARD_RESPONSE}"
  exit 1
fi

echo "==> Onboarding secret obtained (valid for ~1 hour)."

# ---------------------------------------------------------------------------
# Step 3: Start Validator Node via Splice compose
# ---------------------------------------------------------------------------
echo "==> Starting Splice Validator Node ..."

export ONBOARDING_SECRET
export VALIDATOR_PARTY_HINT
export SPLICE_MIGRATION_ID="${SPLICE_MIGRATION_ID:-1}"
export POSTGRES_USER="${POSTGRES_USER:-canton}"
export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-supersecret}"

cd "$SPLICE_DIR"

if [[ -f "docker-compose.yml" ]]; then
  docker compose up -d
elif [[ -f "compose.yaml" ]]; then
  docker compose up -d
else
  echo "ERROR: No docker-compose file found in ${SPLICE_DIR}."
  echo "Check that the Splice bundle was extracted correctly."
  exit 1
fi

echo ""
echo "==> Validator Node starting. Checking health ..."

LEDGER_API_PORT="${LEDGER_API_PORT:-5011}"
for i in $(seq 1 30); do
  if curl -sf "http://localhost:${LEDGER_API_PORT}/v1/version" &>/dev/null; then
    echo "==> Validator Ledger API is ready on port ${LEDGER_API_PORT}."
    break
  fi
  if [[ $i -eq 30 ]]; then
    echo "WARNING: Ledger API not responding after 30 attempts."
    echo "Check logs: docker compose -f ${SPLICE_DIR}/docker-compose.yml logs"
  fi
  sleep 5
done

echo ""
echo "============================================="
echo " Splice Validator Node setup complete."
echo " Next step: ./upload-dar.sh"
echo "============================================="
