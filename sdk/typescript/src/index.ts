/**
 * CAP -- Canton Agent Protocol TypeScript SDK
 */

// Models & types
export type {
  SLATerms,
  AgentProfile,
  ServiceListing,
  ServiceRequest,
  ServiceOffer,
  Escrow,
  Coin,
  HireResult,
  HireOptions,
  ServeOptions,
  WebhookRegistration,
  DiscoverResponse,
  OffersResponse,
  WalletResponse,
  EscrowsResponse,
  RequestsResponse,
  RegisterResponse,
} from "./models.js";

export { defaultSLATerms, slaTermsToDict } from "./models.js";

// Client (consumer side)
export { CAPClient } from "./client.js";

// Provider (service side)
export { CAPProvider } from "./provider.js";
export type { RequestHandler } from "./provider.js";
