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
ARBITER=$(echo "$PARTIES" | python3 -c "import sys,json; [print(p['identifier']) for p in json.load(sys.stdin)['result'] if p.get('displayName')=='Arbiter']")
TREASURY=$(echo "$PARTIES" | python3 -c "import sys,json; [print(p['identifier']) for p in json.load(sys.stdin)['result'] if p.get('displayName')=='Treasury']")

echo "  Alice:    ${ALICE:0:30}..."
echo "  Bob:      ${BOB:0:30}..."
echo "  Charlie:  ${CHARLIE:0:30}..."
echo "  Arbiter:  ${ARBITER:0:30}..."
echo "  Treasury: ${TREASURY:0:30}..."
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

# 15. Reputation (bidirectional)
echo "--- [16] Reputation ---"
R=$(curl -s "$API/cap/v1/reputation/bob")
check "Reputation endpoint" "$R" '"agentId"'
check "Has asProvider field" "$R" '"asProvider"'
check "Has asConsumer field" "$R" '"asConsumer"'

# =============================================
# Phase 3: Rating Invitations
# =============================================
echo "--- [17] Rating Invitations ---"
R=$(curl -s "$API/cap/v1/reputation/bob/invitations")
check "Bob has rating invitations" "$R" '"invitations"'
# Bob should have an invitation to rate Alice from the QuickApprove above
INV_COUNT=$(echo "$R" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('invitations',[])))")
check "Bob has ≥1 invitation" "$(python3 -c "print('yes' if $INV_COUNT >= 1 else 'no')")" "yes"
INV_CID=$(echo "$R" | python3 -c "import sys,json; invs=json.load(sys.stdin).get('invitations',[]); print(invs[0]['contractId'] if invs else '')")

# Bob rates Alice
echo "--- [18] Bob Rates Alice ---"
if [ -n "$INV_CID" ]; then
  R=$(curl -s -X POST "$API/cap/v1/reputation/bob/rate/$INV_CID" \
    -H 'Content-Type: application/json' \
    -d '{"score": 4, "comment": "Good consumer, clear requirements"}')
  check "Bob submitted rating" "$R" '"status":"ok"'
else
  echo "  [SKIP] No invitation found"
fi

# Check reputation now shows bidirectional data
R=$(curl -s "$API/cap/v1/reputation/$ALICE")
check "Alice has reputation entry" "$R" '"agentId"'

# =============================================
# Phase 4: Protocol Fees
# =============================================
echo "--- [19] Fee Flow: Request with feeConfig ---"
# Get Alice's updated coin for the fee test
R=$(curl -s "$API/cap/v1/wallet?as=alice")
ALICE_COIN2=$(echo "$R" | python3 -c "import sys,json; coins=json.load(sys.stdin)['coins']; print(coins[0]['contractId'] if coins else '')")

R=$(curl -s -X POST "$API/cap/v1/services/requests" \
  -H 'Content-Type: application/json' \
  -d "{
    \"consumer\": \"$ALICE\",
    \"provider\": \"$BOB\",
    \"capability\": \"translation\",
    \"params\": {\"text\": \"Fee test\", \"target\": \"ja\"},
    \"maxPrice\": 10.0,
    \"feeConfig\": {\"feeRate\": \"0.02\", \"treasury\": \"$TREASURY\"}
  }")
check "Fee request created" "$R" '"status":"ok"'

# Bob offers
R=$(curl -s "$API/cap/v1/services/requests?as=bob")
FEE_REQ_CID=$(echo "$R" | python3 -c "import sys,json; r=json.load(sys.stdin)['requests']; print(r[0]['contractId'] if r else '')")

echo "--- [20] Fee Flow: Offer + Accept ---"
R=$(curl -s -X POST "$API/cap/v1/services/requests/$FEE_REQ_CID/offer" \
  -H 'Content-Type: application/json' \
  -d "{\"provider\": \"$BOB\", \"price\": 5.0, \"estimatedTimeMs\": 5000}")
check "Fee offer made" "$R" '"status":"ok"'

R=$(curl -s "$API/cap/v1/services/offers?as=alice")
FEE_OFFER_CID=$(echo "$R" | python3 -c "import sys,json; o=json.load(sys.stdin)['offers']; print(o[0]['contractId'] if o else '')")

