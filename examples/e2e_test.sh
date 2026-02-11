#!/bin/bash
# CAP Protocol - E2E Test via API Gateway
set -e

API="http://localhost:4000"
PASS=0
FAIL=0

check() {
  local desc="$1"
  local result="$2"
  local expected="$3"
  if echo "$result" | grep -q "$expected"; then
    echo "  [PASS] $desc"
    PASS=$((PASS + 1))
  else
    echo "  [FAIL] $desc"
    echo "         Expected to contain: $expected"
    echo "         Got: $(echo "$result" | head -c 200)"
    FAIL=$((FAIL + 1))
  fi
}

echo ""
echo "========================================="
echo "  CAP Protocol - E2E Test Suite"
echo "========================================="
echo ""

# Helper: resolve party IDs
TOKEN=$(echo -n '{"alg":"HS256","typ":"JWT"}' | base64 | tr '+/' '-_' | tr -d '=').$(echo -n '{"sub":"alice","scope":"daml_ledger_api"}' | base64 | tr '+/' '-_' | tr -d '=').
PARTIES=$(curl -s http://localhost:7575/v1/parties -H "Authorization: Bearer $TOKEN" -H "Accept: application/json")
ALICE=$(echo "$PARTIES" | python3 -c "import sys,json; [print(p['identifier']) for p in json.load(sys.stdin)['result'] if p.get('displayName')=='Alice']")
BOB=$(echo "$PARTIES" | python3 -c "import sys,json; [print(p['identifier']) for p in json.load(sys.stdin)['result'] if p.get('displayName')=='Bob']")
CHARLIE=$(echo "$PARTIES" | python3 -c "import sys,json; [print(p['identifier']) for p in json.load(sys.stdin)['result'] if p.get('displayName')=='Charlie']")

echo "  Alice:   ${ALICE:0:30}..."
echo "  Bob:     ${BOB:0:30}..."
echo "  Charlie: ${CHARLIE:0:30}..."
echo ""

# 0. Health
echo "--- [1] Health Check ---"
R=$(curl -s "$API/cap/v1/health")
check "API healthy" "$R" '"status":"ok"'

# 1. Agents
echo "--- [2] Agent Discovery ---"
R=$(curl -s "$API/cap/v1/agents")
check "Three agents registered" "$(echo "$R" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['agents']))")" "3"
check "Alice is Research Agent" "$R" "Research Agent"
check "Bob is Translation Agent" "$R" "Translation Agent"
check "Charlie is Image Gen" "$R" "Image Generation"

# 2. Service Discovery
echo "--- [3] Service Discovery ---"
R=$(curl -s "$API/cap/v1/services/discover?capability=translation")
check "Found translation service" "$R" "translation"
check "Bob provides it" "$R" "$BOB"

R=$(curl -s "$API/cap/v1/services/discover?capability=image-generation")
check "Found image-gen service" "$R" "image-generation"

# 3. Wallets
echo "--- [4] Initial Wallets ---"
R=$(curl -s "$API/cap/v1/wallet?as=alice")
check "Alice has 1000 coins" "$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['balance'])")" "1000"
ALICE_COIN=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['coins'][0]['contractId'])")

R=$(curl -s "$API/cap/v1/wallet?as=bob")
check "Bob has 1000 coins" "$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['balance'])")" "1000"

# 4. Create service request
echo "--- [5] Service Request ---"
R=$(curl -s -X POST "$API/cap/v1/services/requests" \
  -H 'Content-Type: application/json' \
  -d "{
    \"consumer\": \"$ALICE\",
    \"provider\": \"$BOB\",
    \"capability\": \"translation\",
    \"params\": {\"text\": \"Hello world\", \"target\": \"ko\"},
    \"maxPrice\": 1.0
  }")
check "Request created" "$R" '"status":"ok"'

# 5. Bob sees request
echo "--- [6] Bob's View ---"
R=$(curl -s "$API/cap/v1/services/requests?as=bob")
check "Bob sees request" "$R" "translation"
REQUEST_CID=$(echo "$R" | python3 -c "import sys,json; r=json.load(sys.stdin)['requests']; print(r[0]['contractId'] if r else '')")

