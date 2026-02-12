const router = require("express").Router();

// POST /cap/v1/agents - Register a new agent
router.post("/", async (req, res) => {
  try {
    const { agentId, name, description, capabilities, endpoint } = req.body;
    if (!agentId || !name) {
      return res.status(400).json({ error: "agentId and name required" });
    }

    const registry = await req.app.locals.getRegistryParty();
    if (!registry) {
      return res.status(503).json({ error: "Registry party not resolved" });
    }

    const result = await req.app.locals.createContract(
      agentId,
      "Cap.Agent:AgentProfile",
      {
        registry,
        agent: agentId,
        name,
        description: description || "",
        capabilities: capabilities || [],
        endpoint: endpoint || "",
      }
    );

    req.app.locals.broadcast({
      type: "agent.registered",
      agentId,
      name,
      capabilities,
    });

    res.json({ status: "ok", contractId: result.result?.contractId, result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /cap/v1/agents - List all agents (queries via registry party)
router.get("/", async (req, res) => {
  try {
    const userId = req.query.as || "registry";
    const result = await req.app.locals.queryContracts(
      userId,
      "Cap.Agent:AgentProfile"
    );
    const agents = (result.result || []).map((c) => ({
      contractId: c.contractId,
      ...c.payload,
    }));
    res.json({ agents });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /cap/v1/agents/:id - Get agent profile
router.get("/:id", async (req, res) => {
  try {
    const userId = req.query.as || req.headers["x-cap-agent-id"] || "alice";
    const result = await req.app.locals.queryContracts(
      userId,
      "Cap.Agent:AgentProfile",
      { agent: req.params.id }
    );
    const agents = result.result || [];
    if (agents.length === 0) {
      return res.status(404).json({ error: "Agent not found" });
    }
    res.json({ agent: { contractId: agents[0].contractId, ...agents[0].payload } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /cap/v1/agents/:id - Update agent profile
router.put("/:id", async (req, res) => {
  try {
    const agentId = req.params.id;
    const { name, description, capabilities, endpoint } = req.body;

    // Find current profile
    const current = await req.app.locals.queryContracts(
      agentId,
      "Cap.Agent:AgentProfile",
      { agent: agentId }
    );
    const contracts = current.result || [];
    if (contracts.length === 0) {
      return res.status(404).json({ error: "Agent not found" });
    }

    const result = await req.app.locals.exerciseChoice(
      agentId,
      "Cap.Agent:AgentProfile",
      contracts[0].contractId,
      "UpdateProfile",
      {
        newName: name || contracts[0].payload.name,
        newDescription: description || contracts[0].payload.description,
        newCapabilities: capabilities || contracts[0].payload.capabilities,
        newEndpoint: endpoint || contracts[0].payload.endpoint,
      }
    );

    res.json({ status: "ok", result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /cap/v1/agents/:id - Deactivate agent
router.delete("/:id", async (req, res) => {
  try {
    const agentId = req.params.id;

    const current = await req.app.locals.queryContracts(
      agentId,
      "Cap.Agent:AgentProfile",
      { agent: agentId }
    );
    const contracts = current.result || [];
    if (contracts.length === 0) {
      return res.status(404).json({ error: "Agent not found" });
    }

    const result = await req.app.locals.exerciseChoice(
      agentId,
      "Cap.Agent:AgentProfile",
      contracts[0].contractId,
      "Deactivate",
      {}
    );

    req.app.locals.broadcast({
      type: "agent.deactivated",
      agentId,
    });

    res.json({ status: "ok", result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
