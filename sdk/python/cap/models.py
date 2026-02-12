"""Data models for CAP Protocol."""
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class SLATerms:
    max_latency_ms: int = 30000
    penalty_rate: float = 0.0

    def to_dict(self):
        return {
            "maxLatencyMs": str(self.max_latency_ms),
            "penaltyRate": str(self.penalty_rate),
        }


@dataclass
class AgentProfile:
    agent_id: str
    name: str
    description: str = ""
    capabilities: list = field(default_factory=list)
    endpoint: str = ""
    contract_id: Optional[str] = None


@dataclass
class ServiceListing:
    provider: str
    capability: str
    description: str = ""
    base_price: float = 0.0
    contract_id: Optional[str] = None


@dataclass
class ServiceRequest:
    consumer: str
    provider: str
    capability: str
    params: dict = field(default_factory=dict)
    max_price: float = 1.0
    sla_terms: SLATerms = field(default_factory=SLATerms)
    contract_id: Optional[str] = None


@dataclass
class ServiceOffer:
    consumer: str
    provider: str
    capability: str
    price: float = 0.0
    estimated_time_ms: int = 5000
    contract_id: Optional[str] = None


@dataclass
class Escrow:
    consumer: str
    provider: str
    amount: float = 0.0
    capability: str = ""
    status: str = "locked"
    contract_id: Optional[str] = None


@dataclass
class Coin:
    owner: str
    amount: float
    contract_id: str = ""
