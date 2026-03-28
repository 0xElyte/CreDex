"""
CreDex Credit Scoring Engine — Edge Case Hardened
──────────────────────────────────────────────────
Patches applied vs original:
  1. eth_getLogs uses recent 500k block window (fixes Alchemy 400 on Sepolia)
  2. Testnet base score: new Sepolia wallets get Bronze floor (400 pts)
     so testing is possible without real DeFi history
  3. Pydantic int/float: collateral_pct and max_loan_usdc explicitly cast to int
"""
import os
import asyncio
import logging
import math
from datetime import datetime, timezone
from typing import Any, Optional

import httpx
from dotenv import load_dotenv

from models import (
    ScoreResponse, SignalBreakdown, LoanTerms, CreditTier,
    MIN_LOAN_USDC,
)

load_dotenv()
log = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

ALCHEMY_TIMEOUT     = 15
ALCHEMY_MAX_RETRIES = 2
ALCHEMY_MAX_TXS     = 1000

DEFI_PROTOCOLS = {
    "0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2": "Aave V3",
    "0xc3d688b66703497daa19211eedff47f25384cdc3": "Compound V3",
    "0x3d9819210a31b4961b30ef54be2aed79b9c9cd3b": "Compound V2",
    "0x7a250d5630b4cf539739df2c5dacb4c659f2488d": "Uniswap V2",
    "0xe592427a0aece92de3edee1f18e0157c05861564": "Uniswap V3",
    "0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f": "SushiSwap",
    "0xae7ab96520de3a18e5e111b5eaab095312d7fe84": "Lido",
    "0x00000000219ab540356cbb839cbe05303d7705fa": "ETH2 Deposit",
    "0x6ae43d3271ff6888e7fc43fd7321a503ff738951": "Aave V3 Sepolia",
    "0x29598b72eb5cebd806c5dcd549490fda35b13cd8": "Compound Sepolia",
}

REPAYMENT_SELECTORS = {
    "0x573ade81",
    "0x69328dec",
    "0xdb006a75",
    "0x4e4d9fea",
    "0x2e1a7d4d",
}

LIQUIDATION_TOPICS = {
    "0xe413a321e8681d831f4dbccbca790d2952b56f977908e45be37335533e005286",
    "0x298637f684da70674f26509b10f07ec2fbc77a335ab1e7d6215a4b2484d8bb52",
}

_FETCH_FAILED = object()


# ── Alchemy Fetcher ───────────────────────────────────────────────────────────

