const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const http = require("http");
const { WebSocketServer } = require("ws");

const agentRoutes = require("./routes/agents");
const serviceRoutes = require("./routes/services");
const escrowRoutes = require("./routes/escrows");
const reputationRoutes = require("./routes/reputation");
const walletRoutes = require("./routes/wallet");
const feeRoutes = require("./routes/fees");
const webhookRoutes = require("./routes/webhooks");
const { WebhookManager } = require("./middleware/webhooks");

const app = express();
app.use(cors());
app.use(express.json());

const LEDGER_URL = process.env.LEDGER_URL || "http://localhost:7575";
const PORT = process.env.CAP_PORT || 4000;

// Discover package ID and registry party on startup
let packageId = null;
let registryPartyId = null;

async function discoverPackageId() {
  if (packageId) return packageId;
  try {
    const token = createToken("alice");
    const resp = await fetch(`${LEDGER_URL}/v1/packages`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
    const data = await resp.json();
    if (!data.result) return null;

    for (const pkg of data.result) {
      try {
        const qResp = await fetch(`${LEDGER_URL}/v1/query`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
          body: JSON.stringify({
            templateIds: [`${pkg}:Cap.Token:CAPCoin`],
          }),
        });
        const qData = await qResp.json();
        if (qData.status === 200) {
          packageId = pkg;
          console.log(`  Package ID: ${pkg}`);
          return pkg;
        }
      } catch {}
    }
  } catch (e) {
    console.error("Package discovery failed:", e.message);
  }
  return null;
}

// Extract userId from party ID (e.g., "alice::1220..." → "alice")
function toUserId(partyOrUser) {
  if (!partyOrUser) return partyOrUser;
  const parts = partyOrUser.split("::");
  return parts[0].toLowerCase();
}

// JWT helper — HS256 signed
const JWT_SECRET = process.env.JWT_SECRET || "cap-dev-secret-change-in-production";

function createToken(userId) {
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    sub: userId,
    scope: "daml_ledger_api",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  const encode = (obj) =>
    Buffer.from(JSON.stringify(obj))
      .toString("base64url");
  const unsigned = `${encode(header)}.${encode(payload)}`;
  const signature = crypto
    .createHmac("sha256", JWT_SECRET)
    .update(unsigned)
    .digest("base64url");
  return `${unsigned}.${signature}`;
}

