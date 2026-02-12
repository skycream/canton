"""Async CAP Provider SDK - for agents that provide services to other agents."""
import asyncio
import hashlib
import inspect
import json
from typing import Callable, Optional, Union

import aiohttp

from cap.models import AgentProfile, SLATerms

# Default retry configuration
_MAX_RETRIES = 3
_BACKOFF_BASE = 1.0  # seconds; exponential: 1, 2, 4


class AsyncCAPProvider:
    """Async provider SDK for agents that offer services on CAP."""

    def __init__(self, agent_id: str, cap_url: str = "http://localhost:4000"):
        self.agent_id = agent_id
        self.cap_url = cap_url.rstrip("/")
        self._handlers: dict[str, Callable] = {}
        self._running = False
        self._processed_requests: set[str] = set()
        self._processed_escrows: set[str] = set()
        self._session: Optional[aiohttp.ClientSession] = None
        self._poll_task: Optional[asyncio.Task] = None

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
        """Close the underlying HTTP session and cancel the poll task."""
        self._running = False
        if self._poll_task and not self._poll_task.done():
            self._poll_task.cancel()
            try:
                await self._poll_task
            except asyncio.CancelledError:
                pass
            self._poll_task = None
        if self._session and not self._session.closed:
            await self._session.close()
            self._session = None

    async def __aenter__(self) -> "AsyncCAPProvider":
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

    # --- Registration ---

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

    async def create_listing(
        self,
        capability: str,
        description: str = "",
        base_price: float = 0.0,
    ) -> dict:
        return await self._request("POST", "/cap/v1/services/listings", {
            "agentId": self.agent_id,
            "capability": capability,
            "description": description,
            "basePrice": base_price,
        })

    # --- Service Handler Registration ---

    def on_request(self, capability: str):
        """Decorator to register a handler for service requests.

        Accepts both sync and async handler functions.

        Usage:
            @provider.on_request("translation")
            async def handle_translation(params: dict) -> dict:
                return {"translated": await translate(params["text"])}

            @provider.on_request("echo")
            def handle_echo(params: dict) -> dict:
                return {"echo": params["text"]}
        """
        def decorator(func: Callable) -> Callable:
            self._handlers[capability] = func
            return func
        return decorator

    async def _invoke_handler(self, handler: Callable, params: dict) -> dict:
        """Invoke a handler, supporting both sync and async callables."""
        if inspect.iscoroutinefunction(handler):
            return await handler(params)
        else:
            # Run sync handler in the default executor to avoid blocking
            loop = asyncio.get_running_loop()
            return await loop.run_in_executor(None, handler, params)

    # --- Offer & Deliver ---

    async def make_offer(
        self,
        request_contract_id: str,
        price: float,
        estimated_time_ms: int = 5000,
    ) -> dict:
        return await self._request(
            "POST",
            f"/cap/v1/services/requests/{request_contract_id}/offer",
            {
                "provider": self.agent_id,
                "price": price,
                "estimatedTimeMs": estimated_time_ms,
            },
        )

    async def deliver(
        self,
        escrow_contract_id: str,
        result_hash: str,
        result_url: str = "",
    ) -> dict:
        return await self._request(
            "POST",
            f"/cap/v1/escrows/{escrow_contract_id}/deliver",
            {
                "provider": self.agent_id,
                "resultHash": result_hash,
                "resultUrl": result_url,
            },
        )

    # --- Polling Loop ---

    async def _poll_loop(self, poll_interval: float = 2.0) -> None:
        """Poll for incoming service requests and handle them."""
        while self._running:
            try:
                result = await self._request(
                    "GET", f"/cap/v1/services/requests?as={self.agent_id}",
                )
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
                        await self.make_offer(
                            contract_id,
                            price=max_price * 0.5,
                            estimated_time_ms=3000,
                        )
                    except Exception as e:
                        print(f"  [{self.agent_id}] Offer error: {e}")
                        continue

                # Check for escrows that need delivery
                escrows = await self._request(
                    "GET", f"/cap/v1/escrows?as={self.agent_id}",
                )
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
                        output = await self._invoke_handler(handler, params)
                        result_hash = (
                            "sha256:"
                            + hashlib.sha256(
                                json.dumps(output, sort_keys=True, default=str).encode()
                            ).hexdigest()
                        )
                        result_url = f"cap://results/{self.agent_id}/{result_hash}"

                        await self.deliver(escrow_id, result_hash, result_url)
                        print(f"  [{self.agent_id}] Delivered result for '{capability}'")
                    except Exception as e:
                        print(f"  [{self.agent_id}] Handler error: {e}")

            except asyncio.CancelledError:
                break
            except Exception as e:
                if self._running:
                    print(f"  [{self.agent_id}] Poll error: {e}")

            await asyncio.sleep(poll_interval)

    async def serve(
        self,
        poll_interval: float = 2.0,
        background: bool = False,
    ) -> Optional[asyncio.Task]:
        """Start serving requests.

        Args:
            poll_interval: Seconds between polling for new requests.
            background: If True, runs as a background asyncio task.

        Returns:
            The background ``asyncio.Task`` when *background* is True,
            otherwise ``None`` (blocks until cancelled).
        """
        self._running = True
        print(f"  [{self.agent_id}] Serving: {list(self._handlers.keys())}")

        if background:
            self._poll_task = asyncio.create_task(
                self._poll_loop(poll_interval),
            )
            return self._poll_task
        else:
            try:
                await self._poll_loop(poll_interval)
            except asyncio.CancelledError:
                pass
            finally:
                await self.close()
            return None

    async def stop(self) -> None:
        """Stop serving and close resources."""
        self._running = False
        if self._poll_task and not self._poll_task.done():
            self._poll_task.cancel()
            try:
                await self._poll_task
            except asyncio.CancelledError:
                pass
            self._poll_task = None
        print(f"  [{self.agent_id}] Stopped.")
