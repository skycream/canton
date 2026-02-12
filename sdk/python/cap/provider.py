"""CAP Provider SDK - for agents that provide services to other agents."""
import hashlib
import json
import time
import threading
import urllib.request
import urllib.error
from typing import Callable, Optional
from cap.models import AgentProfile, SLATerms


class CAPProvider:
    """Provider SDK for agents that offer services on CAP."""

    def __init__(self, agent_id: str, cap_url: str = "http://localhost:4000"):
        self.agent_id = agent_id
        self.cap_url = cap_url.rstrip("/")
        self._handlers: dict[str, Callable] = {}
        self._running = False
        self._processed_requests: set[str] = set()
        self._processed_escrows: set[str] = set()

    def _request(self, method: str, path: str, data: dict = None) -> dict:
        url = f"{self.cap_url}{path}"
        body = json.dumps(data).encode() if data else None
        req = urllib.request.Request(
            url,
            data=body,
            method=method,
            headers={
                "Content-Type": "application/json",
                "X-CAP-Agent-Id": self.agent_id,
            },
        )
        try:
            with urllib.request.urlopen(req) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            error_body = e.read().decode() if e.fp else ""
            raise RuntimeError(f"CAP API error {e.code}: {error_body}")

    # --- Registration ---

    def register(self, name: str, description: str = "", capabilities: list = None, endpoint: str = "") -> AgentProfile:
        result = self._request("POST", "/cap/v1/agents", {
            "agentId": self.agent_id,
            "name": name,
            "description": description,
            "capabilities": capabilities or [],
            "endpoint": endpoint,
        })
        return AgentProfile(
            agent_id=self.agent_id,
            name=name,
            description=description,
            capabilities=capabilities or [],
            endpoint=endpoint,
            contract_id=result.get("contractId"),
        )

    def create_listing(self, capability: str, description: str = "", base_price: float = 0.0) -> dict:
        return self._request("POST", "/cap/v1/services/listings", {
            "agentId": self.agent_id,
            "capability": capability,
            "description": description,
            "basePrice": base_price,
        })

    # --- Service Handler Registration ---

    def on_request(self, capability: str):
        """Decorator to register a handler for service requests.

        Usage:
            @provider.on_request("translation")
            def handle_translation(params: dict) -> dict:
                return {"translated": translate(params["text"])}
        """
        def decorator(func: Callable):
            self._handlers[capability] = func
            return func
        return decorator

    # --- Offer & Deliver ---

    def make_offer(self, request_contract_id: str, price: float, estimated_time_ms: int = 5000) -> dict:
        return self._request("POST", f"/cap/v1/services/requests/{request_contract_id}/offer", {
            "provider": self.agent_id,
            "price": price,
            "estimatedTimeMs": estimated_time_ms,
        })

    def deliver(self, escrow_contract_id: str, result_hash: str, result_url: str = "") -> dict:
        return self._request("POST", f"/cap/v1/escrows/{escrow_contract_id}/deliver", {
            "provider": self.agent_id,
            "resultHash": result_hash,
            "resultUrl": result_url,
        })

    # --- Polling Loop ---

    def _poll_loop(self, poll_interval: float = 2.0):
        """Poll for incoming service requests and handle them."""
        while self._running:
            try:
                result = self._request("GET", f"/cap/v1/services/requests?as={self.agent_id}")
                requests = result.get("requests", [])

                for req in requests:
                    contract_id = req["contractId"]
                    if contract_id in self._processed_requests:
                        continue

                    capability = req.get("capability", "")
                    handler = self._handlers.get(capability)
                    if not handler:
                        continue

                    self._processed_requests.add(contract_id)

                    params = req.get("params", "{}")
                    if isinstance(params, str):
                        try:
                            params = json.loads(params)
                        except json.JSONDecodeError:
                            params = {"raw": params}

                    max_price = float(req.get("maxPrice", "1.0"))

                    # Make offer
                    print(f"  [{self.agent_id}] Received request for '{capability}', offering...")
                    try:
                        self.make_offer(contract_id, price=max_price * 0.5, estimated_time_ms=3000)
                    except Exception as e:
                        print(f"  [{self.agent_id}] Offer error: {e}")
                        continue

                # Check for escrows that need delivery
                escrows = self._request("GET", f"/cap/v1/escrows?as={self.agent_id}")
                active = escrows.get("escrows", [])

                for escrow in active:
                    escrow_id = escrow["contractId"]
                    if escrow_id in self._processed_escrows:
                        continue

                    capability = escrow.get("capability", "")
                    handler = self._handlers.get(capability)
                    if not handler:
                        continue

                    self._processed_escrows.add(escrow_id)

                    params = escrow.get("params", "{}")
                    if isinstance(params, str):
                        try:
                            params = json.loads(params)
                        except json.JSONDecodeError:
                            params = {"raw": params}

                    print(f"  [{self.agent_id}] Executing '{capability}'...")
                    try:
                        output = handler(params)
                        result_hash = "sha256:" + hashlib.sha256(json.dumps(output, sort_keys=True, default=str).encode()).hexdigest()
                        result_url = f"cap://results/{self.agent_id}/{result_hash}"

                        self.deliver(escrow_id, result_hash, result_url)
                        print(f"  [{self.agent_id}] Delivered result for '{capability}'")
                    except Exception as e:
                        print(f"  [{self.agent_id}] Handler error: {e}")

            except Exception as e:
                if self._running:
                    print(f"  [{self.agent_id}] Poll error: {e}")

            time.sleep(poll_interval)

    def serve(self, poll_interval: float = 2.0, background: bool = False):
        """Start serving requests.

        Args:
            poll_interval: Seconds between polling for new requests.
            background: If True, runs in a background thread.
        """
        self._running = True
        print(f"  [{self.agent_id}] Serving: {list(self._handlers.keys())}")

        if background:
            thread = threading.Thread(target=self._poll_loop, args=(poll_interval,), daemon=True)
            thread.start()
            return thread
        else:
            try:
                self._poll_loop(poll_interval)
            except KeyboardInterrupt:
                self.stop()

    def stop(self):
        """Stop serving."""
        self._running = False
        print(f"  [{self.agent_id}] Stopped.")
