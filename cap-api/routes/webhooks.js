const router = require("express").Router();
const { validate, schemas } = require("../middleware/validate");

// POST /cap/v1/webhooks - Register a webhook
router.post("/", validate(schemas.webhookRegister), (req, res) => {
  const { url, events, agentId } = req.body;
  const id = req.app.locals.webhookManager.register(url, events, agentId || "*");
  res.json({ status: "ok", webhookId: id });
});

// GET /cap/v1/webhooks - List registered webhooks
router.get("/", (req, res) => {
  const agentId = req.query.agentId || null;
  const webhooks = req.app.locals.webhookManager.list(agentId);
  res.json({ webhooks });
});

// DELETE /cap/v1/webhooks/:id - Unregister a webhook
router.delete("/:id", (req, res) => {
  const deleted = req.app.locals.webhookManager.unregister(req.params.id);
  if (deleted) {
    res.json({ status: "ok" });
  } else {
    res.status(404).json({ error: "Webhook not found" });
  }
});

// POST /cap/v1/webhooks/test - Test webhook delivery
router.post("/test", async (req, res) => {
  const { webhookId } = req.body;
  if (!webhookId) {
    return res.status(400).json({ error: "webhookId required" });
  }
  await req.app.locals.webhookManager.notify({
    type: "webhook.test",
    webhookId,
    timestamp: new Date().toISOString(),
  });
  res.json({ status: "ok", message: "Test event sent" });
});

module.exports = router;
