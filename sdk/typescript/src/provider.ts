/**
 * CAP Provider SDK -- for agents that provide services to other agents.
 */

import { createHash } from "node:crypto";

import type {
  AgentProfile,
  EscrowsResponse,
  RegisterResponse,
  RequestsResponse,
  ServeOptions,
} from "./models.js";

/**
 * A handler function that receives request params and returns a result object.
 */
export type RequestHandler = (
  params: Record<string, unknown>,
) => Record<string, unknown> | Promise<Record<string, unknown>>;

export class CAPProvider {
  readonly agentId: string;
  readonly capUrl: string;

  private _handlers: Map<string, RequestHandler> = new Map();
  private _running = false;
  private _processedRequests: Set<string> = new Set();
  private _processedEscrows: Set<string> = new Set();
  private _pollTimer: NodeJS.Timeout | null = null;

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
  // Registration
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

  async createListing(
    capability: string,
    description: string = "",
    basePrice: number = 0.0,
  ): Promise<Record<string, unknown>> {
    return this._request("POST", "/cap/v1/services/listings", {
      agentId: this.agentId,
      capability,
      description,
      basePrice,
    });
  }

  // -------------------------------------------------------------------------
  // Service Handler Registration
  // -------------------------------------------------------------------------

  /**
   * Register a handler for incoming service requests of the given capability.
   *
   * This is the TypeScript equivalent of the Python decorator pattern. Usage:
   *
   * ```ts
   * provider.onRequest("translation", async (params) => {
   *   return { translated: translate(params.text as string) };
   * });
   * ```
   *
   * Returns the provider instance for chaining.
   */
  onRequest(capability: string, handler: RequestHandler): this {
    this._handlers.set(capability, handler);
    return this;
  }

  /**
   * Decorator-style handler registration (for use with experimental
   * decorators or as a higher-order function).
   *
   * ```ts
   * const handle = provider.handler("translation");
   * // `handle` is a decorator: (target) => target
   * ```
   */
  handler(capability: string): (fn: RequestHandler) => RequestHandler {
    return (fn: RequestHandler) => {
      this._handlers.set(capability, fn);
      return fn;
    };
  }

  // -------------------------------------------------------------------------
  // Offer & Deliver
  // -------------------------------------------------------------------------

  async makeOffer(
    requestContractId: string,
    price: number,
    estimatedTimeMs: number = 5000,
  ): Promise<Record<string, unknown>> {
    return this._request(
      "POST",
      `/cap/v1/services/requests/${requestContractId}/offer`,
      {
        provider: this.agentId,
        price,
        estimatedTimeMs,
      },
    );
  }

  async deliver(
    escrowContractId: string,
    resultHash: string,
    resultUrl: string = "",
  ): Promise<Record<string, unknown>> {
    return this._request("POST", `/cap/v1/escrows/${escrowContractId}/deliver`, {
      provider: this.agentId,
      resultHash,
      resultUrl,
    });
  }

  // -------------------------------------------------------------------------
  // Polling Loop
  // -------------------------------------------------------------------------

  private async _pollOnce(): Promise<void> {
    try {
      // --- Handle incoming service requests ---
      const reqResult = await this._request<RequestsResponse>(
        "GET",
        `/cap/v1/services/requests?as=${encodeURIComponent(this.agentId)}`,
      );
      const requests = reqResult.requests ?? [];

      for (const req of requests) {
        const contractId = req.contractId;
        if (this._processedRequests.has(contractId)) {
          continue;
        }

        const capability = req.capability ?? "";
        const handlerFn = this._handlers.get(capability);
        if (!handlerFn) {
          continue;
        }

        this._processedRequests.add(contractId);

        const maxPrice = Number(req.maxPrice ?? 1.0);

        console.log(`  [${this.agentId}] Received request for '${capability}', offering...`);
        try {
          await this.makeOffer(contractId, maxPrice * 0.5, 3000);
        } catch (err) {
          console.error(`  [${this.agentId}] Offer error:`, err);
          continue;
        }
      }

      // --- Handle escrows that need delivery ---
      const escrowResult = await this._request<EscrowsResponse>(
        "GET",
        `/cap/v1/escrows?as=${encodeURIComponent(this.agentId)}`,
      );
      const escrows = escrowResult.escrows ?? [];

      for (const escrow of escrows) {
        const escrowRecord = escrow as Record<string, unknown>;
        const escrowId = escrowRecord.contractId as string;
        if (this._processedEscrows.has(escrowId)) {
          continue;
        }

        const capability = (escrowRecord.capability ?? "") as string;
        const handlerFn = this._handlers.get(capability);
        if (!handlerFn) {
          continue;
        }

        this._processedEscrows.add(escrowId);

        let params = escrowRecord.params;
        if (typeof params === "string") {
          try {
            params = JSON.parse(params);
          } catch {
            params = { raw: params };
          }
        }
        if (params === undefined || params === null) {
          params = {};
        }

        console.log(`  [${this.agentId}] Executing '${capability}'...`);
        try {
          const output = await Promise.resolve(
            handlerFn(params as Record<string, unknown>),
          );
          const serialized = JSON.stringify(output, Object.keys(output).sort());
          const resultHash = "sha256:" + this._sha256(serialized);
          const resultUrl = `cap://results/${this.agentId}/${resultHash}`;

          await this.deliver(escrowId, resultHash, resultUrl);
          console.log(`  [${this.agentId}] Delivered result for '${capability}'`);
        } catch (err) {
          console.error(`  [${this.agentId}] Handler error:`, err);
        }
      }
    } catch (err) {
      if (this._running) {
        console.error(`  [${this.agentId}] Poll error:`, err);
      }
    }
  }

  private async _pollLoop(pollInterval: number): Promise<void> {
    while (this._running) {
      await this._pollOnce();
      await this._sleep(pollInterval * 1000);
    }
  }

  // -------------------------------------------------------------------------
  // Serve
  // -------------------------------------------------------------------------

  /**
   * Start serving requests.
   *
   * @param options.pollInterval - Seconds between polls (default 2).
   * @param options.background   - If true, poll in the background and return
   *                               an AbortController you can use to stop.
   */
  serve(options: ServeOptions = {}): AbortController | Promise<void> {
    const { pollInterval = 2.0, background = false } = options;

    this._running = true;
    const capabilities = Array.from(this._handlers.keys());
    console.log(`  [${this.agentId}] Serving: ${JSON.stringify(capabilities)}`);

    if (background) {
      const controller = new AbortController();

      // Start polling in the background -- we intentionally do not await.
      const loop = (async () => {
        try {
          await this._pollLoop(pollInterval);
        } catch {
          // stopped
        }
      })();

      // When the caller aborts, stop the provider.
      controller.signal.addEventListener("abort", () => {
        this.stop();
      });

      // Keep a reference so callers can await if they want.
      (controller as unknown as Record<string, unknown>).__loop = loop;

      return controller;
    }

    // Foreground: return the promise (run until stop() is called).
    return this._pollLoop(pollInterval);
  }

  /** Stop serving. */
  stop(): void {
    this._running = false;
    if (this._pollTimer) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
    console.log(`  [${this.agentId}] Stopped.`);
  }

  /** Whether the provider is currently running its poll loop. */
  get running(): boolean {
    return this._running;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Compute a hex-encoded SHA-256 hash of the given string. */
  private _sha256(input: string): string {
    return createHash("sha256").update(input).digest("hex");
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this._pollTimer = setTimeout(resolve, ms);
    });
  }
}