class AlchemyFetcher:

    def __init__(self):
        key = os.getenv("ALCHEMY_API_KEY", "").strip()
        if not key or key == "your_alchemy_key_here":
            log.warning(
                "ALCHEMY_API_KEY is not set or is the placeholder value. "
                "All wallets will score 0. Set a real key in .env"
            )
            key = "demo"
        self._key = key
        self._urls = {
            1:        f"https://eth-mainnet.g.alchemy.com/v2/{key}",
            11155111: f"https://eth-sepolia.g.alchemy.com/v2/{key}",
            137:      f"https://polygon-mainnet.g.alchemy.com/v2/{key}",
        }

    @property
    def is_configured(self) -> bool:
        return self._key != "demo"

    def _url(self, chain_id: int) -> str:
        return self._urls.get(chain_id, self._urls[11155111])

    async def _rpc(self, chain_id: int, method: str, params: list, attempt: int = 0) -> Any:
        url = self._url(chain_id)
        try:
            async with httpx.AsyncClient(timeout=ALCHEMY_TIMEOUT) as client:
                r = await client.post(url, json={
                    "jsonrpc": "2.0", "id": 1,
                    "method": method, "params": params,
                })
                if r.status_code == 429:
                    if attempt < ALCHEMY_MAX_RETRIES:
                        wait = 2 ** attempt
                        log.warning(f"Alchemy rate limited. Retrying in {wait}s...")
                        await asyncio.sleep(wait)
                        return await self._rpc(chain_id, method, params, attempt + 1)
                    raise ValueError("Alchemy rate limit exceeded after retries")
                if r.status_code >= 500:
                    if attempt < ALCHEMY_MAX_RETRIES:
                        await asyncio.sleep(2 ** attempt)
                        return await self._rpc(chain_id, method, params, attempt + 1)
                    raise ValueError(f"Alchemy server error: {r.status_code}")
                r.raise_for_status()
                data = r.json()
                if "error" in data:
                    msg = data["error"].get("message", str(data["error"]))
                    raise ValueError(f"Alchemy RPC error: {msg}")
                return data.get("result")
        except httpx.TimeoutException:
            if attempt < ALCHEMY_MAX_RETRIES:
                log.warning(f"Alchemy timeout on {method}. Retrying...")
                return await self._rpc(chain_id, method, params, attempt + 1)
            raise ValueError(f"Alchemy timeout after {ALCHEMY_MAX_RETRIES + 1} attempts")
        except httpx.ConnectError:
            raise ValueError("Cannot connect to Alchemy — check your internet connection")

    async def get_first_tx_timestamp(self, wallet: str, chain_id: int) -> int:
        try:
            result = await self._rpc(chain_id, "alchemy_getAssetTransfers", [{
                "fromBlock": "0x0", "toBlock": "latest",
                "fromAddress": wallet,
                "category": ["external", "erc20"],
                "order": "asc", "maxCount": "0x1",
                "withMetadata": True,
            }])
            if not result:
                return 0
            transfers = result.get("transfers", [])
            if not transfers:
                return 0
            meta   = transfers[0].get("metadata") or {}
            ts_str = meta.get("blockTimestamp", "")
            if not ts_str:
                return 0
            try:
                dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                ts = int(dt.timestamp())
            except (ValueError, OSError):
                log.warning(f"Unparseable timestamp: {ts_str!r}")
                return 0
            now = int(datetime.now(timezone.utc).timestamp())
            if ts > now:
                return 0
            ETH_GENESIS = 1438270800
            if ts < ETH_GENESIS:
                return 0
            return ts
        except Exception as e:
            log.warning(f"get_first_tx_timestamp failed for {wallet}: {e}")
            return 0

    async def get_transfers(self, wallet: str, chain_id: int) -> list[dict]:
        try:
            result = await self._rpc(chain_id, "alchemy_getAssetTransfers", [{
                "fromBlock": "0x0", "toBlock": "latest",
                "fromAddress": wallet,
                "category": ["external", "erc20", "erc721"],
                "order": "desc", "maxCount": hex(ALCHEMY_MAX_TXS),
                "withMetadata": True,
            }])
            if not result:
                return []
            transfers = result.get("transfers", [])
            if not isinstance(transfers, list):
                log.warning(f"Unexpected transfers type: {type(transfers)}")
                return []
            return transfers
        except Exception as e:
            log.warning(f"get_transfers failed for {wallet}: {e}")
            return []

    async def get_liquidation_logs(self, wallet: str, chain_id: int) -> list[dict]:
        """
        FIX: Use a recent 500k-block window instead of fromBlock=0x0.
        Alchemy Sepolia returns 400 for unbounded eth_getLogs range queries.
        500k blocks ≈ 69 days on Sepolia (12s block time).
        """
        try:
            hex_part = wallet[2:] if wallet.startswith("0x") else wallet
            padded   = "0x" + hex_part.zfill(64)

            # Get current block number first
            BLOCK_WINDOW = 500_000
            try:
                latest_hex = await self._rpc(chain_id, "eth_blockNumber", [])
                latest_int = int(latest_hex, 16) if latest_hex else 0
            except Exception:
                latest_int = 0

            from_block = hex(max(0, latest_int - BLOCK_WINDOW)) if latest_int > BLOCK_WINDOW else "0x0"

            result = await self._rpc(chain_id, "eth_getLogs", [{
                "fromBlock": from_block,
                "toBlock":   "latest",
                "topics":    [list(LIQUIDATION_TOPICS), None, padded],
            }])

            if not result:
                return []
            if not isinstance(result, list):
                log.warning(f"Unexpected logs type: {type(result)}")
                return []
            return result
        except Exception as e:
            log.warning(f"get_liquidation_logs failed for {wallet}: {e}")
            return []


# ── Safe Transaction Field Extraction ────────────────────────────────────────

def _safe_to_addr(tx: dict) -> str:
    try:
        addr = tx.get("to") or ""
        return addr.lower().strip() if isinstance(addr, str) else ""
    except Exception:
        return ""

