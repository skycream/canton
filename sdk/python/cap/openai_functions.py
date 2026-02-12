"""OpenAI Function Calling integration for the CAP (Canton Agent Protocol).

Provides function schemas compatible with OpenAI's ``functions`` parameter and
a dispatcher that executes the corresponding CAP client operations.

Usage::

    import openai
    from cap.openai_functions import CAP_FUNCTIONS, handle_cap_function_call

    response = openai.ChatCompletion.create(
        model="gpt-4",
        messages=messages,
        functions=CAP_FUNCTIONS,
        function_call="auto",
    )

    msg = response.choices[0].message
    if msg.get("function_call"):
        result = handle_cap_function_call(
            name=msg["function_call"]["name"],
            arguments=msg["function_call"]["arguments"],
            agent_id="consumer-1",
            cap_url="http://localhost:4000",
        )
"""

from __future__ import annotations

import json
from typing import Any, Dict

from cap.client import CAPClient


# ---------------------------------------------------------------------------
# Function schemas (OpenAI function-calling format)
# ---------------------------------------------------------------------------

CAP_FUNCTIONS: list[Dict[str, Any]] = [
    {
        "name": "discover_providers",
        "description": (
            "Search the CAP (Canton Agent Protocol) network for service "
            "providers that offer a given capability.  Returns a list of "
            "matching providers with their agent ID, description, and base "
            "price."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "capability": {
                    "type": "string",
                    "description": (
                        "The capability to search for (e.g. 'translation', "
                        "'summarization', 'code-review')."
                    ),
                },
            },
            "required": ["capability"],
        },
    },
    {
        "name": "hire_agent",
        "description": (
            "Hire an agent on the CAP network.  Executes the full hiring "
            "flow: send a service request, wait for an offer from the "
            "provider, accept the offer and escrow payment, wait for "
            "delivery, and optionally auto-approve the result."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "provider": {
                    "type": "string",
                    "description": "The agent ID of the provider to hire.",
                },
                "capability": {
                    "type": "string",
                    "description": "The capability being requested (e.g. 'translation').",
                },
                "params": {
                    "type": "object",
                    "description": (
                        "Optional dictionary of task-specific parameters to "
                        "send to the provider."
                    ),
                },
                "max_price": {
                    "type": "number",
                    "description": "Maximum price willing to pay for the service.",
                    "default": 1.0,
                },
                "auto_approve": {
                    "type": "boolean",
                    "description": "Whether to automatically approve the delivery once received.",
                    "default": True,
                },
                "timeout": {
                    "type": "number",
                    "description": "Maximum seconds to wait for offer and delivery.",
                    "default": 60.0,
                },
            },
            "required": ["provider", "capability"],
        },
    },
    {
        "name": "check_reputation",
        "description": (
            "Look up the reputation of an agent on the CAP network.  Returns "
            "aggregated reputation data including average rating, total "
            "reviews, and recent comments."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "target_agent_id": {
                    "type": "string",
                    "description": "The agent ID whose reputation should be checked.",
                },
            },
            "required": ["target_agent_id"],
        },
    },
    {
        "name": "get_balance",
        "description": (
            "Retrieve the current CAP wallet balance for this agent.  "
            "Returns the available balance as a number."
        ),
        "parameters": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    {
        "name": "get_escrows",
        "description": (
            "Retrieve all escrows, pending delivery reviews, and active "
            "disputes for this agent.  Useful for checking the status of "
            "ongoing service engagements."
        ),
        "parameters": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    {
        "name": "dispute_delivery",
        "description": (
            "Dispute a delivery from a provider.  This initiates a dispute "
            "process on an escrow that is pending review, providing a reason "
            "for the dispute."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "review_contract_id": {
                    "type": "string",
                    "description": (
                        "The contract ID of the pending review / escrow to dispute."
                    ),
                },
                "reason": {
                    "type": "string",
                    "description": "The reason for disputing the delivery.",
                },
            },
            "required": ["review_contract_id", "reason"],
        },
    },
]


# ---------------------------------------------------------------------------
# Dispatcher
# ---------------------------------------------------------------------------

