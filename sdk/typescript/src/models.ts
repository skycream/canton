/**
 * Data models for the Canton Agent Protocol (CAP).
 */

// ---------------------------------------------------------------------------
// Request / Config types
// ---------------------------------------------------------------------------

export interface SLATerms {
  maxLatencyMs: number;
  penaltyRate: number;
}

export function defaultSLATerms(): SLATerms {
  return { maxLatencyMs: 30_000, penaltyRate: 0.0 };
}

/** Serialise SLA terms the way the CAP API expects (string values). */
export function slaTermsToDict(sla: SLATerms): Record<string, string> {
  return {
    maxLatencyMs: String(sla.maxLatencyMs),
    penaltyRate: String(sla.penaltyRate),
  };
}

// ---------------------------------------------------------------------------
// Domain objects
// ---------------------------------------------------------------------------

export interface AgentProfile {
  agentId: string;
  name: string;
  description: string;
  capabilities: string[];
  endpoint: string;
  contractId?: string;
}

export interface ServiceListing {
  provider: string;
  capability: string;
  description: string;
  basePrice: number;
  contractId?: string;
}

export interface ServiceRequest {
  consumer: string;
  provider: string;
  capability: string;
  params: Record<string, unknown>;
  maxPrice: number;
  slaTerms: SLATerms;
  contractId?: string;
}

export interface ServiceOffer {
  consumer: string;
  provider: string;
  capability: string;
  price: number;
  estimatedTimeMs: number;
  contractId?: string;
}

export interface Escrow {
  consumer: string;
  provider: string;
  amount: number;
  capability: string;
  status: string;
  contractId?: string;
}

export interface Coin {
  owner: string;
  amount: number;
  contractId: string;
}

// ---------------------------------------------------------------------------
// API response shapes
// ---------------------------------------------------------------------------

export interface DiscoverResponse {
  listings: Array<{
    provider: string;
    capability: string;
    description?: string;
    basePrice?: number | string;
    contractId?: string;
  }>;
}

export interface OffersResponse {
  offers: Array<{
    consumer: string;
    provider: string;
    capability?: string;
    price?: number | string;
    estimatedTimeMs?: number | string;
    contractId?: string;
  }>;
}

export interface WalletResponse {
  balance: number;
  coins: Array<{
    amount: number;
    contractId: string;
  }>;
}

export interface EscrowsResponse {
  escrows: Array<Record<string, unknown>>;
  pendingReviews: Array<Record<string, unknown>>;
  disputes?: Array<Record<string, unknown>>;
}

export interface RequestsResponse {
  requests: Array<{
    contractId: string;
    capability?: string;
    params?: string | Record<string, unknown>;
    maxPrice?: number | string;
    [key: string]: unknown;
  }>;
}

export interface RegisterResponse {
  contractId?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// High-level hire result
// ---------------------------------------------------------------------------

export interface HireResult {
  requestId: string;
  offer: ServiceOffer;
  escrow: Record<string, unknown>;
  review?: Record<string, unknown>;
  payment?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Options bags
// ---------------------------------------------------------------------------

export interface HireOptions {
  params?: Record<string, unknown>;
  maxPrice?: number;
  autoApprove?: boolean;
  pollInterval?: number;
  timeout?: number;
}

export interface ServeOptions {
  pollInterval?: number;
  background?: boolean;
}

export interface WebhookRegistration {
  agentId: string;
  url: string;
  events?: string[];
}
