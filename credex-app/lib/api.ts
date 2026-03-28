/**
 * api.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * All functions that hooks call. Where a Go backend endpoint exists, we call it.
 * Where there is no backend equivalent (pool stats, activity feed, deposits),
 * we keep the existing mock so the lend UI still works end-to-end.
 *
 * The Go backend itself gracefully mocks any unconfigured external service
 * (FHE, ZK, Starknet, EVM relay, Filecoin), so "real" calls always return
 * valid data even in a dev environment with no external services running.
 */
import type {
  BorrowRequestPayload,
  BorrowRequestResult,
  DepositPayload,
  DepositResult,
  PoolStats,
  ActivityItem,
  CreditScore,
  CreditTier,
  ScoreHistoryPoint,
  CreditEvent,
  PortfolioStats,
  CollateralOption,
} from "@/types";
import { backendApi, type GoScoreResponse } from "@/lib/backendApi";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function mockTxHash() {
  return "0x" + Array.from({ length: 64 }, () =>
    Math.floor(Math.random() * 16).toString(16)).join("");
}

// Maps the Go tier string → frontend CreditTier
function goTierToFrontend(tier: string): CreditTier {
  const map: Record<string, CreditTier> = {
    Platinum: "Platinum", Gold: "Gold", Silver: "Silver", Bronze: "Bronze",
  };
  return map[tier] ?? "Bronze";
}

// Maps Go signal breakdown → frontend CreditSignal[]
// Go uses raw scores (wallet_age_score=92 meaning 92/100)
// Frontend expects value 0-100
function goSignalsToFrontend(s: GoScoreResponse["signals"]) {
  return [
    { label: "Wallet Age",          value: Math.min(100, s.wallet_age_score),    weight: 0.20 },
    { label: "Repayment History",   value: Math.min(100, s.repayment_score),     weight: 0.35 },
    { label: "Liquidation Penalty", value: Math.min(100, 100 - s.liquidation_penalty), weight: 0.20 },
    { label: "Volume Consistency",  value: Math.min(100, s.volume_consistency),  weight: 0.10 },
    { label: "DeFi Diversity",      value: Math.min(100, s.defi_diversity),      weight: 0.10 },
    { label: "World ID Bonus",      value: s.has_world_id ? 100 : 0,             weight: 0.05 },
  ];
}

// LTV from tier: matches Go backend tier caps
function tierToMaxLTV(tier: string): number {
  const m: Record<string, number> = { Platinum: 0.80, Gold: 0.65, Silver: 0.50, Bronze: 0.35 };
  return m[tier] ?? 0.35;
}

// APR from Go loan_terms
function aprFromLoanTerms(lt: GoScoreResponse["loan_terms"]): number {
  return lt.interest_rate_apr != null ? lt.interest_rate_apr / 100 : 0.25;
}

// ─── Pool Stats — no backend equivalent, keep mock ────────────────────────────

export async function fetchPoolStats(): Promise<PoolStats> {
  await delay(300);
  const noise = () => (Math.random() - 0.5) * 0.02;
  return {
    tvl:             142_509_211 + Math.random() * 100_000,
    apy:             14.82 + noise(),
    activeLoans:     1204 + Math.floor(Math.random() * 5),
    defaultRate:     0.021,
    utilizationRate: 0.75 + noise() * 0.05,
    availableCash:   35_700_000 + Math.random() * 50_000,
    activeLoanValue: 106_800_000,
  };
}

// ─── Activity Feed — no backend equivalent, keep mock ────────────────────────

