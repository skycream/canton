const http = require("http");
const { WebSocketServer } = require("ws");
const crypto = require("crypto");

// --- Config ---
const LEDGER_URL = process.env.LEDGER_URL || "http://localhost:7575";
const PORT = process.env.MONITOR_PORT || 3002;
const POLL_INTERVAL = process.env.POLL_INTERVAL ? parseInt(process.env.POLL_INTERVAL) : 2000;
const ADMIN_USER = process.env.ADMIN_USER || "alice";
const JWT_SECRET = process.env.JWT_SECRET || "cap-dev-secret-change-in-production";

// --- CAP Contract Template Definitions ---
const CAP_TEMPLATES = {
  escrow:           "Cap.Escrow:Escrow",
  pendingReview:    "Cap.Escrow:PendingReview",
  disputeRecord:    "Cap.Escrow:DisputeRecord",
  arbitratedDispute:"Cap.Arbiter:ArbitratedDispute",
  appealedDispute:  "Cap.Arbiter:AppealedDispute",
  capCoin:          "Cap.Token:CAPCoin",
  lockedCAPCoin:    "Cap.Token:LockedCAPCoin",
  feeTransfer:      "Cap.Token:FeeTransfer",
  agentProfile:     "Cap.Agent:AgentProfile",
  serviceListing:   "Cap.Agent:ServiceListing",
  rating:           "Cap.Reputation:Rating",
  reputationScore:  "Cap.Reputation:ReputationScore",
};

// Friendly labels for display
const TEMPLATE_LABELS = {
  escrow:            "Active Escrows",
  pendingReview:     "Pending Reviews",
  disputeRecord:     "Active Disputes",
  arbitratedDispute: "Arbitrated Disputes",
  appealedDispute:   "Appeals",
  capCoin:           "CAPCoin Supply",
  lockedCAPCoin:     "Locked Funds",
  feeTransfer:       "Pending Fees",
  agentProfile:      "Agent Profiles",
  serviceListing:    "Service Listings",
  rating:            "Ratings",
  reputationScore:   "Reputation Scores",
};

// --- State ---
let packageId = null;

const state = {
  ledgerStatus: "connecting",
  parties: [],
  contracts: {},      // keyed by template key, each is an array of contracts
  contractHistory: {},// keyed by template key, tracks previous contract IDs for diff
  transactions: [],   // recent create/archive events
  metrics: {
    totalActiveEscrows: 0,
    totalValueLocked: 0,
    disputeRate: 0,
    averageSettlementTime: 0,
    totalAgentsRegistered: 0,
    totalFeesCollected: 0,
    totalFeesPending: 0,
    ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    totalRatings: 0,
    averageRating: 0,
    totalServiceListings: 0,
    totalCAPCoinSupply: 0,
    totalLockedFunds: 0,
    pendingReviews: 0,
    activeDisputes: 0,
    arbitratedDisputes: 0,
    appeals: 0,
    reputationScores: 0,
  },
  stats: {
    totalCreated: 0,
    totalArchived: 0,
    pollCount: 0,
    startTime: Date.now(),
    lastPollTime: null,
    lastPollDurationMs: 0,
    errors: [],
  },
};

// Initialize contract buckets
for (const key of Object.keys(CAP_TEMPLATES)) {
  state.contracts[key] = [];
  state.contractHistory[key] = new Set();
}

// --- JWT helper (HS256 signed, same pattern as cap-api) ---
function createToken(userId) {
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    sub: userId,
    scope: "daml_ledger_api",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  const encode = (obj) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  const unsigned = `${encode(header)}.${encode(payload)}`;
  const signature = crypto
    .createHmac("sha256", JWT_SECRET)
    .update(unsigned)
    .digest("base64url");
  return `${unsigned}.${signature}`;
}

