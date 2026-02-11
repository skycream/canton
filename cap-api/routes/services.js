const router = require("express").Router();

// GET /cap/v1/services/discover?capability=X - Find agents by capability
router.get("/discover", async (req, res) => {
  try {
    // Discovery always uses registry party (has observer rights on all listings)
    const userId = "registry";
    const capability = req.query.capability;

    const query = capability ? { capability } : {};
    const result = await req.app.locals.queryContracts(
      userId,
      "Cap.Agent:ServiceListing",
      query
    );

    const listings = (result.result || []).map((c) => ({
      contractId: c.contractId,
      ...c.payload,
    }));
    res.json({ listings });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /cap/v1/services/listings - Create a service listing
router.post("/listings", async (req, res) => {
  try {
    const { agentId, capability, description, basePrice } = req.body;
    if (!agentId || !capability) {
      return res.status(400).json({ error: "agentId and capability required" });
    }

    const registry = await req.app.locals.getRegistryParty();
    if (!registry) {
      return res.status(503).json({ error: "Registry party not resolved" });
    }

    const result = await req.app.locals.createContract(
      agentId,
      "Cap.Agent:ServiceListing",
      {
        registry,
        provider: agentId,
        capability,
        description: description || "",
        basePrice: basePrice?.toString() || "0.0",
      }
    );

    res.json({ status: "ok", contractId: result.result?.contractId, result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /cap/v1/services/requests - Create a service request
router.post("/requests", async (req, res) => {
  try {
    const { consumer, provider, capability, params, maxPrice, slaTerms } = req.body;
    if (!consumer || !provider || !capability) {
      return res
        .status(400)
        .json({ error: "consumer, provider, and capability required" });
    }

    const result = await req.app.locals.createContract(
      consumer,
      "Cap.Service:ServiceRequest",
      {
        consumer,
        provider,
        capability,
        params: typeof params === "string" ? params : JSON.stringify(params || {}),
        maxPrice: maxPrice?.toString() || "1.0",
        slaTerms: slaTerms || { maxLatencyMs: "30000", penaltyRate: "0.0" },
      }
    );

    req.app.locals.broadcast({
      type: "service.requested",
      consumer,
      provider,
      capability,
    });

    res.json({ status: "ok", contractId: result.result?.contractId, result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /cap/v1/services/requests - List service requests
router.get("/requests", async (req, res) => {
  try {
    const userId = req.query.as || req.headers["x-cap-agent-id"];
    if (!userId) {
      return res.status(400).json({ error: "as query param or x-cap-agent-id header required" });
    }

    const result = await req.app.locals.queryContracts(
      userId,
      "Cap.Service:ServiceRequest"
    );

    const requests = (result.result || []).map((c) => ({
      contractId: c.contractId,
      ...c.payload,
    }));
    res.json({ requests });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /cap/v1/services/requests/:id/offer - Make an offer
router.post("/requests/:id/offer", async (req, res) => {
  try {
    const { provider, price, estimatedTimeMs } = req.body;
    if (!provider || price === undefined) {
      return res.status(400).json({ error: "provider and price required" });
    }

    const result = await req.app.locals.exerciseChoice(
      provider,
      "Cap.Service:ServiceRequest",
      req.params.id,
      "MakeOffer",
      {
        price: price.toString(),
        estimatedTimeMs: parseInt(estimatedTimeMs || 5000),
      }
    );

    req.app.locals.broadcast({
      type: "service.offered",
      provider,
      price,
      contractId: req.params.id,
    });

    res.json({ status: "ok", result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /cap/v1/services/offers - List service offers
router.get("/offers", async (req, res) => {
  try {
    const userId = req.query.as || req.headers["x-cap-agent-id"];
    if (!userId) {
      return res.status(400).json({ error: "as query param or x-cap-agent-id header required" });
    }

    const result = await req.app.locals.queryContracts(
      userId,
      "Cap.Service:ServiceOffer"
    );

    const offers = (result.result || []).map((c) => ({
      contractId: c.contractId,
      ...c.payload,
    }));
    res.json({ offers });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /cap/v1/services/requests/:id/decline - Provider declines request
router.post("/requests/:id/decline", async (req, res) => {
  try {
    const { provider } = req.body;
    if (!provider) {
      return res.status(400).json({ error: "provider required" });
    }

    const result = await req.app.locals.exerciseChoice(
      provider,
      "Cap.Service:ServiceRequest",
      req.params.id,
      "DeclineRequest",
      {}
    );

    res.json({ status: "ok", result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /cap/v1/services/requests/:id/withdraw - Consumer withdraws request
router.post("/requests/:id/withdraw", async (req, res) => {
  try {
    const { consumer } = req.body;
    if (!consumer) {
      return res.status(400).json({ error: "consumer required" });
    }

    const result = await req.app.locals.exerciseChoice(
      consumer,
      "Cap.Service:ServiceRequest",
      req.params.id,
      "WithdrawRequest",
      {}
    );

    res.json({ status: "ok", result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /cap/v1/services/offers/:id/reject - Consumer rejects offer
router.post("/offers/:id/reject", async (req, res) => {
  try {
    const { consumer } = req.body;
    if (!consumer) {
      return res.status(400).json({ error: "consumer required" });
    }

    const result = await req.app.locals.exerciseChoice(
      consumer,
      "Cap.Service:ServiceOffer",
      req.params.id,
      "RejectOffer",
      {}
    );

    res.json({ status: "ok", result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /cap/v1/services/offers/:id/withdraw - Provider withdraws offer
router.post("/offers/:id/withdraw", async (req, res) => {
  try {
    const { provider } = req.body;
    if (!provider) {
      return res.status(400).json({ error: "provider required" });
    }

    const result = await req.app.locals.exerciseChoice(
      provider,
      "Cap.Service:ServiceOffer",
      req.params.id,
      "WithdrawOffer",
      {}
    );

    res.json({ status: "ok", result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /cap/v1/services/offers/:id/accept - Accept an offer (creates escrow)
router.post("/offers/:id/accept", async (req, res) => {
  try {
    const { consumer, paymentCid } = req.body;
    if (!consumer || !paymentCid) {
      return res.status(400).json({ error: "consumer and paymentCid required" });
    }

    const result = await req.app.locals.exerciseChoice(
      consumer,
      "Cap.Service:ServiceOffer",
      req.params.id,
      "AcceptOffer",
      { paymentCid }
    );

    req.app.locals.broadcast({
      type: "escrow.created",
      consumer,
      offerId: req.params.id,
    });

    res.json({ status: "ok", result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /cap/v1/services/listings/:id - Update a listing
router.put("/listings/:id", async (req, res) => {
  try {
    const { provider, description, basePrice } = req.body;
    if (!provider) {
      return res.status(400).json({ error: "provider required" });
    }

    const result = await req.app.locals.exerciseChoice(
      provider,
      "Cap.Agent:ServiceListing",
      req.params.id,
      "UpdateListing",
      {
        newDescription: description || "",
        newPrice: basePrice?.toString() || "0.0",
      }
    );

    res.json({ status: "ok", result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /cap/v1/services/listings/:id - Remove a listing
router.delete("/listings/:id", async (req, res) => {
  try {
    const { provider } = req.body;
    if (!provider) {
      return res.status(400).json({ error: "provider required" });
    }

    const result = await req.app.locals.exerciseChoice(
      provider,
      "Cap.Agent:ServiceListing",
      req.params.id,
      "RemoveListing",
      {}
    );

    res.json({ status: "ok", result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