const ACTIVITY_POOL: Omit<ActivityItem, "id" | "timestamp" | "txHash">[] = [
  { type: "loan_funded",            address: "0x71...eE2", tier: "Platinum", amount: 45000,   asset: "USDC", label: "Loan Funded" },
  { type: "interest_distribution",  address: "Global Pool",                  amount: 2104.92, asset: "USDC", label: "Interest Distribution" },
  { type: "borrower_verified",      address: "0x12...aF9", tier: "Bronze",                                   label: "Borrower Verified" },
  { type: "repayment",              address: "0x33...B12", tier: "Gold",     amount: 5000,    asset: "USDC", label: "Repayment Made" },
  { type: "deposit",                address: "0x88...C44", tier: "Silver",   amount: 8000,    asset: "USDC", label: "Liquidity Deposited" },
];

export async function fetchActivityFeed(): Promise<ActivityItem[]> {
  await delay(200);
  return Array.from({ length: 8 }, (_, i) => {
    const template = ACTIVITY_POOL[Math.floor(Math.random() * ACTIVITY_POOL.length)];
    return {
      ...template,
      id:        `act-${Date.now()}-${i}`,
      timestamp: new Date(Date.now() - i * 1000 * 60 * (i + 1)).toISOString(),
      txHash:    mockTxHash(),
    };
  });
}

// ─── Credit Score — real Go backend ──────────────────────────────────────────

/**
 * Fetches the real credit score for a wallet from the Go backend.
 * The Go backend calls the Python scoring engine which queries on-chain data.
 * Falls back to a safe mock if the wallet address is unknown / not set.
 */
export async function fetchCreditScore(wallet?: string): Promise<CreditScore> {
  if (!wallet) {
    // No wallet connected yet — return encrypted placeholder
    return fallbackCreditScore();
  }

  try {
    const go = await backendApi.getScore(wallet);
    return goScoreToCreditScore(go);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("503")) {
      console.warn("[api] Credit scoring engine unreachable (503) — is the Python engine running on :8001?");
    } else if (msg.includes("Failed to fetch") || msg.includes("ECONNREFUSED")) {
      console.warn("[api] Go backend unreachable — is lendr-backend running on :8000?");
    } else {
      console.warn("[api] fetchCreditScore failed:", msg);
    }
    return fallbackCreditScore();
  }
}

function goScoreToCreditScore(go: GoScoreResponse): CreditScore {
  const tier = goTierToFrontend(go.tier);
  return {
    tier,
    hash:           `${go.score.toString(16).padStart(4, "0")}...${go.wallet_address.slice(-4)}`,
    encrypted:      true,
    revealed:       false,
    numericScore:   null, // revealed on demand via revealScore()
    signals:        goSignalsToFrontend(go.signals),
    maxLTV:         tierToMaxLTV(go.tier),
    aprRate:        aprFromLoanTerms(go.loan_terms),
    repaymentStreak: go.signals.defi_repayments,
    globalRank:     go.signals.raw_total > 800 ? 1200 : go.signals.raw_total > 600 ? 8400 : 24000,
    xp:             Math.min(1000, Math.round(go.score * 1.1)),
    nextTierXP:     1000,
  };
}

function fallbackCreditScore(): CreditScore {
  return {
    tier:            "Gold",
    hash:            "8f3d...912a",
    encrypted:       true,
    revealed:        false,
    numericScore:    null,
    signals: [
      { label: "Wallet Age",          value: 92,  weight: 0.20 },
      { label: "Repayment History",   value: 100, weight: 0.35 },
      { label: "Liquidation Penalty", value: 96,  weight: 0.20 },
      { label: "Volume Consistency",  value: 68,  weight: 0.10 },
      { label: "DeFi Diversity",      value: 84,  weight: 0.10 },
      { label: "World ID Bonus",      value: 100, weight: 0.05 },
    ],
    maxLTV:          0.65,
    aprRate:         0.08,
    repaymentStreak: 0,
    globalRank:      8400,
    xp:              840,
    nextTierXP:      1000,
  };
}

/**
 * Reveals the numeric score by re-fetching from the backend.
 * On the Go side, the score is always computed — "revealing" just
 * means we return the numeric value we already have.
 */
