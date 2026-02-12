"""CAP Client SDK - for consumer agents that hire other agents."""
import json
import time
import urllib.request
import urllib.error
from typing import Optional
from cap.models import (
    AgentProfile, ServiceListing, ServiceRequest,
    ServiceOffer, Escrow, Coin, SLATerms,
)


class CAPClient:
    """Client for consumer agents to interact with CAP protocol."""

    def __init__(self, agent_id: str, cap_url: str = "http://localhost:4000"):
        self.agent_id = agent_id
        self.cap_url = cap_url.rstrip("/")

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

    # --- Agent Registration ---

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

    # --- Discovery ---

    def discover(self, capability: str) -> list[ServiceListing]:
        result = self._request("GET", f"/cap/v1/services/discover?capability={capability}&as={self.agent_id}")
        return [
            ServiceListing(
                provider=l["provider"],
                capability=l["capability"],
                description=l.get("description", ""),
                base_price=float(l.get("basePrice", 0)),
                contract_id=l.get("contractId"),
            )
            for l in result.get("listings", [])
        ]

    # --- Wallet ---

    def get_balance(self) -> float:
        result = self._request("GET", f"/cap/v1/wallet?as={self.agent_id}")
        return result.get("balance", 0)

    def get_coins(self) -> list[Coin]:
        result = self._request("GET", f"/cap/v1/wallet?as={self.agent_id}")
        return [
            Coin(owner=self.agent_id, amount=c["amount"], contract_id=c["contractId"])
            for c in result.get("coins", [])
        ]

    # --- Service Request Flow ---

    def request_service(
        self,
        provider: str,
        capability: str,
        params: dict = None,
        max_price: float = 1.0,
        sla: SLATerms = None,
    ) -> str:
        """Create a service request. Returns contractId."""
        sla = sla or SLATerms()
        result = self._request("POST", "/cap/v1/services/requests", {
            "consumer": self.agent_id,
            "provider": provider,
            "capability": capability,
            "params": params or {},
            "maxPrice": max_price,
            "slaTerms": sla.to_dict(),
        })
        return result.get("contractId", "")

    def get_offers(self) -> list[ServiceOffer]:
        """Get offers made to this consumer."""
        result = self._request("GET", f"/cap/v1/services/offers?as={self.agent_id}")
        return [
            ServiceOffer(
                consumer=o["consumer"],
                provider=o["provider"],
                capability=o.get("capability", ""),
                price=float(o.get("price", 0)),
                estimated_time_ms=int(o.get("estimatedTimeMs", 0)),
                contract_id=o.get("contractId"),
            )
            for o in result.get("offers", [])
        ]

    def accept_offer(self, offer_contract_id: str, payment_cid: str) -> dict:
        """Accept an offer and create an escrow."""
        return self._request("POST", f"/cap/v1/services/offers/{offer_contract_id}/accept", {
            "consumer": self.agent_id,
            "paymentCid": payment_cid,
        })

    # --- Escrow ---

    def get_escrows(self) -> dict:
        """Get all escrows, pending reviews, and disputes."""
        return self._request("GET", f"/cap/v1/escrows?as={self.agent_id}")

    def approve(self, review_contract_id: str) -> dict:
        """Quick approve a delivery."""
        return self._request("POST", f"/cap/v1/escrows/{review_contract_id}/approve", {
            "consumer": self.agent_id,
        })

    def approve_with_rating(
        self,
        review_contract_id: str,
        rating: int = 5,
        comment: str = "",
    ) -> dict:
        """Approve delivery and rate the provider."""
        return self._request("POST", f"/cap/v1/escrows/{review_contract_id}/approve-with-rating", {
            "consumer": self.agent_id,
            "consumerRating": rating,
            "consumerComment": comment,
        })

    def dispute(self, review_contract_id: str, reason: str) -> dict:
        """Dispute a delivery."""
        return self._request("POST", f"/cap/v1/escrows/{review_contract_id}/dispute", {
            "consumer": self.agent_id,
            "reason": reason,
        })

    # --- Reputation ---

    def get_reputation(self, agent_id: str) -> dict:
        """Get aggregated reputation for an agent."""
        return self._request("GET", f"/cap/v1/reputation/{agent_id}")

    # --- High-level: Hire an agent ---

    def hire(
        self,
        provider: str,
        capability: str,
        params: dict = None,
        max_price: float = 1.0,
        auto_approve: bool = False,
        poll_interval: float = 1.0,
        timeout: float = 60.0,
    ) -> dict:
        """
        High-level: request service, wait for offer, accept, wait for delivery, optionally approve.

        Returns dict with keys: offer, escrow, review, payment (if auto_approve).
        """
        result = {}

        # 1. Request service
        request_id = self.request_service(provider, capability, params, max_price)
        result["requestId"] = request_id

        # 2. Wait for offer
        start = time.time()
        offer = None
        while time.time() - start < timeout:
            offers = self.get_offers()
            matching = [o for o in offers if o.provider == provider and o.capability == capability]
            if matching:
                offer = matching[0]
                break
            time.sleep(poll_interval)

        if not offer:
            raise TimeoutError(f"No offer received from {provider} within {timeout}s")
        result["offer"] = offer

        # 3. Find a coin to pay
        coins = self.get_coins()
        if not coins:
            raise ValueError("No coins available for payment")
        payment_coin = max(coins, key=lambda c: c.amount)
        if payment_coin.amount < offer.price:
            raise ValueError(f"Insufficient funds: have {payment_coin.amount}, need {offer.price}")

        # 4. Accept offer
        accept_result = self.accept_offer(offer.contract_id, payment_coin.contract_id)
        result["escrow"] = accept_result

        # 5. Wait for delivery
        start = time.time()
        review = None
        while time.time() - start < timeout:
            escrow_data = self.get_escrows()
            reviews = escrow_data.get("pendingReviews", [])
            matching_reviews = [r for r in reviews if r.get("provider") == provider]
            if matching_reviews:
                review = matching_reviews[0]
                break
            time.sleep(poll_interval)

        if not review:
            raise TimeoutError(f"No delivery from {provider} within {timeout}s")
        result["review"] = review

        # 6. Auto-approve if requested
        if auto_approve:
            payment = self.approve(review["contractId"])
            result["payment"] = payment

        return result