// --- Ledger API helpers ---
async function ledgerFetch(endpoint, opts = {}) {
  const url = `${LEDGER_URL}${endpoint}`;
  const headers = {
    Authorization: `Bearer ${createToken(ADMIN_USER)}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    ...opts.headers,
  };
  const resp = await fetch(url, { ...opts, headers });
  return resp.json();
}

async function ledgerQuery(userId, templateIds) {
  const url = `${LEDGER_URL}/v1/query`;
  const headers = {
    Authorization: `Bearer ${createToken(userId)}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const body = JSON.stringify({ templateIds });
  const resp = await fetch(url, { method: "POST", headers, body });
  return resp.json();
}

async function discoverPackageId() {
  if (packageId) return packageId;
  try {
    const data = await ledgerFetch("/v1/packages");
    if (!data.result) return null;

    for (const pkg of data.result) {
      try {
        // Probe for a CAP-specific template
        const q = await ledgerQuery(ADMIN_USER, [`${pkg}:Cap.Token:CAPCoin`]);
        if (q.status === 200) {
          packageId = pkg;
          console.log(`  Package ID discovered: ${pkg.slice(0, 16)}...`);
          return pkg;
        }
      } catch {}
    }
  } catch {}
  return null;
}

// --- Party fetching ---
async function fetchParties() {
  try {
    const data = await ledgerFetch("/v1/parties");
    if (data.result) {
      state.parties = data.result
        .filter((p) => p.displayName)
        .map((p) => ({
          id: p.identifier,
          displayName: p.displayName,
          isLocal: p.isLocal,
          shortId: p.identifier.split("::")[0],
        }));
    }
  } catch (e) {
    pushError("fetchParties", e.message);
  }
}

// --- Contract fetching for all CAP templates ---
async function fetchAllContracts() {
  const pkg = await discoverPackageId();
  if (!pkg) {
    state.ledgerStatus = "discovering packages...";
    return;
  }

  const pollStart = Date.now();

  // Collect users to query as (we need visibility across parties)
  const userIds = state.parties.length > 0
    ? [...new Set(state.parties.map((p) => p.shortId))]
    : [ADMIN_USER];

  for (const [key, templateSuffix] of Object.entries(CAP_TEMPLATES)) {
    try {
      const fullTemplateId = `${pkg}:${templateSuffix}`;
      const allContracts = new Map();

      for (const userId of userIds) {
        try {
          const data = await ledgerQuery(userId, [fullTemplateId]);
          if (data.result) {
            for (const c of data.result) {
              allContracts.set(c.contractId, {
                contractId: c.contractId,
                shortId: c.contractId.slice(0, 16) + "...",
                templateKey: key,
                templateId: templateSuffix,
                payload: c.payload,
                signatories: (c.signatories || []).map((s) => s.split("::")[0]),
                observers: (c.observers || []).map((s) => s.split("::")[0]),
              });
            }
          }
        } catch {}
      }

      const newContracts = Array.from(allContracts.values());
      const newIds = new Set(newContracts.map((c) => c.contractId));
      const oldIds = state.contractHistory[key];

      // Detect creates and archives
      const now = new Date().toISOString();
      for (const c of newContracts) {
        if (!oldIds.has(c.contractId)) {
          state.stats.totalCreated++;
          state.transactions.push({
            time: now,
            type: "create",
            templateKey: key,
            template: templateSuffix,
            contractId: c.shortId,
            detail: formatContractSummary(key, c.payload),
          });
        }
      }
      for (const oldId of oldIds) {
        if (!newIds.has(oldId)) {
          state.stats.totalArchived++;
          state.transactions.push({
            time: now,
            type: "archive",
            templateKey: key,
            template: templateSuffix,
            contractId: oldId.slice(0, 16) + "...",
            detail: "",
          });
        }
      }

      state.contracts[key] = newContracts;
      state.contractHistory[key] = newIds;
    } catch (e) {
      pushError(`fetch:${key}`, e.message);
    }
  }

  // Trim transaction log to last 200 entries
  if (state.transactions.length > 200) {
    state.transactions = state.transactions.slice(-200);
  }

  state.stats.pollCount++;
  state.stats.lastPollTime = new Date().toISOString();
  state.stats.lastPollDurationMs = Date.now() - pollStart;
  state.ledgerStatus = "connected";
}

// --- Metrics calculation ---
function calculateMetrics() {
  const m = state.metrics;

  // Escrow metrics
  const escrows = state.contracts.escrow || [];
  m.totalActiveEscrows = escrows.length;
  m.totalValueLocked = escrows.reduce((sum, c) => {
    const amount = parseFloat(c.payload?.amount) || parseFloat(c.payload?.value) || 0;
    return sum + amount;
  }, 0);

  // Add locked coins to total value locked
  const lockedCoins = state.contracts.lockedCAPCoin || [];
  m.totalLockedFunds = lockedCoins.reduce((sum, c) => {
    const amount = parseFloat(c.payload?.amount) || parseFloat(c.payload?.value) || 0;
    return sum + amount;
  }, 0);
  m.totalValueLocked += m.totalLockedFunds;

  // Dispute rate
  const disputes = state.contracts.disputeRecord || [];
  m.activeDisputes = disputes.length;
  const totalEscrowsEver = m.totalActiveEscrows + state.stats.totalArchived;
  m.disputeRate = totalEscrowsEver > 0
    ? parseFloat((m.activeDisputes / totalEscrowsEver).toFixed(4))
    : 0;

  // Average settlement time: computed from archived escrows that have timestamps
  // Use the transactions log to approximate settlement time
  const escrowCreates = state.transactions.filter(
    (t) => t.templateKey === "escrow" && t.type === "create"
  );
  const escrowArchives = state.transactions.filter(
    (t) => t.templateKey === "escrow" && t.type === "archive"
  );
  if (escrowArchives.length > 0 && escrowCreates.length > 0) {
    // Average time between earliest create and each archive
    const archiveTimes = escrowArchives.map((t) => new Date(t.time).getTime());
    const createTimes = escrowCreates.map((t) => new Date(t.time).getTime());
    const avgCreate = createTimes.reduce((a, b) => a + b, 0) / createTimes.length;
    const avgArchive = archiveTimes.reduce((a, b) => a + b, 0) / archiveTimes.length;
    const diffMs = avgArchive - avgCreate;
    m.averageSettlementTime = diffMs > 0 ? Math.round(diffMs / 1000) : 0; // seconds
  } else {
    m.averageSettlementTime = 0;
  }

  // Agents
  const agents = state.contracts.agentProfile || [];
  m.totalAgentsRegistered = agents.length;

  // Services
  const services = state.contracts.serviceListing || [];
  m.totalServiceListings = services.length;

  // Fee metrics
  const feeTransfers = state.contracts.feeTransfer || [];
  m.totalFeesPending = feeTransfers.reduce((sum, c) => {
    const amount = parseFloat(c.payload?.amount) || parseFloat(c.payload?.fee) || 0;
    return sum + amount;
  }, 0);
  // Collected fees = archived fee transfers (estimated from stats)
  m.totalFeesCollected = 0; // Updated via transaction tracking
  const archivedFees = state.transactions.filter(
    (t) => t.templateKey === "feeTransfer" && t.type === "archive"
  );
  m.totalFeesCollected = archivedFees.length; // count of collected fees

  // CAPCoin supply
  const capCoins = state.contracts.capCoin || [];
  m.totalCAPCoinSupply = capCoins.reduce((sum, c) => {
    const amount = parseFloat(c.payload?.amount) || parseFloat(c.payload?.value) || 0;
    return sum + amount;
  }, 0);

  // Rating distribution
  const ratings = state.contracts.rating || [];
  m.totalRatings = ratings.length;
  m.ratingDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let ratingSum = 0;
  for (const r of ratings) {
    const score = parseInt(r.payload?.score) || parseInt(r.payload?.rating) || 0;
    if (score >= 1 && score <= 5) {
      m.ratingDistribution[score]++;
      ratingSum += score;
    }
  }
  m.averageRating = m.totalRatings > 0
    ? parseFloat((ratingSum / m.totalRatings).toFixed(2))
    : 0;

  // Pending reviews
  m.pendingReviews = (state.contracts.pendingReview || []).length;

  // Arbitrated / appeals
  m.arbitratedDisputes = (state.contracts.arbitratedDispute || []).length;
  m.appeals = (state.contracts.appealedDispute || []).length;

  // Reputation scores
  m.reputationScores = (state.contracts.reputationScore || []).length;
}

// --- Format helpers ---
function formatContractSummary(key, payload) {
  if (!payload) return "";
  switch (key) {
    case "escrow": {
      const consumer = shortParty(payload.consumer);
      const provider = shortParty(payload.provider);
      const amount = payload.amount || payload.value || "?";
      return `${consumer} -> ${provider} | ${amount} CAP`;
    }
    case "pendingReview": {
      const consumer = shortParty(payload.consumer);
      const provider = shortParty(payload.provider);
      return `Review: ${consumer} -> ${provider}`;
    }
    case "disputeRecord": {
      const initiator = shortParty(payload.initiator || payload.consumer);
      const reason = (payload.reason || "").slice(0, 40);
      return `Dispute by ${initiator}: ${reason}`;
    }
    case "arbitratedDispute": {
      const arbiter = shortParty(payload.arbiter);
      const outcome = payload.outcome || payload.decision || "pending";
      return `Arbiter: ${arbiter} | ${outcome}`;
    }
    case "appealedDispute": {
      const appellant = shortParty(payload.appellant || payload.initiator);
      return `Appeal by ${appellant}`;
    }
    case "capCoin": {
      const owner = shortParty(payload.owner);
      const amount = payload.amount || payload.value || "?";
      return `${owner}: ${amount} CAP`;
    }
    case "lockedCAPCoin": {
      const owner = shortParty(payload.owner);
      const amount = payload.amount || payload.value || "?";
      return `Locked ${amount} CAP (${owner})`;
    }
    case "feeTransfer": {
      const from = shortParty(payload.from || payload.payer);
      const to = shortParty(payload.to || payload.treasury);
      const amount = payload.amount || payload.fee || "?";
      return `Fee ${amount} CAP: ${from} -> ${to}`;
    }
    case "agentProfile": {
      const name = payload.name || payload.displayName || shortParty(payload.owner);
      return `Agent: ${name}`;
    }
    case "serviceListing": {
      const name = payload.name || payload.title || "unnamed";
      const provider = shortParty(payload.provider || payload.owner);
      return `${name} by ${provider}`;
    }
    case "rating": {
      const reviewer = shortParty(payload.reviewer || payload.consumer);
      const score = payload.score || payload.rating || "?";
      return `${reviewer} rated ${score}/5`;
    }
    case "reputationScore": {
      const agent = shortParty(payload.agent || payload.owner);
      const score = payload.score || payload.overallScore || "?";
      return `${agent}: score ${score}`;
    }
    default:
      return JSON.stringify(payload).slice(0, 80);
  }
}

function shortParty(partyId) {
  if (!partyId) return "?";
  return partyId.split("::")[0];
}

function pushError(context, message) {
  state.stats.errors.push({
    time: new Date().toISOString(),
    context,
    message,
  });
  // Keep last 50 errors
  if (state.stats.errors.length > 50) {
    state.stats.errors = state.stats.errors.slice(-50);
  }
}

// --- Prometheus-format metrics ---
function renderPrometheusMetrics() {
  const m = state.metrics;
  const lines = [];

  function metric(name, help, type, value) {
    lines.push(`# HELP ${name} ${help}`);
    lines.push(`# TYPE ${name} ${type}`);
    lines.push(`${name} ${value}`);
  }

  metric("cap_active_escrows", "Number of active escrow contracts", "gauge", m.totalActiveEscrows);
  metric("cap_total_value_locked", "Total value locked in escrows and locked coins (CAP)", "gauge", m.totalValueLocked);
  metric("cap_locked_funds", "Total funds in LockedCAPCoin contracts", "gauge", m.totalLockedFunds);
  metric("cap_dispute_rate", "Ratio of disputes to total escrows", "gauge", m.disputeRate);
  metric("cap_active_disputes", "Number of active dispute records", "gauge", m.activeDisputes);
  metric("cap_arbitrated_disputes", "Number of arbitrated disputes", "gauge", m.arbitratedDisputes);
  metric("cap_appeals", "Number of appealed disputes", "gauge", m.appeals);
  metric("cap_average_settlement_seconds", "Average escrow settlement time in seconds", "gauge", m.averageSettlementTime);
  metric("cap_agents_registered", "Total registered agent profiles", "gauge", m.totalAgentsRegistered);
  metric("cap_service_listings", "Total active service listings", "gauge", m.totalServiceListings);
  metric("cap_fees_pending", "Total pending fee value (CAP)", "gauge", m.totalFeesPending);
  metric("cap_fees_collected_count", "Count of collected (archived) fee transfers", "counter", m.totalFeesCollected);
  metric("cap_capcoin_supply", "Total CAPCoin supply visible on ledger", "gauge", m.totalCAPCoinSupply);
  metric("cap_pending_reviews", "Number of pending review contracts", "gauge", m.pendingReviews);
  metric("cap_total_ratings", "Total number of rating contracts", "gauge", m.totalRatings);
  metric("cap_average_rating", "Average rating score (1-5)", "gauge", m.averageRating);
  metric("cap_reputation_scores", "Number of on-chain reputation score contracts", "gauge", m.reputationScores);

  // Rating distribution as labeled metrics
  lines.push("# HELP cap_rating_distribution Count of ratings per score bucket");
  lines.push("# TYPE cap_rating_distribution gauge");
  for (let i = 1; i <= 5; i++) {
    lines.push(`cap_rating_distribution{score="${i}"} ${m.ratingDistribution[i]}`);
  }

  // Contract counts by template
  lines.push("# HELP cap_contracts_by_template Active contract count per template");
  lines.push("# TYPE cap_contracts_by_template gauge");
  for (const [key, contracts] of Object.entries(state.contracts)) {
    lines.push(`cap_contracts_by_template{template="${CAP_TEMPLATES[key]}"} ${contracts.length}`);
  }

  // Operational metrics
  metric("cap_monitor_poll_count", "Total number of poll cycles completed", "counter", state.stats.pollCount);
  metric("cap_monitor_poll_duration_ms", "Duration of last poll cycle in ms", "gauge", state.stats.lastPollDurationMs);
  metric("cap_monitor_total_created", "Total contracts created since monitor start", "counter", state.stats.totalCreated);
  metric("cap_monitor_total_archived", "Total contracts archived since monitor start", "counter", state.stats.totalArchived);
  metric("cap_monitor_uptime_seconds", "Monitor uptime in seconds", "gauge", Math.floor((Date.now() - state.stats.startTime) / 1000));
  metric("cap_monitor_parties", "Number of known parties on the ledger", "gauge", state.parties.length);

  return lines.join("\n") + "\n";
}

// --- JSON dashboard data ---
function buildDashboardData() {
  const m = state.metrics;
  const contractSummary = {};
  for (const [key, contracts] of Object.entries(state.contracts)) {
    contractSummary[key] = {
      label: TEMPLATE_LABELS[key],
      templateId: CAP_TEMPLATES[key],
      count: contracts.length,
      contracts: contracts.map((c) => ({
        contractId: c.shortId,
        signatories: c.signatories,
        observers: c.observers,
        summary: formatContractSummary(key, c.payload),
        payload: c.payload,
      })),
    };
  }

  return {
    status: state.ledgerStatus,
    timestamp: new Date().toISOString(),
    uptime: Math.floor((Date.now() - state.stats.startTime) / 1000),
    parties: state.parties,
    metrics: m,
    contracts: contractSummary,
    recentTransactions: state.transactions.slice(-50).reverse(),
    operational: {
      pollCount: state.stats.pollCount,
      lastPollTime: state.stats.lastPollTime,
      lastPollDurationMs: state.stats.lastPollDurationMs,
      totalCreated: state.stats.totalCreated,
      totalArchived: state.stats.totalArchived,
      recentErrors: state.stats.errors.slice(-10),
    },
  };
}

// --- WebSocket broadcast ---
const wsClients = new Set();

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const ws of wsClients) {
    if (ws.readyState === 1) {
      try {
        ws.send(msg);
      } catch {}
    }
  }
}

