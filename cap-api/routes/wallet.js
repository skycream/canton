const router = require("express").Router();

// GET /cap/v1/wallet?as=agentId - Get agent's coin balance
router.get("/", async (req, res) => {
  try {
    const userId = req.query.as || req.headers["x-cap-agent-id"];
    if (!userId) {
      return res.status(400).json({ error: "as query param required" });
    }

    const result = await req.app.locals.queryContracts(
      userId,
      "Cap.Token:CAPCoin"
    );

    const coins = result.result || [];
    const balance = coins.reduce((sum, c) => sum + Number(c.payload.amount), 0);

    res.json({
      agentId: userId,
      balance,
      coins: coins.map((c) => ({
        contractId: c.contractId,
        amount: Number(c.payload.amount),
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /cap/v1/wallet/split - Split a coin
router.post("/split", async (req, res) => {
  try {
    const { owner, contractId, splitAmount } = req.body;
    if (!owner || !contractId || splitAmount === undefined) {
      return res.status(400).json({ error: "owner, contractId, and splitAmount required" });
    }

    const result = await req.app.locals.exerciseChoice(
      owner,
      "Cap.Token:CAPCoin",
      contractId,
      "Split",
      { splitAmount: splitAmount.toString() }
    );

    res.json({ status: "ok", result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /cap/v1/wallet/transfer - Propose transferring a coin to another party
router.post("/transfer", async (req, res) => {
  try {
    const { owner, contractId, receiver } = req.body;
    if (!owner || !contractId || !receiver) {
      return res.status(400).json({ error: "owner, contractId, and receiver required" });
    }

    const result = await req.app.locals.exerciseChoice(
      owner,
      "Cap.Token:CAPCoin",
      contractId,
      "ProposeTransfer",
      { receiver }
    );

    res.json({ status: "ok", result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /cap/v1/wallet/transfer/:id/accept - Accept a transfer proposal
router.post("/transfer/:id/accept", async (req, res) => {
  try {
    const { receiver } = req.body;
    if (!receiver) {
      return res.status(400).json({ error: "receiver required" });
    }

    const result = await req.app.locals.exerciseChoice(
      receiver,
      "Cap.Token:TransferProposal",
      req.params.id,
      "AcceptTransfer",
      {}
    );

    res.json({ status: "ok", result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /cap/v1/wallet/transfer/:id/reject - Reject a transfer proposal
router.post("/transfer/:id/reject", async (req, res) => {
  try {
    const { receiver } = req.body;
    if (!receiver) {
      return res.status(400).json({ error: "receiver required" });
    }

    const result = await req.app.locals.exerciseChoice(
      receiver,
      "Cap.Token:TransferProposal",
      req.params.id,
      "RejectTransfer",
      {}
    );

    res.json({ status: "ok", result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /cap/v1/wallet/merge - Merge two coins
router.post("/merge", async (req, res) => {
  try {
    const { owner, contractId, otherCid } = req.body;
    if (!owner || !contractId || !otherCid) {
      return res.status(400).json({ error: "owner, contractId, and otherCid required" });
    }

    const result = await req.app.locals.exerciseChoice(
      owner,
      "Cap.Token:CAPCoin",
      contractId,
      "Merge",
      { otherCid }
    );

    res.json({ status: "ok", result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
