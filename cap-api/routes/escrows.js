const router = require("express").Router();

// GET /cap/v1/escrows - List active escrows
router.get("/", async (req, res) => {
  try {
    const userId = req.query.as || req.headers["x-cap-agent-id"];
    if (!userId) {
      return res.status(400).json({ error: "as query param required" });
    }

    const escrows = await req.app.locals.queryContracts(
      userId,
      "Cap.Escrow:Escrow"
    );
    const reviews = await req.app.locals.queryContracts(
      userId,
      "Cap.Escrow:PendingReview"
    );
    const disputes = await req.app.locals.queryContracts(
      userId,
      "Cap.Escrow:DisputeRecord"
    );

    res.json({
      escrows: (escrows.result || []).map((c) => ({
        contractId: c.contractId,
        status: "locked",
        ...c.payload,
      })),
      pendingReviews: (reviews.result || []).map((c) => ({
        contractId: c.contractId,
        status: "delivered",
        ...c.payload,
      })),
      disputes: (disputes.result || []).map((c) => ({
        contractId: c.contractId,
        status: "disputed",
        ...c.payload,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /cap/v1/escrows/:id/deliver - Provider delivers work
router.post("/:id/deliver", async (req, res) => {
  try {
    const { provider, resultHash, resultUrl } = req.body;
    if (!provider || !resultHash) {
      return res.status(400).json({ error: "provider and resultHash required" });
    }

    const result = await req.app.locals.exerciseChoice(
      provider,
      "Cap.Escrow:Escrow",
      req.params.id,
      "Deliver",
      {
        resultHash,
        resultUrl: resultUrl || "",
      }
    );

    req.app.locals.broadcast({
      type: "escrow.delivered",
      provider,
      escrowId: req.params.id,
    });

    res.json({ status: "ok", result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /cap/v1/escrows/:id/approve - Consumer approves (quick)
router.post("/:id/approve", async (req, res) => {
  try {
    const { consumer } = req.body;
    if (!consumer) {
      return res.status(400).json({ error: "consumer required" });
    }

    const result = await req.app.locals.exerciseChoice(
      consumer,
      "Cap.Escrow:PendingReview",
      req.params.id,
      "QuickApprove",
      {}
    );

    req.app.locals.broadcast({
      type: "escrow.settled",
      consumer,
      reviewId: req.params.id,
    });

    res.json({ status: "ok", result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /cap/v1/escrows/:id/approve-with-rating - Approve with ratings
router.post("/:id/approve-with-rating", async (req, res) => {
  try {
    const { consumer, consumerRating, consumerComment } = req.body;
    if (!consumer) {
      return res.status(400).json({ error: "consumer required" });
    }

    const result = await req.app.locals.exerciseChoice(
      consumer,
      "Cap.Escrow:PendingReview",
      req.params.id,
      "ApproveAndPay",
      {
        consumerRating: parseInt(consumerRating || 5),
        consumerComment: consumerComment || "",
      }
    );

    req.app.locals.broadcast({
      type: "escrow.settled",
      consumer,
      reviewId: req.params.id,
      ratings: true,
    });

    res.json({ status: "ok", result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /cap/v1/escrows/:id/dispute - Consumer disputes delivery
router.post("/:id/dispute", async (req, res) => {
  try {
    const { consumer, reason } = req.body;
    if (!consumer || !reason) {
      return res.status(400).json({ error: "consumer and reason required" });
    }

    const result = await req.app.locals.exerciseChoice(
      consumer,
      "Cap.Escrow:PendingReview",
      req.params.id,
      "Dispute",
      { reason }
    );

    req.app.locals.broadcast({
      type: "escrow.disputed",
      consumer,
      reason,
    });

    res.json({ status: "ok", result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /cap/v1/escrows/:id/cancel - Consumer cancels escrow
router.post("/:id/cancel", async (req, res) => {
  try {
    const { consumer } = req.body;
    if (!consumer) {
      return res.status(400).json({ error: "consumer required" });
    }

    const result = await req.app.locals.exerciseChoice(
      consumer,
      "Cap.Escrow:Escrow",
      req.params.id,
      "CancelEscrow",
      {}
    );

    req.app.locals.broadcast({
      type: "escrow.cancelled",
      consumer,
    });

    res.json({ status: "ok", result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /cap/v1/escrows/:id/abandon - Provider abandons escrow (refunds consumer)
router.post("/:id/abandon", async (req, res) => {
  try {
    const { provider } = req.body;
    if (!provider) {
      return res.status(400).json({ error: "provider required" });
    }

    const result = await req.app.locals.exerciseChoice(
      provider,
      "Cap.Escrow:Escrow",
      req.params.id,
      "AbandonEscrow",
      {}
    );

    req.app.locals.broadcast({
      type: "escrow.abandoned",
      provider,
    });

    res.json({ status: "ok", result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /cap/v1/escrows/:id/resolve-for-consumer - Provider concedes dispute
router.post("/:id/resolve-for-consumer", async (req, res) => {
  try {
    const { provider } = req.body;
    if (!provider) {
      return res.status(400).json({ error: "provider required" });
    }

    const result = await req.app.locals.exerciseChoice(
      provider,
      "Cap.Escrow:DisputeRecord",
      req.params.id,
      "ResolveForConsumer",
      {}
    );

    req.app.locals.broadcast({
      type: "dispute.resolved",
      winner: "consumer",
    });

    res.json({ status: "ok", result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /cap/v1/escrows/:id/resolve-for-provider - Consumer concedes dispute
router.post("/:id/resolve-for-provider", async (req, res) => {
  try {
    const { consumer } = req.body;
    if (!consumer) {
      return res.status(400).json({ error: "consumer required" });
    }

    const result = await req.app.locals.exerciseChoice(
      consumer,
      "Cap.Escrow:DisputeRecord",
      req.params.id,
      "ResolveForProvider",
      {}
    );

    req.app.locals.broadcast({
      type: "dispute.resolved",
      winner: "provider",
    });

    res.json({ status: "ok", result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
