/**
 * CAP Client SDK -- for consumer agents that hire other agents.
 */

import type {
  AgentProfile,
  Coin,
  DiscoverResponse,
  EscrowsResponse,
  HireOptions,
  HireResult,
  OffersResponse,
  RegisterResponse,
  SLATerms,
  ServiceListing,
  ServiceOffer,
  WalletResponse,
  WebhookRegistration,
} from "./models.js";

import { defaultSLATerms, slaTermsToDict } from "./models.js";

export class CAPClient {
  readonly agentId: string;
  readonly capUrl: string;

  constructor(agentId: string, capUrl: string = "http://localhost:4000") {
    this.agentId = agentId;
    this.capUrl = capUrl.replace(/\/+$/, "");
  }

  // -------------------------------------------------------------------------
  // Internal HTTP helper
  // -------------------------------------------------------------------------

  private async _request<T = Record<string, unknown>>(
    method: string,
    path: string,
    data?: Record<string, unknown>,
  ): Promise<T> {
    const url = `${this.capUrl}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-CAP-Agent-Id": this.agentId,
    };
    const init: { method: string; headers: Record<string, string>; body?: string } = {
      method,
      headers,
    };
    if (data !== undefined) {
      init.body = JSON.stringify(data);
    }

    const resp = await fetch(url, init);
    const body = await resp.text();

    if (!resp.ok) {
      throw new Error(`CAP API error ${resp.status}: ${body}`);
    }

    return body ? (JSON.parse(body) as T) : ({} as T);
  }

  // -------------------------------------------------------------------------
  // Agent Registration
  // -------------------------------------------------------------------------

  async register(
    name: string,
    description: string = "",
    capabilities: string[] = [],
    endpoint: string = "",
  ): Promise<AgentProfile> {
    const result = await this._request<RegisterResponse>("POST", "/cap/v1/agents", {
      agentId: this.agentId,
      name,
      description,
      capabilities,
      endpoint,
    });
    return {
      agentId: this.agentId,
      name,
      description,
      capabilities,
      endpoint,
      contractId: result.contractId,
    };
  }

  // -------------------------------------------------------------------------
  // Discovery
  // -------------------------------------------------------------------------

  async discover(capability: string): Promise<ServiceListing[]> {
    const result = await this._request<DiscoverResponse>(
      "GET",
      `/cap/v1/services/discover?capability=${encodeURIComponent(capability)}&as=${encodeURIComponent(this.agentId)}`,
    );
    return (result.listings ?? []).map((l) => ({
      provider: l.provider,
      capability: l.capability,
      description: l.description ?? "",
      basePrice: Number(l.basePrice ?? 0),
      contractId: l.contractId,
    }));
  }

  // -------------------------------------------------------------------------
  // Wallet
  // -------------------------------------------------------------------------

  async getBalance(): Promise<number> {
    const result = await this._request<WalletResponse>(
      "GET",
      `/cap/v1/wallet?as=${encodeURIComponent(this.agentId)}`,
    );
    return result.balance ?? 0;
  }

  async getCoins(): Promise<Coin[]> {
    const result = await this._request<WalletResponse>(
      "GET",
      `/cap/v1/wallet?as=${encodeURIComponent(this.agentId)}`,
    );
    return (result.coins ?? []).map((c) => ({
      owner: this.agentId,
      amount: c.amount,
      contractId: c.contractId,
    }));
  }

  // -------------------------------------------------------------------------
  // Service Request Flow
  // -------------------------------------------------------------------------

  /** Create a service request. Returns the contractId. */
  async requestService(
    provider: string,
    capability: string,
    params: Record<string, unknown> = {},
    maxPrice: number = 1.0,
    sla?: SLATerms,
  ): Promise<string> {
    const slaTerms = sla ?? defaultSLATerms();
    const result = await this._request<{ contractId?: string }>(
      "POST",
      "/cap/v1/services/requests",
      {
        consumer: this.agentId,
        provider,
        capability,
        params,
        maxPrice,
        slaTerms: slaTermsToDict(slaTerms),
      },
    );
    return result.contractId ?? "";
  }

  /** Get offers made to this consumer. */
  async getOffers(): Promise<ServiceOffer[]> {
    const result = await this._request<OffersResponse>(
      "GET",
      `/cap/v1/services/offers?as=${encodeURIComponent(this.agentId)}`,
    );
    return (result.offers ?? []).map((o) => ({
      consumer: o.consumer,
      provider: o.provider,
      capability: o.capability ?? "",
      price: Number(o.price ?? 0),
      estimatedTimeMs: Number(o.estimatedTimeMs ?? 0),
      contractId: o.contractId,
    }));
  }

  /** Accept an offer and create an escrow. */
  async acceptOffer(
    offerContractId: string,
    paymentCid: string,
  ): Promise<Record<string, unknown>> {
    return this._request("POST", `/cap/v1/services/offers/${offerContractId}/accept`, {
      consumer: this.agentId,
      paymentCid,
    });
  }

  // -------------------------------------------------------------------------
  // Escrow
  // -------------------------------------------------------------------------

  /** Get all escrows, pending reviews, and disputes. */
  async getEscrows(): Promise<EscrowsResponse> {
    return this._request<EscrowsResponse>(
      "GET",
      `/cap/v1/escrows?as=${encodeURIComponent(this.agentId)}`,
    );
  }

  /** Quick-approve a delivery. */
  async approve(reviewContractId: string): Promise<Record<string, unknown>> {
    return this._request("POST", `/cap/v1/escrows/${reviewContractId}/approve`, {
      consumer: this.agentId,
    });
  }

  /** Approve a delivery and rate the provider. */
  async approveWithRating(
    reviewContractId: string,
    rating: number = 5,
    comment: string = "",
  ): Promise<Record<string, unknown>> {
    return this._request(
      "POST",
      `/cap/v1/escrows/${reviewContractId}/approve-with-rating`,
      {
        consumer: this.agentId,
        consumerRating: rating,
        consumerComment: comment,
      },
    );
  }

  /** Dispute a delivery. */
  async dispute(
    reviewContractId: string,
    reason: string,
  ): Promise<Record<string, unknown>> {
    return this._request("POST", `/cap/v1/escrows/${reviewContractId}/dispute`, {
      consumer: this.agentId,
      reason,
    });
  }

  // -------------------------------------------------------------------------
  // Reputation
  // -------------------------------------------------------------------------

  /** Get aggregated reputation for an agent. */
  async getReputation(agentId: string): Promise<Record<string, unknown>> {
    return this._request("GET", `/cap/v1/reputation/${encodeURIComponent(agentId)}`);
  }

  // -------------------------------------------------------------------------
  // Webhooks
  // -------------------------------------------------------------------------

  /** Register a webhook for event notifications. */
  async registerWebhook(
    url: string,
    events: string[] = [],
  ): Promise<Record<string, unknown>> {
    const payload: WebhookRegistration = {
      agentId: this.agentId,
      url,
      events,
    };
    return this._request(
      "POST",
      "/cap/v1/webhooks",
      payload as unknown as Record<string, unknown>,
    );
  }

  // -------------------------------------------------------------------------
  // High-level: Hire an agent
  // -------------------------------------------------------------------------

  /**
   * High-level workflow: request service, wait for offer, accept, wait for
   * delivery, and optionally approve.
   *
   * Returns an object with keys: requestId, offer, escrow, review, payment.
   */
  async hire(
    provider: string,
    capability: string,
    options: HireOptions = {},
  ): Promise<HireResult> {
    const {
      params = {},
      maxPrice = 1.0,
      autoApprove = false,
      pollInterval = 1.0,
      timeout = 60.0,
    } = options;

    // 1. Request service
    const requestId = await this.requestService(provider, capability, params, maxPrice);

    // 2. Wait for offer
    const offer = await this._pollUntil<ServiceOffer>(
      async () => {
        const offers = await this.getOffers();
        const matching = offers.find(
          (o) => o.provider === provider && o.capability === capability,
        );
        return matching ?? null;
      },
      pollInterval,
      timeout,
      `No offer received from ${provider} within ${timeout}s`,
    );

    // 3. Find a coin to pay
    const coins = await this.getCoins();
    if (coins.length === 0) {
      throw new Error("No coins available for payment");
    }
    const paymentCoin = coins.reduce((best, c) => (c.amount > best.amount ? c : best));
    if (paymentCoin.amount < offer.price) {
      throw new Error(
        `Insufficient funds: have ${paymentCoin.amount}, need ${offer.price}`,
      );
    }

    // 4. Accept offer
    const escrow = await this.acceptOffer(offer.contractId!, paymentCoin.contractId);

    // 5. Wait for delivery
    const review = await this._pollUntil<Record<string, unknown>>(
      async () => {
        const escrowData = await this.getEscrows();
        const reviews = escrowData.pendingReviews ?? [];
        const matching = reviews.find(
          (r) => (r as Record<string, unknown>).provider === provider,
        );
        return (matching as Record<string, unknown>) ?? null;
      },
      pollInterval,
      timeout,
      `No delivery from ${provider} within ${timeout}s`,
    );

    const result: HireResult = {
      requestId,
      offer,
      escrow,
      review,
    };

    // 6. Auto-approve if requested
    if (autoApprove && review) {
      const contractId = review.contractId as string;
      result.payment = await this.approve(contractId);
    }

    return result;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Poll an async function until it returns a non-null value, or time out. */
  private async _pollUntil<T>(
    fn: () => Promise<T | null>,
    intervalSec: number,
    timeoutSec: number,
    timeoutMessage: string,
  ): Promise<T> {
    const deadline = Date.now() + timeoutSec * 1000;
    while (Date.now() < deadline) {
      const value = await fn();
      if (value !== null) {
        return value;
      }
      await this._sleep(intervalSec * 1000);
    }
    throw new Error(timeoutMessage);
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