def _safe_selector(tx: dict) -> str:
    try:
        raw = tx.get("input") or tx.get("data") or ""
        if not isinstance(raw, str) or len(raw) < 10:
            return ""
        return raw[:10].lower()
    except Exception:
        return ""

def _safe_value(tx: dict) -> float:
    try:
        v = tx.get("value")
        if v is None:
            return 0.0
        return max(0.0, float(v))
    except (TypeError, ValueError):
        return 0.0

def _safe_month_key(tx: dict) -> Optional[str]:
    try:
        meta   = tx.get("metadata") or {}
        ts_str = meta.get("blockTimestamp", "")
        if not ts_str or not isinstance(ts_str, str):
            return None
        dt  = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        if dt > now:
            return None
        return dt.strftime("%Y-%m")
    except Exception:
        return None


# ── Scoring Signals ───────────────────────────────────────────────────────────

def _signal_wallet_age(first_tx_ts: int) -> tuple[int, int]:
    if first_tx_ts <= 0:
        return 0, 0
    now      = datetime.now(timezone.utc).timestamp()
    age_days = int((now - first_tx_ts) / 86400)
    if age_days <= 0:
        return 0, 0
    raw   = (math.log10(age_days + 1) / math.log10(3652)) * 200
    score = max(0, min(200, int(raw)))
    return score, age_days

def _signal_repayment(transfers: list[dict]) -> tuple[int, int]:
    count = 0
    for tx in transfers:
        if _safe_to_addr(tx) in DEFI_PROTOCOLS and _safe_selector(tx) in REPAYMENT_SELECTORS:
            count += 1
    return min(250, count * 5), count

def _signal_liquidation(logs: list[dict]) -> tuple[int, int]:
    count   = len(logs) if isinstance(logs, list) else 0
    penalty = -(count * 100)
    return penalty, count

def _signal_volume_consistency(transfers: list[dict]) -> tuple[int, dict]:
    monthly: dict[str, float] = {}
    for tx in transfers:
        value = _safe_value(tx)
        key   = _safe_month_key(tx)
        if key and value > 0:
            monthly[key] = monthly.get(key, 0.0) + value
    if len(monthly) == 0:
        return 0, monthly
    if len(monthly) == 1:
        return 40, monthly
    values  = list(monthly.values())
    avg     = sum(values) / len(values)
    if avg <= 0:
        return 0, monthly
    variance = sum((v - avg) ** 2 for v in values) / len(values)
    std_dev  = math.sqrt(variance)
    cv       = min(std_dev / avg, 1.0)
    score    = max(0, min(200, int((1 - cv) * 200)))
    return score, monthly

def _signal_defi_diversity(transfers: list[dict]) -> tuple[int, set]:
    protocols: set[str] = set()
    for tx in transfers:
        to_addr = _safe_to_addr(tx)
        if to_addr in DEFI_PROTOCOLS:
            protocols.add(DEFI_PROTOCOLS[to_addr])
    score = min(150, len(protocols) * 30)
    return score, protocols

def _signal_world_id(wallet: str) -> tuple[int, bool]:
    raw      = os.getenv("WORLD_ID_VERIFIED", "")
    verified = {w.strip().lower() for w in raw.split(",") if w.strip()}
    has_id   = wallet.lower() in verified
    return (100 if has_id else 0), has_id


# ── Credit Scorer ─────────────────────────────────────────────────────────────