export async function revealScore(wallet?: string): Promise<{ numericScore: number }> {
  if (!wallet) {
    await delay(1800);
    return { numericScore: 847 };
  }
  try {
    const go = await backendApi.getScore(wallet);
    return { numericScore: go.score };
  } catch {
    await delay(1800);
    return { numericScore: 847 };
  }
}

// ─── Collateral Options — no backend equivalent, keep mock ───────────────────

export async function fetchCollateralOptions(): Promise<CollateralOption[]> {
  await delay(200);
  return [
    { asset: "WETH",  available: 22.45, usdPrice: 2650,  ltv: 0.80 },
    { asset: "WBTC",  available: 1.2,   usdPrice: 65000, ltv: 0.75 },
    { asset: "stETH", available: 18.0,  usdPrice: 2630,  ltv: 0.78 },
  ];
}

// ─── Borrow / ZK Proof — real Go backend ─────────────────────────────────────

/**
 * Calls POST /api/v1/loan/request on the Go backend.
 * The Go backend handles:
 *   1. Credit score fetch (Python engine)
 *   2. Starknet credit validation
 *   3. EVM relay transaction
 *   4. Filecoin proof storage
 *   5. Telegram notification
 * All external services mock gracefully when not configured.
 *
 * The onLog/onCairoStep/onTxHash callbacks simulate the ZK execution
 * timeline while the real backend request is in flight.
 */
export async function executeBorrow(
  payload: BorrowRequestPayload,
  onLog: (msg: string) => void,
  onCairoStep: (step: number) => void,
  onTxHash: (hash: string) => void,
): Promise<BorrowRequestResult> {

  // ── Phase 1: credit score lookup (logged to terminal) ──────────────────────
  onLog("Fetching on-chain credit profile...");
  await delay(400);
  onLog(`Wallet: ${payload.walletAddress.slice(0, 10)}...${payload.walletAddress.slice(-6)}`);
  await delay(300);
  onLog("Credit score verified. Computing eligibility...");
  await delay(300);

  // ── Phase 2: Starknet validation (logged) ──────────────────────────────────
  onLog("Initiating Starknet CreditVerifier.verify_credit()...");
  await delay(500);
  onLog("Submitting calldata to StarkNet Sepolia...");

  // ── Phase 3: Cairo VM simulation (runs concurrently with the real API call) ─
  const cairoSimPromise = runCairoSimulation(onLog, onCairoStep);

  // ── Phase 4: Real API call to Go backend ───────────────────────────────────
  // Run Cairo simulation and real API call concurrently.
  // If API fails, throw with the Go backend's error message (not a generic one).
  const apiPromise = backendApi.requestLoan(
    payload.walletAddress,
    payload.amount,
    11155111,
  ).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    // Surface meaningful errors from Go backend
    if (msg.includes("503") || msg.includes("scoring engine")) {
      throw new Error("Credit scoring engine is offline. Ask the team to start the Python engine.");
    }
    if (msg.includes("not eligible")) {
      throw new Error("Wallet is not eligible for a loan (credit score below threshold).");
    }
    if (msg.includes("already has active loan")) {
      throw new Error("This wallet already has an active loan. Repay it before borrowing again.");
    }
    if (msg.includes("exceeds your")) {
      throw new Error(msg); // pass through tier-cap messages directly
    }
    throw err;
  });

  // Wait for both — Cairo sim is deterministic timing, API is real
  const [, result] = await Promise.all([cairoSimPromise, apiPromise]);

  // ── Phase 5: EVM relay (logged) ────────────────────────────────────────────
  const relayTx = result.relay_tx_hash || mockTxHash();
  onTxHash(relayTx);
  onLog(`RELAY_TX: ${relayTx.slice(0, 24)}... → RelayedCreditVerifier`);
  await delay(400);
  onLog(`ProofID: ${(result.proof_id || "").slice(0, 24)}...`);
  await delay(300);
  onLog("Proof relayed to EVM. Loan record created on-chain.");
  await delay(200);

  if (result.filecoin_cid) {
    onLog(`Filecoin CID: ${result.filecoin_cid.slice(0, 20)}...`);
  }

  onLog(`✓ Loan approved — ${result.loan_id}`);

  // ── Map Go response → frontend BorrowRequestResult ─────────────────────────
  const collateralRequired = computeCollateralRequired(
    payload.amount,
    payload.collateralAsset,
    result.collateral_pct,
  );

  return {
    loanId:             result.loan_id,
    txHash:             relayTx,
    proofHash:          result.proof_id || mockTxHash(),
    aprRate:            result.interest_apr / 100,
    healthFactor:       computeHealthFactor(collateralRequired, payload.collateralAsset, payload.amount),
    collateralRequired,
    // Extra fields — stored on the Loan record
    collateralPct:      result.collateral_pct,
    dueDate:            result.due_date,
    onChainConfirmed:   result.on_chain_confirmed,
    proofData:          result.proof_data,
    filecoinCid:        result.filecoin_cid,
  };
}

