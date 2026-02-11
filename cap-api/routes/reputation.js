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
        ratings: [],
      });
    }

    const totalScore = ratings.reduce((sum, r) => sum + Number(r.payload.score), 0);
    const avgRating = Math.round((totalScore / totalDeals) * 100) / 100;

    res.json({
      agentId,
      totalDeals,
      avgRating,
      // Only show aggregated data, not individual rater identities
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

module.exports = router;
