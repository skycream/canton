# Canton Global Synchronizer (DevNet) Deployment

This directory contains scripts and configuration to connect a **Splice Validator Node**
to the Canton Network DevNet Global Synchronizer.

## Architecture

```
Canton DevNet (Super Validators)
┌──────────────────────────────────┐
│ Shared Sequencers + Mediators    │
│ (managed by SV operators)        │
└──────────────┬───────────────────┘
               │
┌──────────────┼───────────────────┐
│  Your Validator Node             │
│  ├─ Participant (built-in)       │
│  ├─ PostgreSQL                   │
│  ├─ Wallet UI (built-in)         │
│  └─ nginx (API proxy, port 5011)│
│                                  │
│  + Prometheus (port 9090)        │
│  + Grafana (port 3001)           │
│  + Asset Transfer UI (port 3000) │
└──────────────────────────────────┘
```

**Key difference from private network**: You do NOT run your own Sequencer, Mediator,
or Domain Manager. These are operated by Super Validators on the Global Synchronizer.

## Prerequisites

- Docker & Docker Compose
- `curl` or `wget`
- VPN access or IP whitelisting (contact your SV sponsor)
- Daml SDK (for building DAR files)

## DevNet Info

| Parameter       | Value                                            |
|-----------------|--------------------------------------------------|
| Splice version  | 0.5.10                                           |
| Migration ID    | 1                                                |
| SV Sponsor URL  | `https://sv.sv-1.dev.global.canton.network.digitalasset.com` |

## Quick Start

### 1. Configure environment

```bash
cp .env.example .env
# Edit .env with your values:
#   - VALIDATOR_PARTY_HINT (your unique org name)
#   - POSTGRES_PASSWORD (change from default)
```

### 2. Download Splice bundle & start Validator

```bash
./setup-validator.sh
```

This script will:
1. Download the Splice v0.5.10 bundle
2. Request an onboarding secret from the SV sponsor (valid ~1 hour)
3. Start the Validator Node via Docker Compose
4. Wait for the Ledger API to become ready

### 3. Upload DAR & create parties

```bash
# Build the DAR first (if not already built)
cd .. && daml build && cd deploy

./upload-dar.sh
```

This script will:
1. Upload `asset-transfer-0.1.0.dar` to the Ledger API
2. Allocate Alice and Bob parties
3. Create corresponding users with read/write rights

### 4. Start monitoring (optional)

```bash
docker compose up -d
```

This starts Prometheus and Grafana alongside the Splice Validator:
- **Prometheus**: http://localhost:9090
- **Grafana**: http://localhost:3001 (admin/admin)

### 5. Start the Asset Transfer UI

```bash
cd ../ui
npm install
npm start
```

The UI connects to the Ledger API at `http://localhost:5011` (Splice nginx proxy).

## File Structure

```
deploy/
├── .env.example          # Environment variable template
├── .env                  # Your local config (git-ignored)
├── setup-validator.sh    # Splice bundle download + onboarding
├── upload-dar.sh         # DAR upload + party/user creation
├── docker-compose.yml    # Prometheus + Grafana overlay
├── prometheus.yml        # Validator metrics scraping
├── README.md             # This file
└── splice-node/          # Splice bundle (git-ignored, created by setup-validator.sh)
```

## Troubleshooting

### Onboarding secret fails
- Verify VPN is active or your IP is whitelisted
- Check that `SV_SPONSOR_URL` is correct in `.env`
- DevNet may be down — check with your SV sponsor

### Ledger API not reachable
- Check Validator logs: `docker compose -f splice-node/docker-compose.yml logs`
- Ensure port 5011 is not in use by another service

### DAR upload fails
- Ensure the DAR was built: `cd .. && daml build`
- Verify `DAR_PATH` in `.env` points to the correct file

### Canton Coin (CC)
DevNet automatically provides Canton Coin via tap. No manual funding needed.