// Ledger API helper
async function ledgerRequest(userId, method, path, body) {
  const token = createToken(userId);
  const resp = await fetch(`${LEDGER_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return resp.json();
}

async function createContract(userId, templateId, payload) {
  const pkg = await discoverPackageId();
  return ledgerRequest(toUserId(userId), "POST", "/v1/create", {
    templateId: `${pkg}:${templateId}`,
    payload,
  });
}

async function exerciseChoice(userId, templateId, contractId, choice, argument) {
  const pkg = await discoverPackageId();
  return ledgerRequest(toUserId(userId), "POST", "/v1/exercise", {
    templateId: `${pkg}:${templateId}`,
    contractId,
    choice,
    argument,
  });
}

async function queryContracts(userId, templateId, query = {}) {
  const pkg = await discoverPackageId();
  return ledgerRequest(toUserId(userId), "POST", "/v1/query", {
    templateIds: [`${pkg}:${templateId}`],
    query,
  });
}

// Resolve registry party ID from the ledger
async function resolveRegistryParty() {
  if (registryPartyId) return registryPartyId;
  try {
    const token = createToken("registry");
    const resp = await fetch(`${LEDGER_URL}/v1/parties`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
    const data = await resp.json();
    if (data.result) {
      for (const p of data.result) {
        if (p.displayName === "Registry" || p.identifier?.startsWith("registry::")) {
          registryPartyId = p.identifier;
          console.log(`  Registry: ${registryPartyId.substring(0, 30)}...`);
          return registryPartyId;
        }
      }
    }
  } catch (e) {
    console.error("Registry party resolution failed:", e.message);
  }
  return null;
}

// Resolve all party IDs and cache them
const partyCache = new Map();

async function resolvePartyId(userId) {
  const key = toUserId(userId);
  if (partyCache.has(key)) return partyCache.get(key);
  // If it already looks like a full party ID, cache and return
  if (userId.includes("::")) {
    partyCache.set(key, userId);
    return userId;
  }
  try {
    const token = createToken(key);
    const resp = await fetch(`${LEDGER_URL}/v1/parties`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
    const data = await resp.json();
    if (data.result) {
      for (const p of data.result) {
        const shortName = p.identifier.split("::")[0].toLowerCase();
        partyCache.set(shortName, p.identifier);
      }
    }
  } catch (e) {
    console.error("Party resolution failed:", e.message);
  }
  return partyCache.get(key) || userId;
}

// Middleware: resolve party fields in request body
app.use(async (req, res, next) => {
  if (req.body && typeof req.body === "object") {
    const partyFields = ["consumer", "provider", "agentId", "owner", "newOwner", "receiver", "arbiter", "treasury", "submitter"];
    for (const field of partyFields) {
      if (req.body[field] && typeof req.body[field] === "string" && !req.body[field].includes("::")) {
        req.body[field] = await resolvePartyId(req.body[field]);
      }
    }
  }
  next();
});

// Make helpers available to routes
app.locals.createContract = createContract;
app.locals.exerciseChoice = exerciseChoice;
app.locals.queryContracts = queryContracts;
app.locals.createToken = createToken;
app.locals.LEDGER_URL = LEDGER_URL;
app.locals.getPackageId = discoverPackageId;
app.locals.getRegistryParty = resolveRegistryParty;

// Webhook manager
const webhookManager = new WebhookManager();
app.locals.webhookManager = webhookManager;

// Routes
app.use("/cap/v1/agents", agentRoutes);
app.use("/cap/v1/services", serviceRoutes);
app.use("/cap/v1/escrows", escrowRoutes);
app.use("/cap/v1/reputation", reputationRoutes);
app.use("/cap/v1/wallet", walletRoutes);
app.use("/cap/v1/fees", feeRoutes);
app.use("/cap/v1/webhooks", webhookRoutes);

// Party resolution
app.get("/cap/v1/parties", async (req, res) => {
  const userId = req.query.as || "alice";
  try {
    const token = createToken(toUserId(userId));
    const resp = await fetch(`${LEDGER_URL}/v1/parties`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
    const data = await resp.json();
    const parties = {};
    for (const p of data.result || []) {
      const shortName = p.identifier.split("::")[0].toLowerCase();
      parties[shortName] = p.identifier;
      partyCache.set(shortName, p.identifier);
    }
    res.json({ parties });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Health check
app.get("/cap/v1/health", async (req, res) => {
  const pkg = await discoverPackageId();
  res.json({
    status: pkg ? "ok" : "no_package",
    packageId: pkg,
    ledgerUrl: LEDGER_URL,
  });
});

// Static pages
const path = require("path");
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});
app.get("/demo", (req, res) => {
  res.sendFile(path.join(__dirname, "demo.html"));
});
app.get("/ko.html", (req, res) => {
  res.sendFile(path.join(__dirname, "ko.html"));
});
app.get("/zh.html", (req, res) => {
  res.sendFile(path.join(__dirname, "zh.html"));
});
app.get("/ja.html", (req, res) => {
  res.sendFile(path.join(__dirname, "ja.html"));
});

// Protocol info
app.get("/cap/v1", (req, res) => {
  res.json({
    protocol: "Canton Agent Protocol (CAP)",
    version: "0.2.0",
    endpoints: {
      agents: "/cap/v1/agents",
      discover: "/cap/v1/services/discover?capability=X",
      services: "/cap/v1/services",
      escrows: "/cap/v1/escrows",
      reputation: "/cap/v1/reputation/:agentId",
      wallet: "/cap/v1/wallet",
      fees: "/cap/v1/fees",
      webhooks: "/cap/v1/webhooks",
      health: "/cap/v1/health",
    },
  });
});

// Start server with WebSocket support
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/cap/v1/ws" });

// WebSocket: broadcast contract events to connected agents
const wsClients = new Map();

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const agentId = url.searchParams.get("agentId") || "anonymous";
  wsClients.set(ws, { agentId });
  console.log(`  WS connected: ${agentId}`);

  ws.on("close", () => {
    wsClients.delete(ws);
    console.log(`  WS disconnected: ${agentId}`);
  });
});

function broadcast(event) {
  const msg = JSON.stringify(event);
  for (const [ws, info] of wsClients) {
    if (ws.readyState === 1) {
      ws.send(msg);
    }
  }
  // Fire webhooks asynchronously
  webhookManager.notify(event).catch(() => {});
}

app.locals.broadcast = broadcast;

server.listen(PORT, async () => {
  console.log(`\nCAP API Gateway`);
  console.log(`  Listening: http://localhost:${PORT}`);
  console.log(`  Ledger:    ${LEDGER_URL}`);
  await discoverPackageId();
  await resolveRegistryParty();
  console.log(`  Ready.\n`);
});