R=$(curl -s -X POST "$API/cap/v1/services/offers/$FEE_OFFER_CID/accept" \
  -H 'Content-Type: application/json' \
  -d "{\"consumer\": \"$ALICE\", \"paymentCid\": \"$ALICE_COIN2\"}")
check "Fee escrow created" "$R" '"status":"ok"'

# Deliver + Approve with rating
echo "--- [21] Fee Flow: Deliver + Approve ---"
R=$(curl -s "$API/cap/v1/escrows?as=bob")
FEE_ESCROW_CID=$(echo "$R" | python3 -c "import sys,json; e=json.load(sys.stdin)['escrows']; print(e[0]['contractId'] if e else '')")

R=$(curl -s -X POST "$API/cap/v1/escrows/$FEE_ESCROW_CID/deliver" \
  -H 'Content-Type: application/json' \
  -d "{\"provider\": \"$BOB\", \"resultHash\": \"sha256:fee_test_hash\", \"resultUrl\": \"cap://results/fee-test\"}")
check "Fee delivery submitted" "$R" '"status":"ok"'

R=$(curl -s "$API/cap/v1/escrows?as=alice")
FEE_REVIEW_CID=$(echo "$R" | python3 -c "import sys,json; r=json.load(sys.stdin)['pendingReviews']; print(r[0]['contractId'] if r else '')")

R=$(curl -s -X POST "$API/cap/v1/escrows/$FEE_REVIEW_CID/approve-with-rating" \
  -H 'Content-Type: application/json' \
  -d "{\"consumer\": \"$ALICE\", \"consumerRating\": 5, \"consumerComment\": \"Excellent translation with fees\"}")
check "Fee approval with rating" "$R" '"status":"ok"'

# Check fee stats
echo "--- [22] Fee Stats ---"
R=$(curl -s "$API/cap/v1/fees/stats?as=treasury")
check "Fee stats endpoint" "$R" '"pendingCount"'
PENDING=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin).get('pendingCount', 0))")
check "Has pending fees" "$(python3 -c "print('yes' if $PENDING >= 1 else 'no')")" "yes"

# List pending fees
R=$(curl -s "$API/cap/v1/fees/pending?as=treasury")
check "Pending fees listed" "$R" '"pending"'
TOTAL_PENDING=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin).get('totalPending', 0))")
check "Fee amount > 0" "$(python3 -c "print('yes' if $TOTAL_PENDING > 0 else 'no')")" "yes"

# Collect fees
echo "--- [23] Fee Collection ---"
R=$(curl -s -X POST "$API/cap/v1/fees/collect" \
  -H 'Content-Type: application/json' \
  -d "{\"treasury\": \"$TREASURY\"}")
check "Fees collected" "$R" '"status":"ok"'

R=$(curl -s "$API/cap/v1/fees/stats?as=treasury")
COLLECTED=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin).get('totalCollected', 0))")
check "Treasury has collected coins" "$(python3 -c "print('yes' if $COLLECTED > 0 else 'no')")" "yes"

# =============================================
# Phase 2: Dispute + Arbiter Resolution
# =============================================
echo "--- [24] Dispute Flow: Setup ---"
# Create a new service request for dispute testing
R=$(curl -s "$API/cap/v1/wallet?as=alice")
ALICE_COIN3=$(echo "$R" | python3 -c "import sys,json; coins=json.load(sys.stdin)['coins']; print(coins[0]['contractId'] if coins else '')")

R=$(curl -s -X POST "$API/cap/v1/services/requests" \
  -H 'Content-Type: application/json' \
  -d "{
    \"consumer\": \"$ALICE\",
    \"provider\": \"$BOB\",
    \"capability\": \"translation\",
    \"params\": {\"text\": \"Dispute test\", \"target\": \"zh\"},
    \"maxPrice\": 10.0
  }")
check "Dispute request created" "$R" '"status":"ok"'

R=$(curl -s "$API/cap/v1/services/requests?as=bob")
DISP_REQ_CID=$(echo "$R" | python3 -c "import sys,json; r=json.load(sys.stdin)['requests']; print(r[0]['contractId'] if r else '')")

R=$(curl -s -X POST "$API/cap/v1/services/requests/$DISP_REQ_CID/offer" \
  -H 'Content-Type: application/json' \
  -d "{\"provider\": \"$BOB\", \"price\": 2.0, \"estimatedTimeMs\": 5000}")
