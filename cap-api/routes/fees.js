const router = require("express").Router();

// GET /cap/v1/fees/pending - List uncollected FeeTransfer contracts
router.get("/pending", async (req, res) => {
  try {
    const userId = req.query.as || "treasury";

    const result = await req.app.locals.queryContracts(
      userId,
      "Cap.Token:FeeTransfer"
    );

    const pending = (result.result || []).map((c) => ({
      contractId: c.contractId,
      ...c.payload,
    }));

    const totalPending = pending.reduce((sum, f) => sum + Number(f.amount), 0);

    res.json({ pending, totalPending });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /cap/v1/fees/collect - Treasury collects all pending fees
router.post("/collect", async (req, res) => {
  try {
    const { treasury } = req.body;
    if (!treasury) {
      return res.status(400).json({ error: "treasury required" });
    }

    const pending = await req.app.locals.queryContracts(
      treasury,
      "Cap.Token:FeeTransfer"
    );

    const results = [];
    for (const fee of pending.result || []) {
      const result = await req.app.locals.exerciseChoice(
        treasury,
        "Cap.Token:FeeTransfer",
        fee.contractId,
        "CollectFee",
        {}
      );
      results.push(result);
    }

    res.json({ status: "ok", collected: results.length, results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /cap/v1/fees/stats - Fee collection statistics
router.get("/stats", async (req, res) => {
  try {
    const userId = req.query.as || "treasury";

    // Pending fees
    const pending = await req.app.locals.queryContracts(
      userId,
      "Cap.Token:FeeTransfer"
    );
    const pendingFees = (pending.result || []);
    const totalPending = pendingFees.reduce((sum, f) => sum + Number(f.payload.amount), 0);

    // Collected fees (CAPCoin owned by treasury)
    const coins = await req.app.locals.queryContracts(
      userId,
      "Cap.Token:CAPCoin",
      { owner: userId }
    );
    const treasuryCoins = (coins.result || []);
    const totalCollected = treasuryCoins.reduce((sum, c) => sum + Number(c.payload.amount), 0);

    res.json({
      pendingCount: pendingFees.length,
      totalPending: Math.round(totalPending * 100) / 100,
      totalCollected: Math.round(totalCollected * 100) / 100,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