// --- Dashboard HTML ---
function serveDashboardHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CAP Protocol Monitor</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace; background: #0a0e17; color: #c9d1d9; }

  .header {
    background: linear-gradient(135deg, #161b22, #0d1117);
    border-bottom: 1px solid #30363d; padding: 16px 24px;
    display: flex; align-items: center; gap: 16px;
  }
  .header h1 { font-size: 18px; color: #58a6ff; }
  .header .subtitle { font-size: 12px; color: #8b949e; }
  .status { padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600; }
  .status.connected { background: #0d1f0d; color: #3fb950; border: 1px solid #238636; }
  .status.connecting { background: #1c1c00; color: #d29922; border: 1px solid #d29922; }
  .status.error { background: #1f0d0d; color: #f85149; border: 1px solid #da3633; }
  .uptime { font-size: 12px; color: #484f58; margin-left: auto; }

  .grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; padding: 16px 24px; }
  .full-width { grid-column: 1 / -1; }
  .two-col { grid-column: span 2; }

  .card {
    background: #161b22; border: 1px solid #30363d; border-radius: 8px; overflow: hidden;
  }
  .card-header {
    padding: 10px 16px; border-bottom: 1px solid #30363d;
    display: flex; justify-content: space-between; align-items: center;
    background: #0d1117;
  }
  .card-header h2 { font-size: 13px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; }
  .card-body { padding: 12px 16px; max-height: 420px; overflow-y: auto; }

  .kpi-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; }
  .kpi-box {
    text-align: center; padding: 14px 8px; background: #0d1117; border-radius: 6px;
    border: 1px solid #21262d;
  }
  .kpi-box .value { font-size: 24px; font-weight: 700; color: #58a6ff; }
  .kpi-box .label { font-size: 10px; color: #8b949e; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.3px; }
  .kpi-box.green .value { color: #3fb950; }
  .kpi-box.red .value { color: #f85149; }
  .kpi-box.yellow .value { color: #d29922; }
  .kpi-box.purple .value { color: #bc8cff; }
  .kpi-box.cyan .value { color: #39d2c0; }

  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; padding: 6px 10px; color: #8b949e; font-weight: 600; border-bottom: 1px solid #21262d; font-size: 11px; }
  td { padding: 6px 10px; border-bottom: 1px solid #21262d; }
  tr:hover { background: #1c2128; }

  .tag { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; }
  .tag.create { background: #0d2818; color: #3fb950; }
  .tag.archive { background: #2d1117; color: #f85149; }
  .tag.escrow { background: #0c2d6b; color: #58a6ff; }
  .tag.dispute { background: #2d1117; color: #f85149; }
  .tag.token { background: #1a2a0d; color: #3fb950; }
  .tag.agent { background: #2d1f00; color: #d29922; }
  .tag.reputation { background: #1f1a2e; color: #bc8cff; }
  .tag.fee { background: #0d2a2a; color: #39d2c0; }

  .contract-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .contract-bucket {
    background: #0d1117; border: 1px solid #21262d; border-radius: 6px; padding: 10px;
  }
  .contract-bucket .bucket-header {
    display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;
  }
  .contract-bucket .bucket-name { font-size: 11px; color: #8b949e; text-transform: uppercase; }
  .contract-bucket .bucket-count { font-size: 18px; font-weight: 700; color: #58a6ff; }
  .contract-bucket .bucket-items { font-size: 11px; color: #484f58; max-height: 80px; overflow-y: auto; }
  .contract-bucket .bucket-items div { padding: 2px 0; border-bottom: 1px solid #21262d; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .rating-bar { display: flex; align-items: center; gap: 6px; margin: 3px 0; }
  .rating-bar .star-label { width: 20px; text-align: right; font-size: 11px; color: #8b949e; }
  .rating-bar .bar-track { flex: 1; height: 12px; background: #21262d; border-radius: 3px; overflow: hidden; }
  .rating-bar .bar-fill { height: 100%; background: #d29922; border-radius: 3px; transition: width 0.3s; }
  .rating-bar .bar-count { width: 28px; font-size: 11px; color: #8b949e; }

  .party-badge {
    display: inline-block; padding: 2px 8px; border-radius: 4px; margin: 2px;
    font-size: 11px; font-weight: 600; background: #21262d; color: #8b949e;
  }

  .empty { color: #484f58; font-style: italic; text-align: center; padding: 20px; font-size: 12px; }
  .pulse { animation: pulse 2s infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
</style>
</head>
<body>
<div class="header">
  <h1>CAP Protocol Monitor</h1>
  <span class="subtitle">Canton Agent Protocol</span>
  <span id="status" class="status connecting">CONNECTING</span>
  <span class="uptime" id="uptime"></span>
</div>

<div class="grid">
  <!-- KPI Row -->
  <div class="card full-width">
    <div class="card-header"><h2>Key Metrics</h2><span id="poll-info" style="color:#484f58;font-size:11px;"></span></div>
    <div class="card-body">
      <div class="kpi-grid">
        <div class="kpi-box green">
          <div class="value" id="kpi-escrows">0</div>
          <div class="label">Active Escrows</div>
        </div>
        <div class="kpi-box cyan">
          <div class="value" id="kpi-tvl">0</div>
          <div class="label">Value Locked (CAP)</div>
        </div>
        <div class="kpi-box red">
          <div class="value" id="kpi-dispute-rate">0%</div>
          <div class="label">Dispute Rate</div>
        </div>
        <div class="kpi-box yellow">
          <div class="value" id="kpi-agents">0</div>
          <div class="label">Agents</div>
        </div>
        <div class="kpi-box purple">
          <div class="value" id="kpi-avg-rating">-</div>
          <div class="label">Avg Rating</div>
        </div>
        <div class="kpi-box">
          <div class="value" id="kpi-supply">0</div>
          <div class="label">CAPCoin Supply</div>
        </div>
      </div>
    </div>
  </div>

  <!-- Contract Buckets -->
  <div class="card two-col">
    <div class="card-header"><h2>Contract Overview</h2></div>
    <div class="card-body">
      <div class="contract-grid" id="contract-buckets">
        <div class="empty">Loading...</div>
      </div>
    </div>
  </div>

  <!-- Rating Distribution -->
  <div class="card">
    <div class="card-header"><h2>Rating Distribution</h2><span id="total-ratings" style="color:#484f58;font-size:11px;"></span></div>
    <div class="card-body" id="rating-dist">
      <div class="empty">No ratings yet</div>
    </div>
  </div>

  <!-- Parties -->
  <div class="card">
    <div class="card-header"><h2>Ledger Parties</h2></div>
    <div class="card-body" id="parties-list">
      <div class="empty">Loading...</div>
    </div>
  </div>

  <!-- Transaction Log -->
  <div class="card two-col">
    <div class="card-header">
      <h2>Transaction Log (Real-time)</h2>
      <span id="tx-count" style="color:#8b949e;font-size:11px;"></span>
    </div>
    <div class="card-body" id="tx-log" style="max-height:320px;">
      <div class="empty">Waiting for transactions...</div>
    </div>
  </div>
</div>

<script>
const ws = new WebSocket("ws://" + location.host + "/ws");
let startTime = Date.now();

ws.onopen = () => {
  document.getElementById("status").textContent = "LIVE";
  document.getElementById("status").className = "status connected";
};
ws.onclose = () => {
  document.getElementById("status").textContent = "DISCONNECTED";
  document.getElementById("status").className = "status error";
};
ws.onmessage = (e) => {
  const data = JSON.parse(e.data);
  if (data.type === "dashboard") updateDashboard(data.data);
};

const TEMPLATE_TAGS = {
  escrow: "escrow", pendingReview: "escrow", disputeRecord: "dispute",
  arbitratedDispute: "dispute", appealedDispute: "dispute",
  capCoin: "token", lockedCAPCoin: "token", feeTransfer: "fee",
  agentProfile: "agent", serviceListing: "agent",
  rating: "reputation", reputationScore: "reputation",
};

const TEMPLATE_LABELS = ${JSON.stringify(TEMPLATE_LABELS)};

function updateDashboard(d) {
  startTime = Date.now() - (d.uptime * 1000);
  const m = d.metrics;

  // KPIs
  document.getElementById("kpi-escrows").textContent = m.totalActiveEscrows;
  document.getElementById("kpi-tvl").textContent = formatNumber(m.totalValueLocked);
  document.getElementById("kpi-dispute-rate").textContent = (m.disputeRate * 100).toFixed(1) + "%";
  document.getElementById("kpi-agents").textContent = m.totalAgentsRegistered;
  document.getElementById("kpi-avg-rating").textContent = m.averageRating > 0 ? m.averageRating.toFixed(1) : "-";
  document.getElementById("kpi-supply").textContent = formatNumber(m.totalCAPCoinSupply);
  document.getElementById("poll-info").textContent = "Poll #" + d.operational.pollCount + " | " + d.operational.lastPollDurationMs + "ms";

  // Status
  const statusEl = document.getElementById("status");
  if (d.status === "connected") {
    statusEl.textContent = "LIVE"; statusEl.className = "status connected";
  } else if (d.status.startsWith("error")) {
    statusEl.textContent = "ERROR"; statusEl.className = "status error";
  } else {
    statusEl.textContent = "CONNECTING"; statusEl.className = "status connecting";
  }

  // Contract buckets
  const bucketsEl = document.getElementById("contract-buckets");
  let bucketsHTML = "";
  for (const [key, info] of Object.entries(d.contracts)) {
    const tagClass = TEMPLATE_TAGS[key] || "";
    bucketsHTML += '<div class="contract-bucket">' +
      '<div class="bucket-header">' +
        '<span class="bucket-name">' + info.label + '</span>' +
        '<span class="bucket-count">' + info.count + '</span>' +
      '</div>' +
      '<div class="bucket-items">';
    if (info.contracts.length === 0) {
      bucketsHTML += '<div style="color:#484f58;">none</div>';
    } else {
      for (const c of info.contracts.slice(0, 5)) {
        bucketsHTML += '<div title="' + escapeHTML(JSON.stringify(c.payload || {})) + '">' +
          '<span class="tag ' + tagClass + '">' + c.contractId + '</span> ' +
          escapeHTML(c.summary) + '</div>';
      }
      if (info.contracts.length > 5) {
        bucketsHTML += '<div style="color:#484f58;">...and ' + (info.contracts.length - 5) + ' more</div>';
      }
    }
    bucketsHTML += '</div></div>';
  }
  bucketsEl.innerHTML = bucketsHTML;

  // Rating distribution
  const ratingsEl = document.getElementById("rating-dist");
  document.getElementById("total-ratings").textContent = m.totalRatings + " total";
  if (m.totalRatings === 0) {
    ratingsEl.innerHTML = '<div class="empty">No ratings yet</div>';
  } else {
    let rHTML = "";
    for (let i = 5; i >= 1; i--) {
      const count = m.ratingDistribution[i] || 0;
      const pct = m.totalRatings > 0 ? (count / m.totalRatings * 100) : 0;
      rHTML += '<div class="rating-bar">' +
        '<span class="star-label">' + i + '*</span>' +
        '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%"></div></div>' +
        '<span class="bar-count">' + count + '</span></div>';
    }
    ratingsEl.innerHTML = rHTML;
  }

  // Parties
  const partiesEl = document.getElementById("parties-list");
  if (d.parties.length === 0) {
    partiesEl.innerHTML = '<div class="empty">No parties found</div>';
  } else {
    partiesEl.innerHTML = d.parties.map(p =>
      '<span class="party-badge">' + escapeHTML(p.displayName) + '</span>'
    ).join("");
  }

  // Transaction log
  const txEl = document.getElementById("tx-log");
  const txs = d.recentTransactions || [];
  document.getElementById("tx-count").textContent = txs.length + " recent events";
  if (txs.length === 0) {
    txEl.innerHTML = '<div class="empty">Waiting for transactions...</div>';
  } else {
    let html = '<table><tr><th>Time</th><th>Event</th><th>Template</th><th>Detail</th></tr>';
    for (const tx of txs) {
      const time = new Date(tx.time).toLocaleTimeString();
      const typeTag = tx.type === "create"
        ? '<span class="tag create">CREATE</span>'
        : '<span class="tag archive">ARCHIVE</span>';
      const tmplTag = '<span class="tag ' + (TEMPLATE_TAGS[tx.templateKey] || "") + '">' + escapeHTML(tx.template) + '</span>';
      html += '<tr><td style="white-space:nowrap;color:#484f58;">' + time + '</td>' +
        '<td>' + typeTag + '</td><td>' + tmplTag + '</td>' +
        '<td>' + escapeHTML(tx.detail || "") + '</td></tr>';
    }
    html += '</table>';
    txEl.innerHTML = html;
  }
}

function formatNumber(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
}

function escapeHTML(str) {
  if (!str) return "";
  return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

setInterval(() => {
  const secs = Math.floor((Date.now() - startTime) / 1000);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  document.getElementById("uptime").textContent = "uptime " + (h > 0 ? h + "h " : "") + m + "m " + s + "s";
}, 1000);
</script>
</body>
</html>`;
}

// --- HTTP Server ---
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // CORS headers for all responses
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (pathname === "/" || pathname === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(serveDashboardHTML());
    return;
  }

  if (pathname === "/metrics") {
    res.writeHead(200, {
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
    });
    res.end(renderPrometheusMetrics());
    return;
  }

  if (pathname === "/dashboard") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(buildDashboardData(), null, 2));
    return;
  }

  if (pathname === "/health") {
    const healthy = state.ledgerStatus === "connected";
    res.writeHead(healthy ? 200 : 503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: healthy ? "healthy" : "degraded",
      ledgerStatus: state.ledgerStatus,
      packageId: packageId ? packageId.slice(0, 16) + "..." : null,
      ledgerUrl: LEDGER_URL,
      uptime: Math.floor((Date.now() - state.stats.startTime) / 1000),
      pollCount: state.stats.pollCount,
      lastPollTime: state.stats.lastPollTime,
      parties: state.parties.length,
      activeContracts: Object.values(state.contracts).reduce((s, arr) => s + arr.length, 0),
    }));
    return;
  }

  // Legacy endpoint for backward compat
  if (pathname === "/api/state") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(buildDashboardData()));
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    error: "Not found",
    endpoints: {
      "/": "Dashboard UI",
      "/metrics": "Prometheus-format metrics",
      "/dashboard": "JSON dashboard data",
      "/health": "Health check",
      "/ws": "WebSocket real-time updates",
    },
  }));
});

// --- WebSocket Server ---
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  if (req.url === "/ws") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wsClients.add(ws);
      ws.on("close", () => wsClients.delete(ws));
      ws.on("error", () => wsClients.delete(ws));
      // Send initial dashboard state
      ws.send(JSON.stringify({ type: "dashboard", data: buildDashboardData() }));
    });
  } else {
    socket.destroy();
  }
});

// --- Main poll loop ---
async function poll() {
  try {
    await fetchParties();
    await fetchAllContracts();
    calculateMetrics();
    broadcast({ type: "dashboard", data: buildDashboardData() });
  } catch (e) {
    pushError("poll", e.message);
    state.ledgerStatus = "error: " + e.message;
  }
}

server.listen(PORT, () => {
  console.log(`\n  CAP Protocol Monitor`);
  console.log(`  Dashboard:    http://localhost:${PORT}`);
  console.log(`  Metrics:      http://localhost:${PORT}/metrics`);
  console.log(`  Dashboard API:http://localhost:${PORT}/dashboard`);
  console.log(`  Health:       http://localhost:${PORT}/health`);
  console.log(`  WebSocket:    ws://localhost:${PORT}/ws`);
  console.log(`  Ledger API:   ${LEDGER_URL}`);
  console.log(`  Polling:      every ${POLL_INTERVAL}ms`);
  console.log(`  Templates:    ${Object.keys(CAP_TEMPLATES).length} CAP contract types\n`);

  // Initial poll, then interval
  poll();
  setInterval(poll, POLL_INTERVAL);
});