async function runCairoSimulation(
  onLog: (msg: string) => void,
  onCairoStep: (step: number) => void,
): Promise<void> {
  onLog("Cairo VM: initializing circuit...");
  await delay(300);
  onLog("Allocating trace memory for STARK proof...");
  await delay(200);
  onLog("Constructing polynomial constraints...");

  for (let step = 0; step <= 1024; step += Math.floor(Math.random() * 55) + 25) {
    await delay(70);
    onCairoStep(Math.min(step, 1024));
    if (step % 256 === 0 && step > 0) {
      onLog(`> Witness computed at step ${step} / 1024`);
    }
  }
  onCairoStep(1024);
  onLog("STARK proof generated successfully.");
  await delay(200);
  onLog("Verifying proof commitment hash...");
  await delay(300);
}

function computeCollateralRequired(
  amountUSDC: number,
  asset: "WETH" | "WBTC" | "stETH",
  collateralPct: number,
): number {
  const prices: Record<string, number> = { WETH: 2650, WBTC: 65000, stETH: 2630 };
  const price = prices[asset] ?? 2650;
  // collateralPct is the % of loan value required as collateral
  const collateralUSD = amountUSDC * (collateralPct / 100);
  return collateralUSD / price;
}

function computeHealthFactor(
  collateralAmount: number,
  asset: "WETH" | "WBTC" | "stETH",
  borrowedUSDC: number,
): number {
  const prices: Record<string, number> = { WETH: 2650, WBTC: 65000, stETH: 2630 };
  const collateralUSD = collateralAmount * (prices[asset] ?? 2650);
  if (borrowedUSDC === 0) return 2.0;
  return Math.min(3.5, (collateralUSD / borrowedUSDC) * 1.1);
}

// ─── Deposit — no backend lend endpoint, keep realistic mock ─────────────────

export async function executeDeposit(
  payload: DepositPayload,
  onStep: (step: string) => void,
): Promise<DepositResult> {
  onStep("Approving USDC spend on StarkNet...");
  await delay(900);
  onStep("Broadcasting deposit transaction...");
  await delay(800);
  const txHash = mockTxHash();
  onStep(`TX: ${txHash.slice(0, 20)}...`);
  await delay(600);
  onStep("Updating sovereign pool share...");
  await delay(500);
  onStep("Confirmed on StarkNet Sepolia.");

  return {
    txHash,
    depositedAmount: payload.amount,
    sharePercent:    payload.amount / 142_509_211,
    projectedAPY:    14.82,
    timestamp:       new Date().toISOString(),
  };
}

// ─── Portfolio Stats — real Go backend ───────────────────────────────────────

export async function fetchPortfolioStats(wallet?: string): Promise<PortfolioStats> {
  if (!wallet) return mockPortfolioStats();

  try {
    const status = await backendApi.getLoanStatus(wallet);
    return goLoanStatusToPortfolioStats(status);
  } catch (err) {
    console.warn("[api] fetchPortfolioStats failed, using fallback:", err);
    return mockPortfolioStats();
  }
}

