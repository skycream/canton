const router = require("express").Router();

// GET /cap/v1/reputation/:agentId - Get aggregated reputation
router.get("/:agentId", async (req, res) => {
  try {
    const agentId = req.params.agentId;

    // Query ratings where this agent was rated
    const result = await req.app.locals.queryContracts(
      agentId,
      "Cap.Reputation:Rating",
      { rated: agentId }
    );

    const ratings = result.result || [];
    const totalDeals = ratings.length;

    if (totalDeals === 0) {
      return res.json({
        agentId,
        totalDeals: 0,
        avgRating: 0,
        asProvider: { totalDeals: 0, avgRating: 0, confidence: 0 },
        asConsumer: { totalDeals: 0, avgRating: 0, confidence: 0 },
        ratings: [],
      });
    }

    const totalScore = ratings.reduce((sum, r) => sum + Number(r.payload.score), 0);
    const avgRating = Math.round((totalScore / totalDeals) * 100) / 100;

    // Bidirectional split: role field = who the RATER was.
    // role="consumer" → rater was consumer → rated agent acted as PROVIDER
    // role="provider" → rater was provider → rated agent acted as CONSUMER
    const asProviderRatings = ratings.filter((r) => r.payload.role === "consumer");
    const asConsumerRatings = ratings.filter((r) => r.payload.role === "provider");

    const calcStats = (list) => {
      if (list.length === 0) return { totalDeals: 0, avgRating: 0, confidence: 0 };
      const total = list.reduce((sum, r) => sum + Number(r.payload.score), 0);
      return {
        totalDeals: list.length,
        avgRating: Math.round((total / list.length) * 100) / 100,
        confidence: Math.min(1.0, Math.round((list.length / 10) * 100) / 100),
      };
    };

    res.json({
      agentId,
      totalDeals,
      avgRating,
      asProvider: calcStats(asProviderRatings),
      asConsumer: calcStats(asConsumerRatings),
      distribution: {
        5: ratings.filter((r) => Number(r.payload.score) === 5).length,
        4: ratings.filter((r) => Number(r.payload.score) === 4).length,
        3: ratings.filter((r) => Number(r.payload.score) === 3).length,
        2: ratings.filter((r) => Number(r.payload.score) === 2).length,
        1: ratings.filter((r) => Number(r.payload.score) === 1).length,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /cap/v1/reputation/:agentId/invitations - List pending rating invitations
router.get("/:agentId/invitations", async (req, res) => {
  try {
    const agentId = req.params.agentId;

    const result = await req.app.locals.queryContracts(
      agentId,
      "Cap.Reputation:RatingInvitation",
      { rater: agentId }
    );

    const invitations = (result.result || []).map((c) => ({
      contractId: c.contractId,
      ...c.payload,
    }));

    res.json({ invitations });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /cap/v1/reputation/:agentId/rate/:invitationId - Submit rating via invitation
router.post("/:agentId/rate/:invitationId", async (req, res) => {
  try {
    const { score, comment } = req.body;
    if (score === undefined) {
      return res.status(400).json({ error: "score required" });
    }

    const result = await req.app.locals.exerciseChoice(
      req.params.agentId,
      "Cap.Reputation:RatingInvitation",
      req.params.invitationId,
      "SubmitRating",
      {
        score: parseInt(score),
        comment: comment || "",
      }
    );

    res.json({ status: "ok", result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
