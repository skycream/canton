"""Async CAP Client SDK - for consumer agents that hire other agents."""
import asyncio
import json
from typing import Optional

import aiohttp

from cap.models import (
    AgentProfile, ServiceListing, ServiceRequest,
    ServiceOffer, Escrow, Coin, SLATerms,
)

# Default retry configuration
_MAX_RETRIES = 3
_BACKOFF_BASE = 1.0  # seconds; exponential: 1, 2, 4


class AsyncCAPClient:
    """Async client for consumer agents to interact with CAP protocol."""

    def __init__(self, agent_id: str, cap_url: str = "http://localhost:4000"):
        self.agent_id = agent_id
        self.cap_url = cap_url.rstrip("/")
        self._session: Optional[aiohttp.ClientSession] = None

    async def _get_session(self) -> aiohttp.ClientSession:
        """Lazily create and return the aiohttp session."""
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(
                headers={
                    "Content-Type": "application/json",
                    "X-CAP-Agent-Id": self.agent_id,
                },
            )
        return self._session

    async def close(self) -> None:
        """Close the underlying HTTP session."""
        if self._session and not self._session.closed:
            await self._session.close()
            self._session = None

    async def __aenter__(self) -> "AsyncCAPClient":
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        await self.close()

    async def _request(self, method: str, path: str, data: dict = None) -> dict:
        """Make an HTTP request with retry logic (3 attempts, exponential backoff)."""
        url = f"{self.cap_url}{path}"
        session = await self._get_session()

        last_error: Optional[Exception] = None
        for attempt in range(_MAX_RETRIES):
            try:
                kwargs: dict = {"method": method, "url": url}
                if data is not None:
                    kwargs["json"] = data

                async with session.request(**kwargs) as resp:
                    body = await resp.text()
                    if resp.status >= 400:
                        raise RuntimeError(f"CAP API error {resp.status}: {body}")
                    return json.loads(body)

            except (aiohttp.ClientError, asyncio.TimeoutError, RuntimeError) as e:
                last_error = e
                if attempt < _MAX_RETRIES - 1:
                    wait = _BACKOFF_BASE * (2 ** attempt)
                    await asyncio.sleep(wait)

        raise last_error  # type: ignore[misc]

    # --- Agent Registration ---

    async def register(
        self,
        name: str,
        description: str = "",
        capabilities: list = None,
        endpoint: str = "",
    ) -> AgentProfile:
        result = await self._request("POST", "/cap/v1/agents", {
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

    async def discover(self, capability: str) -> list[ServiceListing]:
        result = await self._request(
            "GET",
            f"/cap/v1/services/discover?capability={capability}&as={self.agent_id}",
        )
        return [
            ServiceListing(
                provider=listing["provider"],
                capability=listing["capability"],
                description=listing.get("description", ""),
                base_price=float(listing.get("basePrice", 0)),
                contract_id=listing.get("contractId"),
            )
            for listing in result.get("listings", [])
        ]

    # --- Wallet ---

    async def get_balance(self) -> float:
        result = await self._request("GET", f"/cap/v1/wallet?as={self.agent_id}")
        return result.get("balance", 0)

    async def get_coins(self) -> list[Coin]:
        result = await self._request("GET", f"/cap/v1/wallet?as={self.agent_id}")
        return [
            Coin(
                owner=self.agent_id,
                amount=c["amount"],
                contract_id=c["contractId"],
            )
            for c in result.get("coins", [])
        ]

    # --- Service Request Flow ---

    async def request_service(
        self,
        provider: str,
        capability: str,
        params: dict = None,
        max_price: float = 1.0,
        sla: SLATerms = None,
    ) -> str:
        """Create a service request. Returns contractId."""
        sla = sla or SLATerms()
        result = await self._request("POST", "/cap/v1/services/requests", {
            "consumer": self.agent_id,
            "provider": provider,
            "capability": capability,
            "params": params or {},
            "maxPrice": max_price,
            "slaTerms": sla.to_dict(),
        })
        return result.get("contractId", "")

    async def get_offers(self) -> list[ServiceOffer]:
        """Get offers made to this consumer."""
        result = await self._request(
            "GET", f"/cap/v1/services/offers?as={self.agent_id}",
        )
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

    async def accept_offer(self, offer_contract_id: str, payment_cid: str) -> dict:
        """Accept an offer and create an escrow."""
        return await self._request(
            "POST",
            f"/cap/v1/services/offers/{offer_contract_id}/accept",
            {
                "consumer": self.agent_id,
                "paymentCid": payment_cid,
            },
        )

    # --- Escrow ---

    async def get_escrows(self) -> dict:
        """Get all escrows, pending reviews, and disputes."""
        return await self._request("GET", f"/cap/v1/escrows?as={self.agent_id}")

    async def approve(self, review_contract_id: str) -> dict:
        """Quick approve a delivery."""
        return await self._request(
            "POST",
            f"/cap/v1/escrows/{review_contract_id}/approve",
            {"consumer": self.agent_id},
        )

    async def approve_with_rating(
        self,
        review_contract_id: str,
        rating: int = 5,
        comment: str = "",
    ) -> dict:
        """Approve delivery and rate the provider."""
        return await self._request(
            "POST",
            f"/cap/v1/escrows/{review_contract_id}/approve-with-rating",
            {
                "consumer": self.agent_id,
                "consumerRating": rating,
                "consumerComment": comment,
            },
        )

    async def dispute(self, review_contract_id: str, reason: str) -> dict:
        """Dispute a delivery."""
        return await self._request(
            "POST",
            f"/cap/v1/escrows/{review_contract_id}/dispute",
            {
                "consumer": self.agent_id,
                "reason": reason,
            },
        )

    # --- Reputation ---

    async def get_reputation(self, agent_id: str) -> dict:
        """Get aggregated reputation for an agent."""
        return await self._request("GET", f"/cap/v1/reputation/{agent_id}")

    # --- High-level: Hire an agent ---

    async def hire(
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
        High-level: request service, wait for offer, accept, wait for delivery,
        optionally approve.

        Returns dict with keys: offer, escrow, review, payment (if auto_approve).
        """
        result: dict = {}

        # 1. Request service
        request_id = await self.request_service(provider, capability, params, max_price)
        result["requestId"] = request_id

        # 2. Wait for offer
        offer: Optional[ServiceOffer] = None
        elapsed = 0.0
        while elapsed < timeout:
            offers = await self.get_offers()
            matching = [
                o for o in offers
                if o.provider == provider and o.capability == capability
            ]
            if matching:
                offer = matching[0]
                break
            await asyncio.sleep(poll_interval)
            elapsed += poll_interval

        if not offer:
            raise TimeoutError(f"No offer received from {provider} within {timeout}s")
        result["offer"] = offer

        # 3. Find a coin to pay
        coins = await self.get_coins()
        if not coins:
            raise ValueError("No coins available for payment")
        payment_coin = max(coins, key=lambda c: c.amount)
        if payment_coin.amount < offer.price:
            raise ValueError(
                f"Insufficient funds: have {payment_coin.amount}, need {offer.price}"
            )

        # 4. Accept offer
        accept_result = await self.accept_offer(
            offer.contract_id, payment_coin.contract_id,
        )
        result["escrow"] = accept_result

        # 5. Wait for delivery
        review = None
        elapsed = 0.0
        while elapsed < timeout:
            escrow_data = await self.get_escrows()
            reviews = escrow_data.get("pendingReviews", [])
            matching_reviews = [r for r in reviews if r.get("provider") == provider]
            if matching_reviews:
                review = matching_reviews[0]
                break
            await asyncio.sleep(poll_interval)
            elapsed += poll_interval

        if not review:
            raise TimeoutError(f"No delivery from {provider} within {timeout}s")
        result["review"] = review

        # 6. Auto-approve if requested
        if auto_approve:
            payment = await self.approve(review["contractId"])
            result["payment"] = payment

        return result