class CreditScorer:

    def __init__(self):
        self.fetcher = AlchemyFetcher()

    async def compute(self, wallet_address: str, chain_id: int = 11155111) -> ScoreResponse:
        wallet = wallet_address.lower()

        results = await asyncio.gather(
            self.fetcher.get_first_tx_timestamp(wallet, chain_id),
            self.fetcher.get_transfers(wallet, chain_id),
            self.fetcher.get_liquidation_logs(wallet, chain_id),
            return_exceptions=True,
        )

        degraded          = False
        degraded_reasons  = []
        first_tx_ts, transfers, liquidation_logs = results

        if isinstance(first_tx_ts, Exception):
            log.warning(f"first_tx_timestamp failed: {first_tx_ts}")
            first_tx_ts = 0
            degraded = True
            degraded_reasons.append("wallet_age unavailable")

        if isinstance(transfers, Exception):
            log.warning(f"get_transfers failed: {transfers}")
            transfers = []
            degraded = True
            degraded_reasons.append("transaction history unavailable")

        if isinstance(liquidation_logs, Exception):
            log.warning(f"get_liquidation_logs failed: {liquidation_logs}")
            liquidation_logs = []
            degraded = True
            degraded_reasons.append("liquidation history unavailable")

        wallet_age_score,    wallet_age_days      = _signal_wallet_age(first_tx_ts)
        repayment_score,     defi_repayments      = _signal_repayment(transfers)
        liquidation_penalty, liquidation_count    = _signal_liquidation(liquidation_logs)
        volume_consistency,  monthly_volumes      = _signal_volume_consistency(transfers)
        defi_diversity,      unique_protocol_set  = _signal_defi_diversity(transfers)
        world_id_bonus,      has_world_id         = _signal_world_id(wallet)

        total_transactions = len(transfers) if isinstance(transfers, list) else 0

        raw_total = (
            wallet_age_score
            + repayment_score
            + liquidation_penalty
            + volume_consistency
            + defi_diversity
            + world_id_bonus
        )

        if not isinstance(raw_total, int):
            raw_total = int(raw_total)

        # ── Testnet base score ────────────────────────────────────────────────
        # New Sepolia wallets have no DeFi history → would score 0 → Denied.
        # Apply a Bronze floor (400) on Sepolia for wallets with no activity
        # so demo/testing works without seeding on-chain transactions.
        # Remove this block before mainnet deployment.
        is_sepolia         = chain_id == 11155111
        has_any_activity   = total_transactions > 0 or wallet_age_days > 0
        if is_sepolia and not has_any_activity:
            floor     = 400 + world_id_bonus   # World ID = Silver (500)
            raw_total = max(raw_total, floor)
            log.info(f"Testnet base score applied for {wallet}: raw={raw_total}")

        final_score = max(0, min(1000, raw_total))
        tier, loan_terms = self._resolve_tier(final_score)

        return ScoreResponse(
            wallet_address=wallet,
            chain_id=chain_id,
            score=final_score,
            tier=tier,
            signals=SignalBreakdown(
                wallet_age_score=wallet_age_score,
                repayment_score=repayment_score,
                liquidation_penalty=liquidation_penalty,
                volume_consistency=volume_consistency,
                defi_diversity=defi_diversity,
                world_id_bonus=world_id_bonus,
                raw_total=raw_total,
                final_score=final_score,
                wallet_age_days=wallet_age_days,
                total_transactions=total_transactions,
                defi_repayments=defi_repayments,
                liquidation_count=liquidation_count,
                unique_protocols=len(unique_protocol_set),
                has_world_id=has_world_id,
            ),
            loan_terms=loan_terms,
            computed_at=datetime.now(timezone.utc).isoformat(),
            degraded=degraded,
            degraded_reason="; ".join(degraded_reasons) if degraded_reasons else None,
        )

    def _resolve_tier(self, score: int) -> tuple[CreditTier, LoanTerms]:
        """Map score to tier. All numeric fields explicitly cast to int to satisfy Pydantic."""
        if score >= 850:
            return CreditTier.PLATINUM, LoanTerms(
                tier=CreditTier.PLATINUM, collateral_pct=int(20),
                interest_rate_apr=4.0, max_loan_usdc=int(10000), eligible=True)
        elif score >= 700:
            return CreditTier.GOLD, LoanTerms(
                tier=CreditTier.GOLD, collateral_pct=int(35),
                interest_rate_apr=8.0, max_loan_usdc=int(5000), eligible=True)
        elif score >= 550:
            return CreditTier.SILVER, LoanTerms(
                tier=CreditTier.SILVER, collateral_pct=int(50),
                interest_rate_apr=14.0, max_loan_usdc=int(2000), eligible=True)
        elif score >= 400:
            return CreditTier.BRONZE, LoanTerms(
                tier=CreditTier.BRONZE, collateral_pct=int(65),
                interest_rate_apr=22.0, max_loan_usdc=int(500), eligible=True)
        else:
            return CreditTier.DENIED, LoanTerms(
                tier=CreditTier.DENIED, collateral_pct=None,
                interest_rate_apr=None, max_loan_usdc=int(0), eligible=False)