def handle_cap_function_call(
    name: str,
    arguments: str | Dict[str, Any],
    agent_id: str,
    cap_url: str = "http://localhost:4000",
) -> str:
    """Execute a CAP function call and return the JSON-serialised result.

    This function is designed to be called directly with the ``name`` and
    ``arguments`` values from an OpenAI ``function_call`` response object.

    Parameters
    ----------
    name:
        The function name returned by the model (e.g. ``"discover_providers"``).
    arguments:
        Either the raw JSON string of arguments from the model, or a
        pre-parsed dictionary.
    agent_id:
        The CAP agent ID acting as the consumer.
    cap_url:
        Base URL of the CAP API server.

    Returns
    -------
    str
        A JSON-encoded string with the result (or an error object).
    """
    # Parse arguments if provided as a JSON string.
    if isinstance(arguments, str):
        try:
            args: Dict[str, Any] = json.loads(arguments) if arguments else {}
        except json.JSONDecodeError:
            return json.dumps({"error": "invalid_arguments", "message": "Could not parse arguments as JSON."})
    else:
        args = arguments

    client = CAPClient(agent_id=agent_id, cap_url=cap_url)

    try:
        if name == "discover_providers":
            return _discover_providers(client, args)
        elif name == "hire_agent":
            return _hire_agent(client, args)
        elif name == "check_reputation":
            return _check_reputation(client, args)
        elif name == "get_balance":
            return _get_balance(client, agent_id)
        elif name == "get_escrows":
            return _get_escrows(client)
        elif name == "dispute_delivery":
            return _dispute_delivery(client, args)
        else:
            return json.dumps({"error": "unknown_function", "message": f"Unknown function: {name}"})
    except RuntimeError as exc:
        return json.dumps({"error": "api_error", "message": str(exc)})
    except TimeoutError as exc:
        return json.dumps({"error": "timeout", "message": str(exc)})
    except ValueError as exc:
        return json.dumps({"error": "value_error", "message": str(exc)})
    except Exception as exc:  # noqa: BLE001
        return json.dumps({"error": "unexpected_error", "message": str(exc)})


# ---------------------------------------------------------------------------
# Internal handler functions
# ---------------------------------------------------------------------------

def _discover_providers(client: CAPClient, args: Dict[str, Any]) -> str:
    capability = args.get("capability", "")
    if not capability:
        return json.dumps({"error": "missing_parameter", "message": "Parameter 'capability' is required."})
    listings = client.discover(capability)
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


def _hire_agent(client: CAPClient, args: Dict[str, Any]) -> str:
    provider = args.get("provider", "")
    capability = args.get("capability", "")
    if not provider or not capability:
        return json.dumps({
            "error": "missing_parameter",
            "message": "Parameters 'provider' and 'capability' are required.",
        })
    result = client.hire(
        provider=provider,
        capability=capability,
        params=args.get("params"),
        max_price=args.get("max_price", 1.0),
        auto_approve=args.get("auto_approve", True),
        timeout=args.get("timeout", 60.0),
    )
    # Serialise any dataclass objects in the result.
    serialisable: Dict[str, Any] = {}
    for key, value in result.items():
        if hasattr(value, "__dataclass_fields__"):
            serialisable[key] = {
                k: getattr(value, k)
                for k in value.__dataclass_fields__
            }
        else:
            serialisable[key] = value
    return json.dumps(serialisable)


def _check_reputation(client: CAPClient, args: Dict[str, Any]) -> str:
    target_agent_id = args.get("target_agent_id", "")
    if not target_agent_id:
        return json.dumps({"error": "missing_parameter", "message": "Parameter 'target_agent_id' is required."})
    reputation = client.get_reputation(target_agent_id)
    return json.dumps(reputation)


def _get_balance(client: CAPClient, agent_id: str) -> str:
    balance = client.get_balance()
    return json.dumps({"agent_id": agent_id, "balance": balance})


def _get_escrows(client: CAPClient) -> str:
    escrows = client.get_escrows()
    return json.dumps(escrows)


def _dispute_delivery(client: CAPClient, args: Dict[str, Any]) -> str:
    review_contract_id = args.get("review_contract_id", "")
    reason = args.get("reason", "")
    if not review_contract_id or not reason:
        return json.dumps({
            "error": "missing_parameter",
            "message": "Parameters 'review_contract_id' and 'reason' are required.",
        })
    result = client.dispute(review_contract_id, reason)
    return json.dumps(result)
