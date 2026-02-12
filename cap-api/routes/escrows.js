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
    const arbitrated = await req.app.locals.queryContracts(
      userId,
      "Cap.Arbiter:ArbitratedDispute"
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
      arbitratedDisputes: (arbitrated.result || []).map((c) => ({
        contractId: c.contractId,
        status: "arbitrated",
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
    const { provider, resultHash, resultUrl, deliveredAt } = req.body;
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
        deliveredAt: deliveredAt || new Date().toISOString(),
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
      { reason, disputedAt: new Date().toISOString() }
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

// POST /cap/v1/escrows/:id/timeout - Consumer claims timeout refund
router.post("/:id/timeout", async (req, res) => {
  try {
    const { consumer, claimTime } = req.body;
    if (!consumer) {
      return res.status(400).json({ error: "consumer required" });
    }

    const result = await req.app.locals.exerciseChoice(
      consumer,
      "Cap.Escrow:Escrow",
      req.params.id,
      "ClaimTimeout",
      { claimTime: claimTime || new Date().toISOString() }
    );

    req.app.locals.broadcast({
      type: "escrow.timeout",
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

// POST /cap/v1/escrows/:id/escalate - Escalate dispute to arbiter
router.post("/:id/escalate", async (req, res) => {
  try {
    const { consumer, arbiter } = req.body;
    if (!consumer || !arbiter) {
      return res.status(400).json({ error: "consumer and arbiter required" });
    }

    const result = await req.app.locals.exerciseChoice(
      consumer,
      "Cap.Escrow:DisputeRecord",
      req.params.id,
      "EscalateToArbiter",
      { arbiter }
    );

    req.app.locals.broadcast({
      type: "dispute.escalated",
      consumer,
      arbiter,
    });

    res.json({ status: "ok", result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /cap/v1/escrows/:id/submit-evidence - Party submits evidence
router.post("/:id/submit-evidence", async (req, res) => {
  try {
    const { submitter, newEvidence } = req.body;
    if (!submitter || !newEvidence) {
      return res.status(400).json({ error: "submitter and newEvidence required" });
    }

    const result = await req.app.locals.exerciseChoice(
      submitter,
      "Cap.Arbiter:ArbitratedDispute",
      req.params.id,
      "SubmitEvidence",
      { newEvidence, submitter }
    );

    res.json({ status: "ok", result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /cap/v1/escrows/:id/rule-for-consumer - Arbiter rules for consumer
router.post("/:id/rule-for-consumer", async (req, res) => {
  try {
    const { arbiter } = req.body;
    if (!arbiter) {
      return res.status(400).json({ error: "arbiter required" });
    }

    const result = await req.app.locals.exerciseChoice(
      arbiter,
      "Cap.Arbiter:ArbitratedDispute",
      req.params.id,
      "RuleForConsumer",
      {}
    );

    req.app.locals.broadcast({
      type: "dispute.ruled",
      winner: "consumer",
    });

    res.json({ status: "ok", result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /cap/v1/escrows/:id/rule-for-provider - Arbiter rules for provider
router.post("/:id/rule-for-provider", async (req, res) => {
  try {
    const { arbiter } = req.body;
    if (!arbiter) {
      return res.status(400).json({ error: "arbiter required" });
    }

    const result = await req.app.locals.exerciseChoice(
      arbiter,
      "Cap.Arbiter:ArbitratedDispute",
      req.params.id,
      "RuleForProvider",
      {}
    );

    req.app.locals.broadcast({
      type: "dispute.ruled",
      winner: "provider",
    });

    res.json({ status: "ok", result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /cap/v1/escrows/:id/split-ruling - Arbiter splits funds
router.post("/:id/split-ruling", async (req, res) => {
  try {
    const { arbiter, consumerAmount } = req.body;
    if (!arbiter || consumerAmount === undefined) {
      return res.status(400).json({ error: "arbiter and consumerAmount required" });
    }

    const result = await req.app.locals.exerciseChoice(
      arbiter,
      "Cap.Arbiter:ArbitratedDispute",
      req.params.id,
      "SplitRuling",
      { consumerAmount: consumerAmount.toString() }
    );

    req.app.locals.broadcast({
      type: "dispute.ruled",
      ruling: "split",
    });

    res.json({ status: "ok", result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /cap/v1/escrows/:id/claim-dispute-timeout - Auto-resolve dispute on timeout
router.post("/:id/claim-dispute-timeout", async (req, res) => {
  try {
    const { claimer } = req.body;
    if (!claimer) {
      return res.status(400).json({ error: "claimer required" });
    }

    const result = await req.app.locals.exerciseChoice(
      claimer,
      "Cap.Escrow:DisputeRecord",
      req.params.id,
      "ClaimDisputeTimeout",
      { claimTime: new Date().toISOString(), claimer }
    );

    req.app.locals.broadcast({
      type: "dispute.timeout",
      claimer,
    });

    res.json({ status: "ok", result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /cap/v1/escrows/:id/claim-arbiter-timeout - Auto-resolve arbitrated dispute on timeout
router.post("/:id/claim-arbiter-timeout", async (req, res) => {
  try {
    const { claimer } = req.body;
    if (!claimer) {
      return res.status(400).json({ error: "claimer required" });
    }

    const result = await req.app.locals.exerciseChoice(
      claimer,
      "Cap.Arbiter:ArbitratedDispute",
      req.params.id,
      "ClaimArbiterTimeout",
      { claimTime: new Date().toISOString(), claimer }
    );

    req.app.locals.broadcast({
      type: "dispute.arbiter-timeout",
      claimer,
    });

    res.json({ status: "ok", result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /cap/v1/escrows/:id/appeal - Appeal an arbiter's ruling
router.post("/:id/appeal", async (req, res) => {
  try {
    const { appellant, appealReason, appealsCommittee } = req.body;
    if (!appellant || !appealReason || !appealsCommittee) {
      return res.status(400).json({ error: "appellant, appealReason, and appealsCommittee required" });
    }

    const result = await req.app.locals.exerciseChoice(
      appellant,
      "Cap.Arbiter:ArbitratedDispute",
      req.params.id,
      "AppealRuling",
      { appellant, appealReason, appealsCommittee }
    );

    req.app.locals.broadcast({
      type: "dispute.appealed",
      appellant,
      appealsCommittee,
    });

    res.json({ status: "ok", result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /cap/v1/escrows/:id/appeal-rule-for-consumer - Appeals committee rules for consumer
router.post("/:id/appeal-rule-for-consumer", async (req, res) => {
  try {
    const { appealsCommittee } = req.body;
    if (!appealsCommittee) {
      return res.status(400).json({ error: "appealsCommittee required" });
    }

    const result = await req.app.locals.exerciseChoice(
      appealsCommittee,
      "Cap.Arbiter:AppealedDispute",
      req.params.id,
      "AppealRuleForConsumer",
      {}
    );

    req.app.locals.broadcast({
      type: "appeal.ruled",
      winner: "consumer",
    });

    res.json({ status: "ok", result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /cap/v1/escrows/:id/appeal-rule-for-provider - Appeals committee rules for provider
router.post("/:id/appeal-rule-for-provider", async (req, res) => {
  try {
    const { appealsCommittee } = req.body;
    if (!appealsCommittee) {
      return res.status(400).json({ error: "appealsCommittee required" });
    }

    const result = await req.app.locals.exerciseChoice(
      appealsCommittee,
      "Cap.Arbiter:AppealedDispute",
      req.params.id,
      "AppealRuleForProvider",
      {}
    );

    req.app.locals.broadcast({
      type: "appeal.ruled",
      winner: "provider",
    });

    res.json({ status: "ok", result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
