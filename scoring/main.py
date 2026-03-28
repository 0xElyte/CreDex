"""
CreDex Scoring Engine — FastAPI App
"""
import logging
import os
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from scorer import CreditScorer
from models import ScoreRequest, ScoreResponse, HealthResponse

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger(__name__)

scorer = CreditScorer()


@asynccontextmanager
async def lifespan(app: FastAPI):
    key = os.getenv("ALCHEMY_API_KEY", "").strip()
    if not key or key == "your_alchemy_key_here":
        log.warning("=" * 60)
        log.warning("ALCHEMY_API_KEY is not set!")
        log.warning("All wallets will return score=0.")
        log.warning("Add ALCHEMY_API_KEY to scoring/.env to fix this.")
        log.warning("=" * 60)
    else:
        log.info("ALCHEMY_API_KEY configured ✓")

    telegram = os.getenv("TELEGRAM_BOT_TOKEN", "")
    if not telegram:
        log.warning("TELEGRAM_BOT_TOKEN not set — bot notifications disabled")

    log.info("CreDex Scoring Engine started on port 8001")
    yield
    log.info("CreDex Scoring Engine shutting down")


app = FastAPI(
    title="CreDex Scoring Engine",
    description="Privacy-preserving on-chain credit scoring for DeFi lending",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    errors = []
    for error in exc.errors():
        field = " → ".join(str(loc) for loc in error["loc"])
        errors.append({"field": field, "message": error["msg"]})
    return JSONResponse(
        status_code=422,
        content={"error": "Validation failed", "details": errors},
    )


@app.exception_handler(Exception)
async def generic_error_handler(request: Request, exc: Exception):
    log.exception(f"Unhandled error on {request.method} {request.url.path}")
    return JSONResponse(
        status_code=500,
        content={"error": "Internal server error. Please try again."},
    )


@app.get("/health", response_model=HealthResponse)
async def health():
    key = os.getenv("ALCHEMY_API_KEY", "").strip()
    return HealthResponse(
        status="ok",
        service="credex-scoring",
        version="1.0.0",
        alchemy_key="configured" if key and key != "your_alchemy_key_here" else "missing",
    )


@app.post("/score", response_model=ScoreResponse)
async def compute_score(req: ScoreRequest):
    try:
        return await scorer.compute(req.wallet_address, req.chain_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        log.exception(f"Scoring failed for {req.wallet_address}")
        raise HTTPException(status_code=500, detail="Scoring failed. Please try again.")


@app.get("/score/{wallet_address}", response_model=ScoreResponse)
async def get_score(wallet_address: str, chain_id: int = 11155111):
    wallet = wallet_address.strip().lower()
    if not wallet.startswith("0x") or len(wallet) != 42:
        raise HTTPException(status_code=400, detail="Invalid wallet address.")
    if wallet == "0x" + "0" * 40:
        raise HTTPException(status_code=400, detail="Zero address is not valid")
    if chain_id not in {1, 11155111, 137}:
        raise HTTPException(status_code=400, detail=f"Unsupported chain_id {chain_id}")
    try:
        return await scorer.compute(wallet, chain_id)
    except Exception:
        log.exception(f"Scoring failed for {wallet}")
        raise HTTPException(status_code=500, detail="Scoring failed. Please try again.")


@app.get("/tiers")
async def get_tiers():
    return {"tiers": [
        {"name": "Platinum", "min": 850,  "max": 1000, "collateral_pct": 20,   "apr": 4.0,  "max_loan_usdc": 10000},
        {"name": "Gold",     "min": 700,  "max": 849,  "collateral_pct": 35,   "apr": 8.0,  "max_loan_usdc": 5000},
        {"name": "Silver",   "min": 550,  "max": 699,  "collateral_pct": 50,   "apr": 14.0, "max_loan_usdc": 2000},
        {"name": "Bronze",   "min": 400,  "max": 549,  "collateral_pct": 65,   "apr": 22.0, "max_loan_usdc": 500},
        {"name": "Denied",   "min": 0,    "max": 399,  "collateral_pct": None, "apr": None, "max_loan_usdc": 0},
    ]}


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=True)
