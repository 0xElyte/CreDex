"""
CreDex — Pydantic Models
All request/response types with full validation.
"""
from pydantic import BaseModel, field_validator
from typing import Optional
from enum import Enum
import re

MIN_LOAN_USDC = 10.0
MAX_LOAN_USDC = 10_000.0
MIN_CHAIN_IDS = {1, 11155111, 137}

WALLET_RE = re.compile(r"^0x[0-9a-f]{40}$")


class CreditTier(str, Enum):
    PLATINUM = "Platinum"
    GOLD     = "Gold"
    SILVER   = "Silver"
    BRONZE   = "Bronze"
    DENIED   = "Denied"


class ScoreRequest(BaseModel):
    wallet_address: str
    chain_id: int = 11155111

    @field_validator("wallet_address")
    @classmethod
    def validate_wallet(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("wallet_address cannot be empty")
        v = v.strip().lower()
        if not v.startswith("0x"):
            raise ValueError("Wallet address must start with 0x")
        if len(v) != 42:
            raise ValueError(f"Wallet address must be 42 characters (0x + 40 hex), got {len(v)}")
        if not WALLET_RE.match(v):
            raise ValueError("Wallet address contains invalid characters — must be hex only")
        if v == "0x" + "0" * 40:
            raise ValueError("Zero address is not a valid wallet")
        return v

    @field_validator("chain_id")
    @classmethod
    def validate_chain(cls, v: int) -> int:
        if v <= 0:
            raise ValueError(f"chain_id must be positive, got {v}")
        if v not in MIN_CHAIN_IDS:
            raise ValueError(
                f"Unsupported chain_id {v}. "
                f"Supported: {sorted(MIN_CHAIN_IDS)} (mainnet, sepolia, polygon)"
            )
        return v


class SignalBreakdown(BaseModel):
    wallet_age_score:    int
    repayment_score:     int
    liquidation_penalty: int
    volume_consistency:  int
    defi_diversity:      int
    world_id_bonus:      int
    raw_total:           int
    final_score:         int
    wallet_age_days:     int
    total_transactions:  int
    defi_repayments:     int
    liquidation_count:   int
    unique_protocols:    int
    has_world_id:        bool


class LoanTerms(BaseModel):
    tier:              CreditTier
    collateral_pct:    Optional[int]   = None
    interest_rate_apr: Optional[float] = None
    max_loan_usdc:     int
    eligible:          bool
    min_loan_usdc:     int = int(MIN_LOAN_USDC)


class ScoreResponse(BaseModel):
    wallet_address:  str
    chain_id:        int
    score:           int
    tier:            CreditTier
    signals:         SignalBreakdown
    loan_terms:      LoanTerms
    computed_at:     str
    degraded:        bool = False
    degraded_reason: Optional[str] = None


class HealthResponse(BaseModel):
    status:      str
    service:     str
    version:     str
    alchemy_key: str