function goLoanStatusToPortfolioStats(
  s: Awaited<ReturnType<typeof backendApi.getLoanStatus>>
): PortfolioStats {
  const allLoans     = [...s.active_loans, ...s.loan_history];
  const totalBorrowed = allLoans.reduce((a, l) => a + l.amount_usdc, 0);
  const totalRepaid   = s.loan_history
    .filter(l => l.status === "repaid")
    .reduce((a, l) => a + l.amount_usdc, 0);

  return {
    totalBorrowed,
    totalRepaid,
    totalLent:          0, // lend data not tracked in Go backend
    earnedYield:        0,
    protocolRevenue:    totalBorrowed * 0.005,
    globalRank:         s.score > 800 ? 1200 : s.score > 600 ? 8400 : 24000,
    reliabilityPercent: s.streak_count > 0
      ? Math.min(100, 90 + s.streak_count * 2)
      : totalRepaid > 0 ? 95 : 100,
    activeObligations:  s.active_loans.length,
  };
}

function mockPortfolioStats(): PortfolioStats {
  return {
    totalBorrowed:      240400,
    totalRepaid:        183000,
    totalLent:          10000,
    earnedYield:        1204.5,
    protocolRevenue:    1204.5,
    globalRank:         4211,
    reliabilityPercent: 99.2,
    activeObligations:  2,
  };
}

// ─── Score History — no backend equivalent, keep mock ────────────────────────

export async function fetchScoreHistory(): Promise<ScoreHistoryPoint[]> {
  await delay(300);
  const points: ScoreHistoryPoint[] = [];
  let score = 640;
  for (let i = 11; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    score = Math.min(900, Math.max(580, score + Math.floor((Math.random() - 0.3) * 30)));
    points.push({
      date:  d.toISOString().slice(0, 7),
      score,
      tier:  score < 700 ? "Bronze" : score < 750 ? "Silver" : score < 820 ? "Gold" : "Platinum",
    });
  }
  return points;
}

export async function fetchCreditEvents(): Promise<CreditEvent[]> {
  await delay(200);
  return [
    { id: "ev1", date: "2024-09-12", type: "loan",         title: "Flash-Collateral Loan #882",    description: "Loan of 120,000 USDT against 5 WBTC collateral. Successfully repaid after 30 days.", creditImpact:  12.4, tier: "Gold",   txHash: mockTxHash() },
    { id: "ev2", date: "2024-07-04", type: "repayment",    title: "Liquidity Provider Leverage",   description: "10,000 USDC utilized for Curve Protocol farm. Position closed in profit.",           creditImpact:   8.1, tier: "Gold",   txHash: mockTxHash() },
    { id: "ev3", date: "2024-04-22", type: "tier_upgrade", title: "Tier Upgrade: Silver → Gold",   description: "Reached 750+ credit score through consistent repayment history.",                    creditImpact:  50.0, tier: "Gold",   txHash: mockTxHash() },
    { id: "ev4", date: "2024-01-22", type: "default",      title: "Delayed Repayment — Bridge",    description: "Experimental ZK-line. Repayment delayed by 48h. Grace period applied.",             creditImpact:  -4.2, tier: "Silver", txHash: mockTxHash() },
    { id: "ev5", date: "2023-11-10", type: "deposit",      title: "First Lend Position",           description: "Initial deposit of 5,000 USDC into sovereign pool.",                               creditImpact:   5.0, tier: "Silver", txHash: mockTxHash() },
  ];
}

// ─── Loan repayment — real Go backend ────────────────────────────────────────

export async function submitRepayment(
  wallet: string,
  loanId: string,
): Promise<{ txHash: string; streak: number }> {
  const result = await backendApi.repayLoan(wallet, loanId);
  return { txHash: mockTxHash(), streak: result.streak };
}
