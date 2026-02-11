#!/usr/bin/env bash
# =============================================================================
# upload-dar.sh - Upload DAR to Validator's Ledger API and create parties/users
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"

# ---------------------------------------------------------------------------
# Load .env
# ---------------------------------------------------------------------------
if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found. Copy .env.example to .env and fill in values."
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"

LEDGER_API_HOST="${LEDGER_API_HOST:-localhost}"
LEDGER_API_PORT="${LEDGER_API_PORT:-5011}"
LEDGER_API_URL="http://${LEDGER_API_HOST}:${LEDGER_API_PORT}"
DAR_PATH="${DAR_PATH:?Set DAR_PATH in .env}"
VALIDATOR_WALLET_USER="${VALIDATOR_WALLET_USER:-wallet-user}"

# Resolve DAR path relative to script directory
if [[ ! "$DAR_PATH" = /* ]]; then
  DAR_PATH="${SCRIPT_DIR}/${DAR_PATH}"
fi

# ---------------------------------------------------------------------------
# Preflight checks
# ---------------------------------------------------------------------------
if [[ ! -f "$DAR_PATH" ]]; then
  echo "ERROR: DAR file not found at ${DAR_PATH}"
  echo "Run 'daml build' first to create the DAR."
  exit 1
fi

echo "==> Checking Ledger API connectivity ..."
if ! curl -sf "${LEDGER_API_URL}/v1/version" &>/dev/null; then
  echo "ERROR: Ledger API not reachable at ${LEDGER_API_URL}"
  echo "Ensure the Validator Node is running (./setup-validator.sh)"
  exit 1
fi
echo "==> Ledger API is reachable."

# ---------------------------------------------------------------------------
# Step 1: Upload DAR
# ---------------------------------------------------------------------------
echo "==> Uploading DAR: $(basename "$DAR_PATH") ..."
UPLOAD_RESPONSE=$(curl -sf "${LEDGER_API_URL}/v1/packages" \
  -F "dar=@${DAR_PATH}" 2>&1) || {
  echo "ERROR: DAR upload failed."
  echo "Response: ${UPLOAD_RESPONSE}"
  exit 1
}
echo "==> DAR uploaded successfully."

# ---------------------------------------------------------------------------
# Step 2: Allocate parties
# ---------------------------------------------------------------------------
allocate_party() {
  local display_name="$1"
  local party_hint="$2"

  echo "==> Allocating party: ${display_name} (hint: ${party_hint}) ..."
  local response
  response=$(curl -sf "${LEDGER_API_URL}/v1/parties/allocate" \
    -H "Content-Type: application/json" \
    -d "{\"displayName\": \"${display_name}\", \"identifierHint\": \"${party_hint}\"}" 2>&1) || {
    echo "WARNING: Party allocation may have failed (party might already exist)."
    echo "Response: ${response}"
    return 0
  }

  local party_id
  party_id=$(echo "$response" | grep -o '"identifier":"[^"]*"' | head -1 | cut -d'"' -f4)
  echo "==> Party allocated: ${party_id:-unknown}"
  echo "$party_id"
}

ALICE_PARTY=$(allocate_party "Alice" "alice")
BOB_PARTY=$(allocate_party "Bob" "bob")

# ---------------------------------------------------------------------------
# Step 3: Create users with party grants
# ---------------------------------------------------------------------------
create_user() {
  local user_id="$1"
  local primary_party="$2"

  echo "==> Creating user: ${user_id} ..."
  curl -sf "${LEDGER_API_URL}/v1/user/create" \
    -H "Content-Type: application/json" \
    -d "{
      \"userId\": \"${user_id}\",
      \"primaryParty\": \"${primary_party}\",
      \"rights\": [
        {\"type\": \"CanActAs\", \"party\": \"${primary_party}\"},
        {\"type\": \"CanReadAs\", \"party\": \"${primary_party}\"}
      ]
    }" &>/dev/null || {
    echo "WARNING: User creation may have failed (user might already exist)."
    return 0
  }
  echo "==> User ${user_id} created."
}

if [[ -n "$ALICE_PARTY" ]]; then
  create_user "alice" "$ALICE_PARTY"
fi
if [[ -n "$BOB_PARTY" ]]; then
  create_user "bob" "$BOB_PARTY"
fi

echo ""
echo "============================================="
echo " DAR upload and party setup complete."
echo ""
echo " Parties:"
echo "   Alice: ${ALICE_PARTY:-unknown}"
echo "   Bob:   ${BOB_PARTY:-unknown}"
echo ""
echo " Ledger API: ${LEDGER_API_URL}"
echo " Start the UI: cd ../ui && npm start"
echo "============================================="
