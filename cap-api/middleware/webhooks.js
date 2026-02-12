/**
 * Webhook notification system for CAP API.
 * Sends outbound HTTP POST notifications for escrow events.
 */

class WebhookManager {
  constructor() {
    this.registrations = new Map(); // id -> { url, events, agentId, createdAt }
    this._counter = 0;
  }

  register(url, events, agentId = "*") {
    const id = `wh_${++this._counter}_${Date.now()}`;
    this.registrations.set(id, {
      url,
      events: events || ["*"],
      agentId,
      createdAt: new Date().toISOString(),
      failureCount: 0,
    });
    return id;
  }

  unregister(id) {
    return this.registrations.delete(id);
  }

  list(agentId = null) {
    const results = [];
    for (const [id, reg] of this.registrations) {
      if (!agentId || reg.agentId === agentId || reg.agentId === "*") {
        results.push({ id, ...reg });
      }
    }
    return results;
  }

  async notify(event) {
    const promises = [];
    for (const [id, reg] of this.registrations) {
      if (this._matches(reg, event)) {
        promises.push(this._send(id, reg, event));
      }
    }
    await Promise.allSettled(promises);
  }

  _matches(reg, event) {
    if (reg.events.includes("*")) return true;
    return reg.events.includes(event.type);
  }

  async _send(id, reg, event) {
    try {
      const resp = await fetch(reg.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CAP-Webhook-Id": id,
          "X-CAP-Event-Type": event.type,
        },
        body: JSON.stringify({
          webhookId: id,
          event,
          timestamp: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) {
        reg.failureCount++;
      } else {
        reg.failureCount = 0;
      }
    } catch (e) {
      reg.failureCount++;
      // Auto-remove after 10 consecutive failures
      if (reg.failureCount >= 10) {
        this.registrations.delete(id);
      }
    }
  }
}

module.exports = { WebhookManager };