# 6. Bob makes offer
echo "--- [7] Make Offer ---"
R=$(curl -s -X POST "$API/cap/v1/services/requests/$REQUEST_CID/offer" \
  -H 'Content-Type: application/json' \
  -d "{\"provider\": \"$BOB\", \"price\": 0.05, \"estimatedTimeMs\": 3000}")
check "Offer made" "$R" '"status":"ok"'

# 7. Alice sees offer
echo "--- [8] Alice's Offers ---"
R=$(curl -s "$API/cap/v1/services/offers?as=alice")
check "Alice sees offer" "$R" '"offers"'
OFFER_CID=$(echo "$R" | python3 -c "import sys,json; o=json.load(sys.stdin)['offers']; print(o[0]['contractId'] if o else '')")

# 8. Alice accepts → Escrow
echo "--- [9] Accept & Escrow ---"
R=$(curl -s -X POST "$API/cap/v1/services/offers/$OFFER_CID/accept" \
  -H 'Content-Type: application/json' \
  -d "{\"consumer\": \"$ALICE\", \"paymentCid\": \"$ALICE_COIN\"}")
check "Offer accepted → escrow" "$R" '"status":"ok"'

# 9. Escrow exists
echo "--- [10] Escrow State ---"
R=$(curl -s "$API/cap/v1/escrows?as=bob")
check "Escrow exists" "$R" '"escrows"'
ESCROW_CID=$(echo "$R" | python3 -c "import sys,json; e=json.load(sys.stdin)['escrows']; print(e[0]['contractId'] if e else '')")
check "Escrow is locked" "$R" '"locked"'

# 10. Bob delivers
echo "--- [11] Delivery ---"
R=$(curl -s -X POST "$API/cap/v1/escrows/$ESCROW_CID/deliver" \
  -H 'Content-Type: application/json' \
  -d "{\"provider\": \"$BOB\", \"resultHash\": \"sha256:e2e_hash_001\", \"resultUrl\": \"cap://results/e2e\"}")
check "Delivery submitted" "$R" '"status":"ok"'

# 11. Pending review
echo "--- [12] Pending Review ---"
R=$(curl -s "$API/cap/v1/escrows?as=alice")
check "Review pending" "$R" '"pendingReviews"'
REVIEW_CID=$(echo "$R" | python3 -c "import sys,json; r=json.load(sys.stdin)['pendingReviews']; print(r[0]['contractId'] if r else '')")

# 12. Alice approves
echo "--- [13] Approve & Pay ---"
R=$(curl -s -X POST "$API/cap/v1/escrows/$REVIEW_CID/approve" \
  -H 'Content-Type: application/json' \
  -d "{\"consumer\": \"$ALICE\"}")
check "Approved" "$R" '"status":"ok"'

# 13. Verify balances
echo "--- [14] Final Balances ---"
R=$(curl -s "$API/cap/v1/wallet?as=alice")
ALICE_BAL=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['balance'])")
echo "         Alice: $ALICE_BAL CAP coins"
check "Alice balance decreased" "$(python3 -c "print('yes' if $ALICE_BAL < 1000 else 'no')")" "yes"

R=$(curl -s "$API/cap/v1/wallet?as=bob")
BOB_BAL=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['balance'])")
echo "         Bob: $BOB_BAL CAP coins"
check "Bob balance increased" "$(python3 -c "print('yes' if $BOB_BAL > 1000 else 'no')")" "yes"

# 14. Privacy: Charlie sees nothing
echo "--- [15] Privacy Test ---"
R=$(curl -s "$API/cap/v1/escrows?as=charlie")
CHARLIE_COUNT=$(echo "$R" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('escrows',[])) + len(d.get('pendingReviews',[])) + len(d.get('disputes',[])))")
check "Charlie sees 0 escrow activity" "$CHARLIE_COUNT" "0"

R=$(curl -s "$API/cap/v1/services/requests?as=charlie")
CHARLIE_REQS=$(echo "$R" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('requests',[])))")
check "Charlie sees 0 requests" "$CHARLIE_REQS" "0"

# 15. Reputation
echo "--- [16] Reputation ---"
R=$(curl -s "$API/cap/v1/reputation/bob")
check "Reputation endpoint" "$R" '"agentId"'

echo ""
echo "========================================="
echo "  Results: $PASS passed, $FAIL failed"
echo "========================================="
echo ""
