# CreDex Scoring Engine

FastAPI service that computes on-chain credit scores for wallets.

## Setup

```bash
# 1. Copy env file
cp .env.example .env

# 2. Add your Alchemy API key to .env
#    Get one free at https://dashboard.alchemy.com
#    Create app → Ethereum → Sepolia → copy API Key
ALCHEMY_API_KEY=your_key_here

# 3. Add your wallet to WORLD_ID_VERIFIED for testing
WORLD_ID_VERIFIED=0xYourWalletAddress

# 4. Install dependencies
pip install -r requirements.txt

# 5. Start
python main.py
# → Running on http://0.0.0.0:8001
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Service status + Alchemy key check |
| POST | `/score` | Compute score `{wallet_address, chain_id}` |
| GET | `/score/:wallet` | GET convenience endpoint |
| GET | `/tiers` | Tier definitions |

## Scoring Signals

| Signal | Max Points | Source |
|--------|-----------|--------|
| Wallet Age | 200 | First tx timestamp (Alchemy) |
| Repayment History | 250 | DeFi repay calls (Alchemy) |
| Liquidation Penalty | −100 each | Liquidation events (Alchemy) |
| Volume Consistency | 200 | Monthly tx volume CV (Alchemy) |
| DeFi Diversity | 150 | Unique protocols used (Alchemy) |
| World ID Bonus | 100 | WORLD_ID_VERIFIED env var |

## Testnet behaviour

New Sepolia wallets with no history score 0 by default → Denied tier.
The scorer applies a Bronze floor (400 pts) on Sepolia so testing works
without needing real DeFi history.

Add your wallet to `WORLD_ID_VERIFIED` to boost to Silver (500 pts).

Remove the testnet base score block in `scorer.py` before mainnet deploy.