check "Dispute offer made" "$R" '"status":"ok"'

R=$(curl -s "$API/cap/v1/services/offers?as=alice")
DISP_OFFER_CID=$(echo "$R" | python3 -c "import sys,json; o=json.load(sys.stdin)['offers']; print(o[0]['contractId'] if o else '')")

R=$(curl -s -X POST "$API/cap/v1/services/offers/$DISP_OFFER_CID/accept" \
  -H 'Content-Type: application/json' \
  -d "{\"consumer\": \"$ALICE\", \"paymentCid\": \"$ALICE_COIN3\"}")
check "Dispute escrow created" "$R" '"status":"ok"'

echo "--- [25] Dispute Flow: Deliver + Dispute ---"
R=$(curl -s "$API/cap/v1/escrows?as=bob")
DISP_ESCROW_CID=$(echo "$R" | python3 -c "import sys,json; e=json.load(sys.stdin)['escrows']; print(e[0]['contractId'] if e else '')")

R=$(curl -s -X POST "$API/cap/v1/escrows/$DISP_ESCROW_CID/deliver" \
  -H 'Content-Type: application/json' \
  -d "{\"provider\": \"$BOB\", \"resultHash\": \"sha256:dispute_hash\", \"resultUrl\": \"cap://results/dispute\"}")
check "Dispute delivery submitted" "$R" '"status":"ok"'

R=$(curl -s "$API/cap/v1/escrows?as=alice")
DISP_REVIEW_CID=$(echo "$R" | python3 -c "import sys,json; r=json.load(sys.stdin)['pendingReviews']; print(r[0]['contractId'] if r else '')")

R=$(curl -s -X POST "$API/cap/v1/escrows/$DISP_REVIEW_CID/dispute" \
  -H 'Content-Type: application/json' \
  -d "{\"consumer\": \"$ALICE\", \"reason\": \"Translation quality below acceptable standard\"}")
check "Dispute raised" "$R" '"status":"ok"'

# Verify dispute exists
R=$(curl -s "$API/cap/v1/escrows?as=alice")
DISPUTE_CID=$(echo "$R" | python3 -c "import sys,json; d=json.load(sys.stdin)['disputes']; print(d[0]['contractId'] if d else '')")
check "Dispute record exists" "$R" '"disputed"'

echo "--- [26] Arbiter: Escalate + Rule ---"
R=$(curl -s -X POST "$API/cap/v1/escrows/$DISPUTE_CID/escalate" \
  -H 'Content-Type: application/json' \
  -d "{\"consumer\": \"$ALICE\", \"arbiter\": \"$ARBITER\"}")
check "Dispute escalated to arbiter" "$R" '"status":"ok"'

# Verify arbitrated dispute
R=$(curl -s "$API/cap/v1/escrows?as=arbiter")
check "Arbiter sees arbitrated dispute" "$R" '"arbitratedDisputes"'
ARB_DISP_CID=$(echo "$R" | python3 -c "import sys,json; d=json.load(sys.stdin)['arbitratedDisputes']; print(d[0]['contractId'] if d else '')")

# Submit evidence
R=$(curl -s -X POST "$API/cap/v1/escrows/$ARB_DISP_CID/submit-evidence" \
  -H 'Content-Type: application/json' \
  -d "{\"submitter\": \"$ALICE\", \"newEvidence\": \"Screenshot of poor translation quality\"}")
check "Evidence submitted" "$R" '"status":"ok"'

# Arbiter rules for consumer (refund)
R=$(curl -s -X POST "$API/cap/v1/escrows/$ARB_DISP_CID/rule-for-consumer" \
  -H 'Content-Type: application/json' \
  -d "{\"arbiter\": \"$ARBITER\"}")
check "Arbiter ruled for consumer" "$R" '"status":"ok"'

# Verify consumer got refunded
R=$(curl -s "$API/cap/v1/wallet?as=alice")
ALICE_FINAL=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['balance'])")
echo "         Alice final: $ALICE_FINAL CAP coins"
check "Alice has coins after refund" "$(python3 -c "print('yes' if $ALICE_FINAL > 0 else 'no')")" "yes"

echo ""
echo "========================================="
echo "  Results: $PASS passed, $FAIL failed"
echo "========================================="
echo ""
