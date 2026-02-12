"""LangChain Tool integrations for the CAP (Canton Agent Protocol).

Provides LangChain-compatible tools that allow LLM agents to interact with
the CAP protocol -- discovering providers, hiring agents, checking reputation,
and querying wallet balances.

Usage::

    from cap.langchain_tools import get_cap_tools

    tools = get_cap_tools(agent_id="consumer-1", cap_url="http://localhost:4000")
    # Pass `tools` to any LangChain agent or chain that accepts a list of tools.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional, Type

from langchain.tools import BaseTool
from pydantic import BaseModel, Field

from cap.client import CAPClient


# ---------------------------------------------------------------------------
# Pydantic input schemas (used by LangChain for argument validation)
# ---------------------------------------------------------------------------

class DiscoverInput(BaseModel):
    """Input schema for discovering CAP service providers."""

    capability: str = Field(
        ...,
        description="The capability to search for (e.g. 'translation', 'summarization', 'code-review').",
    )


class HireInput(BaseModel):
    """Input schema for hiring an agent through the CAP protocol."""

    provider: str = Field(
        ...,
        description="The agent ID of the provider to hire.",
    )
    capability: str = Field(
        ...,
        description="The capability being requested (e.g. 'translation').",
    )
    params: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Optional dictionary of task-specific parameters to send to the provider.",
    )
    max_price: float = Field(
        default=1.0,
        description="Maximum price willing to pay for the service.",
    )
    auto_approve: bool = Field(
        default=True,
        description="Whether to automatically approve the delivery once received.",
    )
    timeout: float = Field(
        default=60.0,
        description="Maximum seconds to wait for offer and delivery.",
    )


class CheckReputationInput(BaseModel):
    """Input schema for checking an agent's reputation."""

    target_agent_id: str = Field(
        ...,
        description="The agent ID whose reputation should be checked.",
    )


class GetBalanceInput(BaseModel):
    """Input schema for checking the wallet balance."""

    # No additional inputs required beyond the agent_id/cap_url baked into
    # the tool, but LangChain requires an input schema.  We accept an
    # optional placeholder so the model can call it with an empty object.
    _placeholder: Optional[str] = Field(
        default=None,
        description="No input required. Leave empty.",
    )


# ---------------------------------------------------------------------------
# Tool implementations
# ---------------------------------------------------------------------------

class CAPDiscoverTool(BaseTool):
    """Discover service providers registered on the CAP network by capability."""

    name: str = "cap_discover"
    description: str = (
        "Search the CAP (Canton Agent Protocol) network for service providers "
        "that offer a given capability.  Returns a list of matching providers "
        "with their agent ID, description, and base price."
    )
    args_schema: Type[BaseModel] = DiscoverInput

    cap_url: str = "http://localhost:4000"
    agent_id: str = ""

    def _run(self, capability: str, **kwargs: Any) -> str:
        client = CAPClient(agent_id=self.agent_id, cap_url=self.cap_url)
        listings = client.discover(capability)
        if not listings:
            return json.dumps({"providers": [], "message": f"No providers found for capability '{capability}'."})
        results = [
            {
                "provider": l.provider,
                "capability": l.capability,
                "description": l.description,
                "base_price": l.base_price,
                "contract_id": l.contract_id,
            }
            for l in listings
        ]
        return json.dumps({"providers": results})


class CAPHireTool(BaseTool):
    """Hire an agent through the full CAP flow: request, offer, accept, deliver, approve."""

    name: str = "cap_hire"
    description: str = (
        "Hire an agent on the CAP network.  This executes the full hiring flow: "
        "send a service request, wait for an offer, accept and escrow payment, "
        "wait for delivery, and optionally auto-approve.  Returns the result "
        "including the offer details, escrow info, and delivery review."
    )
    args_schema: Type[BaseModel] = HireInput

    cap_url: str = "http://localhost:4000"
    agent_id: str = ""

    def _run(
        self,
        provider: str,
        capability: str,
        params: Optional[Dict[str, Any]] = None,
        max_price: float = 1.0,
        auto_approve: bool = True,
        timeout: float = 60.0,
        **kwargs: Any,
    ) -> str:
        client = CAPClient(agent_id=self.agent_id, cap_url=self.cap_url)
        try:
            result = client.hire(
                provider=provider,
                capability=capability,
                params=params,
                max_price=max_price,
                auto_approve=auto_approve,
                timeout=timeout,
            )
            # Serialise dataclass objects that may appear in the result dict.
            serialisable = {}
            for key, value in result.items():
                if hasattr(value, "__dataclass_fields__"):
                    serialisable[key] = {
                        k: getattr(value, k)
                        for k in value.__dataclass_fields__
                    }
                else:
                    serialisable[key] = value
            return json.dumps(serialisable)
        except TimeoutError as exc:
            return json.dumps({"error": "timeout", "message": str(exc)})
        except ValueError as exc:
            return json.dumps({"error": "value_error", "message": str(exc)})
        except RuntimeError as exc:
            return json.dumps({"error": "api_error", "message": str(exc)})


class CAPCheckReputationTool(BaseTool):
    """Check an agent's reputation score and review history on the CAP network."""

    name: str = "cap_check_reputation"
    description: str = (
        "Look up the reputation of an agent on the CAP network.  Returns "
        "aggregated reputation data including average rating, total reviews, "
        "and recent comments."
    )
    args_schema: Type[BaseModel] = CheckReputationInput

    cap_url: str = "http://localhost:4000"
    agent_id: str = ""

    def _run(self, target_agent_id: str, **kwargs: Any) -> str:
        client = CAPClient(agent_id=self.agent_id, cap_url=self.cap_url)
        try:
            reputation = client.get_reputation(target_agent_id)
            return json.dumps(reputation)
        except RuntimeError as exc:
            return json.dumps({"error": "api_error", "message": str(exc)})


class CAPGetBalanceTool(BaseTool):
    """Check the current wallet balance on the CAP network."""

    name: str = "cap_get_balance"
    description: str = (
        "Retrieve the current CAP wallet balance for this agent.  Returns "
        "the available balance as a number."
    )
    args_schema: Type[BaseModel] = GetBalanceInput

    cap_url: str = "http://localhost:4000"
    agent_id: str = ""

    def _run(self, **kwargs: Any) -> str:
        client = CAPClient(agent_id=self.agent_id, cap_url=self.cap_url)
        try:
            balance = client.get_balance()
            return json.dumps({"agent_id": self.agent_id, "balance": balance})
        except RuntimeError as exc:
            return json.dumps({"error": "api_error", "message": str(exc)})


# ---------------------------------------------------------------------------
# Helper: instantiate all tools at once
# ---------------------------------------------------------------------------

def get_cap_tools(
    agent_id: str,
    cap_url: str = "http://localhost:4000",
) -> List[BaseTool]:
    """Return a list of all CAP LangChain tools pre-configured with credentials.

    Parameters
    ----------
    agent_id:
        The CAP agent ID that will act as the consumer in all tool calls.
    cap_url:
        Base URL of the CAP API server.

    Returns
    -------
    list[BaseTool]
        A list containing ``CAPDiscoverTool``, ``CAPHireTool``,
        ``CAPCheckReputationTool``, and ``CAPGetBalanceTool``.
    """
    common = {"agent_id": agent_id, "cap_url": cap_url}
    return [
        CAPDiscoverTool(**common),
        CAPHireTool(**common),
        CAPCheckReputationTool(**common),
        CAPGetBalanceTool(**common),
    ]
