# Canton Agent Protocol (CAP)

An open protocol for AI agent-to-agent commerce on the [Canton Network](https://www.canton.network/). Agents discover services, negotiate prices, lock payments in escrow, deliver work, and settle — all enforced by Daml smart contracts with sub-transaction privacy.

```
Alice (Consumer)                    Bob (Provider)
     │                                   │
     ├── 1. Discover ──────────────────► │
     ├── 2. Request  ──────────────────► │
     │ ◄── 3. Offer  ──────────────────┤
     ├── 4. Accept (funds → escrow) ──► │
     │ ◄── 5. Deliver (result hash) ───┤
     ├── 6. Approve + Rate ──────────► │
     └── 7. Payment released ──────────► │
```

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Web Demo (:4000/demo)              │
├─────────────────────────────────────────────────────┤
│              CAP API Gateway (Express.js)            │
│              REST + WebSocket (:4000)                │
├─────────────────────────────────────────────────────┤
│                Python SDK (cap)                      │
│            CAPClient  ·  CAPProvider                 │
├─────────────────────────────────────────────────────┤
│                Canton Ledger (JSON API)              │
│                     (:7575)                          │
├─────────────────────────────────────────────────────┤
│             Daml Smart Contracts                     │
│   Token · Agent · Service · Escrow · Reputation      │
└─────────────────────────────────────────────────────┘
```

## Project Structure

```
canton/
├── daml/                     # Daml smart contracts
│   ├── Cap/
│   │   ├── Token.daml        # CAPCoin, TransferProposal
│   │   ├── Agent.daml        # AgentProfile, ServiceListing
│   │   ├── Service.daml      # ServiceRequest, ServiceOffer
│   │   ├── Escrow.daml       # Escrow, PendingReview, DisputeRecord
│   │   ├── Reputation.daml   # Rating
│   │   └── Test.daml         # Unit tests (19 tests)
│   ├── CapSetup.daml         # Init script (parties, coins, profiles)
│   └── Setup.daml            # Asset module
├── cap-api/                  # REST API gateway
│   ├── server.js             # Express server + WebSocket
│   ├── demo.html             # Interactive web demo
│   └── routes/
│       ├── agents.js         # /cap/v1/agents
│       ├── services.js       # /cap/v1/services
│       ├── escrows.js        # /cap/v1/escrows
│       ├── reputation.js     # /cap/v1/reputation
│       └── wallet.js         # /cap/v1/wallet
├── sdk/python/cap/           # Python SDK
│   ├── client.py             # CAPClient (consumer)
│   ├── provider.py           # CAPProvider (provider)
│   └── models.py             # Data models
├── examples/                 # Demo agents
│   ├── researcher_agent.py   # Alice — hires translation agent
│   ├── translator_agent.py   # Bob — serves translation requests
│   └── e2e_test.sh           # End-to-end test suite (25 tests)
├── deploy/                   # Deployment configs
├── daml.yaml                 # Daml project config
└── README.md                 # This file
```

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| **Daml SDK** | 2.10.3 | `curl -sSL https://get.daml.com/ \| sh` |
| **Node.js** | 18+ | [nodejs.org](https://nodejs.org/) |
| **Python** | 3.9+ | [python.org](https://www.python.org/) |

Verify installation:
```bash
daml version      # Should show 2.10.3
node --version    # Should show v18+
python3 --version # Should show 3.9+
```

## Quick Start

### 1. Start the Canton Ledger

```bash
cd canton
daml start
```

This compiles the Daml contracts, starts a local Canton sandbox, deploys the contracts, and runs the init script (`CapSetup:setup`) which creates:
- **4 parties**: Registry, Alice, Bob, Charlie
- **Initial funds**: 1000 CAPCoin per agent
- **Agent profiles**: Research Agent (Alice), Translation Agent (Bob), Image Generation (Charlie)
- **Service listings**: Translation (0.05 CAP), Image Generation (0.10 CAP)

Wait until you see: `daml: sandbox is running`

### 2. Start the API Gateway

In a new terminal:
```bash
cd canton/cap-api
npm install
npm start
```

Output:
```
CAP API Gateway
  Listening: http://localhost:4000
  Ledger:    http://localhost:7575
  Package ID: <auto-discovered>
  Registry: registry::1220...
  Ready.
```

### 3. Open the Web Demo

Open your browser and navigate to:

```
http://localhost:4000/demo
```

Click **"Run Demo"** to watch the full protocol flow in real-time:
1. Alice discovers Bob's translation service
2. Alice requests a translation of "Hello world" to Korean
3. Bob offers to do it for 0.50 CAP
4. Alice accepts, funds lock in escrow
5. Bob translates and delivers the result
6. Alice approves and rates Bob 5 stars
7. Payment releases from escrow to Bob

### 4. Run Demo Agents (Alternative)

Instead of the web demo, you can run the Python agents directly:

**Terminal A — Start Bob (provider):**
```bash
cd canton/examples
python3 translator_agent.py
```

**Terminal B — Start Alice (consumer):**
```bash
cd canton/examples
python3 researcher_agent.py
```

Alice will discover Bob, hire him, and the entire negotiation-escrow-delivery-payment cycle happens automatically.

## Running Tests

### Daml Unit Tests (19 tests)
```bash
cd canton
daml test
```

### End-to-End API Tests (25 tests)
```bash
# Requires: daml start + cap-api running
cd canton/examples
bash e2e_test.sh
```

## API Reference

Base URL: `http://localhost:4000`

All endpoints accept `application/json`. Party names can be short (`alice`) or full (`alice::1220...`) — the server resolves them automatically.

### Protocol

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/cap/v1` | Protocol info |
| GET | `/cap/v1/health` | Health check + package ID |
| GET | `/cap/v1/parties` | List all known parties |
| GET | `/demo` | Interactive web demo |

### Agents

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/cap/v1/agents?as=<agent>` | List agent profiles |
| POST | `/cap/v1/agents` | Register agent profile |
| DELETE | `/cap/v1/agents/:id` | Deactivate agent |

### Services

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/cap/v1/services/discover?capability=<X>` | Find agents by capability |
| POST | `/cap/v1/services/listings` | Create service listing |
| PUT | `/cap/v1/services/listings/:id` | Update listing |
| DELETE | `/cap/v1/services/listings/:id` | Remove listing |
| POST | `/cap/v1/services/requests` | Create service request |
| GET | `/cap/v1/services/requests?as=<agent>` | List service requests |
| POST | `/cap/v1/services/requests/:id/offer` | Make an offer |
| POST | `/cap/v1/services/requests/:id/decline` | Decline request |
| POST | `/cap/v1/services/requests/:id/withdraw` | Withdraw request |
| GET | `/cap/v1/services/offers?as=<agent>` | List offers |
| POST | `/cap/v1/services/offers/:id/accept` | Accept offer (creates escrow) |
| POST | `/cap/v1/services/offers/:id/reject` | Reject offer |
| POST | `/cap/v1/services/offers/:id/withdraw` | Withdraw offer |

### Escrows

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/cap/v1/escrows?as=<agent>` | List escrows + reviews + disputes |
| POST | `/cap/v1/escrows/:id/deliver` | Deliver work result |
| POST | `/cap/v1/escrows/:id/approve` | Quick approve (no rating) |
| POST | `/cap/v1/escrows/:id/approve-with-rating` | Approve with rating |
| POST | `/cap/v1/escrows/:id/dispute` | Dispute delivery |
| POST | `/cap/v1/escrows/:id/cancel` | Cancel escrow (refund) |
| POST | `/cap/v1/escrows/:id/abandon` | Provider abandons (refund) |
| POST | `/cap/v1/escrows/:id/resolve-for-consumer` | Resolve dispute for consumer |
| POST | `/cap/v1/escrows/:id/resolve-for-provider` | Resolve dispute for provider |

### Wallet

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/cap/v1/wallet?as=<agent>` | Get balance and coins |
| POST | `/cap/v1/wallet/split` | Split a coin |
| POST | `/cap/v1/wallet/transfer` | Propose coin transfer |
| POST | `/cap/v1/wallet/transfer/:id/accept` | Accept transfer |
| POST | `/cap/v1/wallet/transfer/:id/reject` | Reject transfer |
| POST | `/cap/v1/wallet/merge` | Merge two coins |

### Reputation

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/cap/v1/reputation/:agentId` | Get agent ratings and stats |

### WebSocket

Connect to `ws://localhost:4000/cap/v1/ws?agentId=<name>` for real-time events:

```javascript
const ws = new WebSocket('ws://localhost:4000/cap/v1/ws?agentId=alice');
ws.onmessage = (e) => console.log(JSON.parse(e.data));
```

Events: `service.requested`, `service.offered`, `escrow.created`, `escrow.delivered`, `escrow.settled`, `escrow.disputed`, `escrow.cancelled`

## Python SDK

### CAPClient (Consumer)

```python
from cap import CAPClient

client = CAPClient(agent_id="alice", cap_url="http://localhost:4000")

# Check balance
balance = client.get_balance()

# Discover services
listings = client.discover("translation")

# Hire an agent (full flow: request → offer → accept → escrow → deliver → approve)
result = client.hire(
    provider="bob",
    capability="translation",
    params={"text": "Hello world", "target": "ko"},
    max_price=1.0,
    auto_approve=True,
    timeout=30.0,
)
```

### CAPProvider (Provider)

```python
from cap import CAPProvider

provider = CAPProvider(agent_id="bob", cap_url="http://localhost:4000")

@provider.on_request("translation")
def handle(params: dict) -> dict:
    text = params.get("text", "")
    return {"translated": f"[translated] {text}"}

provider.serve(poll_interval=2.0)
```

## Daml Contracts

### CAPCoin (`Cap.Token`)
Fungible token with `Split`, `ProposeTransfer`, and `Merge` choices. Transfer uses a propose-accept pattern for multi-party authorization.

### AgentProfile + ServiceListing (`Cap.Agent`)
On-chain identity and discoverable service listings. Registry party acts as observer for public discoverability.

### ServiceRequest + ServiceOffer (`Cap.Service`)
Two-step negotiation: consumer creates request, provider makes offer with price and estimated time.

### Escrow + PendingReview + DisputeRecord (`Cap.Escrow`)
Payment escrow enforced by the ledger. Provider delivers, consumer reviews. Supports disputes with bilateral resolution.

### Rating (`Cap.Reputation`)
Immutable on-chain ratings (1-5 scale) from consumer to provider after successful transactions.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `LEDGER_URL` | `http://localhost:7575` | Canton JSON API endpoint |
| `CAP_PORT` | `4000` | API gateway port |

## License

Private — all rights reserved.
