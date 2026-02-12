/**
 * Input validation middleware for CAP API.
 * Lightweight schema validation without external dependencies.
 */

function validate(schema) {
  return (req, res, next) => {
    const errors = [];
    for (const [field, rules] of Object.entries(schema)) {
      const value = req.body[field];

      if (rules.required && (value === undefined || value === null || value === "")) {
        errors.push(`${field} is required`);
        continue;
      }

      if (value === undefined || value === null) continue;

      if (rules.type === "string" && typeof value !== "string") {
        errors.push(`${field} must be a string`);
      }
      if (rules.type === "number" && typeof value !== "number" && isNaN(Number(value))) {
        errors.push(`${field} must be a number`);
      }
      if (rules.type === "integer") {
        const num = Number(value);
        if (isNaN(num) || !Number.isInteger(num)) {
          errors.push(`${field} must be an integer`);
        }
      }
      if (rules.type === "object" && typeof value !== "object") {
        errors.push(`${field} must be an object`);
      }
      if (rules.type === "array" && !Array.isArray(value)) {
        errors.push(`${field} must be an array`);
      }
      if (rules.min !== undefined && Number(value) < rules.min) {
        errors.push(`${field} must be >= ${rules.min}`);
      }
      if (rules.max !== undefined && Number(value) > rules.max) {
        errors.push(`${field} must be <= ${rules.max}`);
      }
      if (rules.minLength !== undefined && typeof value === "string" && value.length < rules.minLength) {
        errors.push(`${field} must be at least ${rules.minLength} characters`);
      }
      if (rules.maxLength !== undefined && typeof value === "string" && value.length > rules.maxLength) {
        errors.push(`${field} must be at most ${rules.maxLength} characters`);
      }
      if (rules.enum && !rules.enum.includes(value)) {
        errors.push(`${field} must be one of: ${rules.enum.join(", ")}`);
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({ error: "Validation failed", details: errors });
    }
    next();
  };
}

// Pre-defined schemas for common endpoints
const schemas = {
  registerAgent: {
    agentId: { required: true, type: "string", minLength: 1, maxLength: 100 },
    name: { required: true, type: "string", minLength: 1, maxLength: 200 },
    description: { type: "string", maxLength: 2000 },
    capabilities: { type: "array" },
    endpoint: { type: "string", maxLength: 500 },
  },
  createListing: {
    agentId: { required: true, type: "string" },
    capability: { required: true, type: "string", minLength: 1, maxLength: 100 },
    description: { type: "string", maxLength: 2000 },
    basePrice: { required: true, type: "number", min: 0 },
  },
  serviceRequest: {
    consumer: { required: true, type: "string" },
    provider: { required: true, type: "string" },
    capability: { required: true, type: "string", minLength: 1 },
    maxPrice: { required: true, type: "number", min: 0 },
  },
  makeOffer: {
    provider: { required: true, type: "string" },
    price: { required: true, type: "number", min: 0 },
    estimatedTimeMs: { type: "number", min: 0 },
  },
  deliver: {
    provider: { required: true, type: "string" },
    resultHash: { required: true, type: "string", minLength: 1 },
  },
  approve: {
    consumer: { required: true, type: "string" },
  },
  approveWithRating: {
    consumer: { required: true, type: "string" },
    consumerRating: { required: true, type: "integer", min: 1, max: 5 },
  },
  dispute: {
    consumer: { required: true, type: "string" },
    reason: { required: true, type: "string", minLength: 1, maxLength: 5000 },
  },
  escalate: {
    consumer: { required: true, type: "string" },
    arbiter: { required: true, type: "string" },
  },
  submitEvidence: {
    submitter: { required: true, type: "string" },
    newEvidence: { required: true, type: "string", minLength: 1, maxLength: 10000 },
  },
  splitRuling: {
    arbiter: { required: true, type: "string" },
    consumerAmount: { required: true, type: "number", min: 0 },
  },
  submitRating: {
    score: { required: true, type: "integer", min: 1, max: 5 },
  },
  transfer: {
    owner: { required: true, type: "string" },
    receiver: { required: true, type: "string" },
    amount: { required: true, type: "number", min: 0 },
  },
  split: {
    owner: { required: true, type: "string" },
    amount: { required: true, type: "number", min: 0 },
  },
  feeCollect: {
    treasury: { required: true, type: "string" },
  },
  webhookRegister: {
    url: { required: true, type: "string", minLength: 1 },
    events: { required: true, type: "array" },
  },
};

module.exports = { validate, schemas };
