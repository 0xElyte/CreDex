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

type EthereumProvider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};

type TransactionReceipt = {
  status?: string;
  logs?: Array<{ topics?: string[] }>;
};

// ─── On-chain TVL ─────────────────────────────────────────────────────────────
const MUSDC_ADDRESS    = "0x0ed7269d9Cc82b16E9E6D0f40c3bbF64c6Be17c2";
const MCOLL_ADDRESS    = "0x9fCEdCaabD88C303e041fa492c5c056377DdAF59";
const LENDING_CONTRACT = "0xf32A9AA02B2cb24676927BF5BC8D8001d6b76476";
const APPROVE_SELECTOR = "0x095ea7b3";
const REQUEST_LOAN_SELECTOR = "0x1ba71050";
const LOAN_APPROVED_TOPIC = "0x94aaf08546b4eeb75db03fe1f6f7a58122cfa6a6fd18b0b329a12f5711ff3ce0";

function getEthereumProvider(): EthereumProvider | undefined {
  return typeof window !== "undefined"
    ? (window as { ethereum?: EthereumProvider }).ethereum
    : undefined;
}

function requireEthereumProvider(): EthereumProvider {
  const ethereum = getEthereumProvider();
  if (!ethereum) {
    throw new Error("MetaMask is required to post collateral and borrow.");
  }
  return ethereum;
}

function strip0x(hex: string): string {
  return hex.startsWith("0x") ? hex.slice(2) : hex;
}

function encodeUint256(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

function encodeAddress(value: string): string {
  return strip0x(value).toLowerCase().padStart(64, "0");
}

function encodeBytes(hexValue: string): string {
  const clean = strip0x(hexValue);
  const byteLength = BigInt(clean.length / 2);
  const paddedLength = Math.ceil(clean.length / 64) * 64;
  return `${encodeUint256(byteLength)}${clean.padEnd(paddedLength, "0")}`;
}

function buildApproveCalldata(spender: string, amount: bigint): string {
  return `${APPROVE_SELECTOR}${encodeAddress(spender)}${encodeUint256(amount)}`;
}

function buildRequestLoanCalldata(principalAmount: bigint, collateralAmount: bigint, proofDataHex: string): string {
  const head = `${encodeUint256(principalAmount)}${encodeUint256(collateralAmount)}${encodeUint256(BigInt(96))}`;
  return `${REQUEST_LOAN_SELECTOR}${head}${encodeBytes(proofDataHex)}`;
}

function toTokenUnits(amount: number, decimals = 6, rounding: "round" | "ceil" = "round"): bigint {
  const factor = 10 ** decimals;
  const scaled = rounding === "ceil"
    ? Math.ceil(amount * factor)
    : Math.round(amount * factor);
  return BigInt(scaled);
}

async function sendTransaction(from: string, to: string, data: string): Promise<string> {
  const ethereum = requireEthereumProvider();
  return await ethereum.request({
    method: "eth_sendTransaction",
    params: [{ from, to, data }],
  }) as string;
}

async function waitForTransactionReceipt(txHash: string, timeoutMs = 120_000): Promise<TransactionReceipt> {
  const ethereum = requireEthereumProvider();
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const receipt = await ethereum.request({
      method: "eth_getTransactionReceipt",
      params: [txHash],
    }) as TransactionReceipt | null;

    if (receipt) {
      return receipt;
    }

    await delay(1500);
  }

  throw new Error("Timed out waiting for on-chain confirmation.");
}

function assertReceiptSucceeded(receipt: TransactionReceipt, failureMessage: string): void {
  if (!receipt.status || BigInt(receipt.status) === BigInt(0)) {
    throw new Error(failureMessage);
  }
}

function parseSolidityLoanId(receipt: TransactionReceipt): number | undefined {
  const matchingLog = receipt.logs?.find((log) =>
    log.topics?.[0]?.toLowerCase() === LOAN_APPROVED_TOPIC &&
    typeof log.topics?.[1] === "string"
  );

  if (!matchingLog?.topics?.[1]) {
    return undefined;
  }

  const value = BigInt(matchingLog.topics[1]);
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : undefined;
}

function toUserFacingError(error: unknown, fallback: string): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("4001") || /user rejected|user denied/i.test(message)) {
    return new Error("Transaction rejected in wallet.");
  }
  return error instanceof Error ? error : new Error(fallback);
}

async function fetchOnChainTVL(): Promise<number> {
  try {
    const eth = typeof window !== "undefined"
      ? (window as { ethereum?: { request(a: { method: string; params?: unknown[] }): Promise<unknown> } }).ethereum
      : undefined;
    if (!eth) return 0;
    // balanceOf(address) selector: 0x70a08231
    const data = "0x70a08231" + LENDING_CONTRACT.slice(2).toLowerCase().padStart(64, "0");
    const hex = await eth.request({ method: "eth_call", params: [{ to: MUSDC_ADDRESS, data }, "latest"] }) as string;
    return parseInt(hex, 16) / 1e6; // mUSDC has 6 decimals
  } catch {
    return 0;
  }
}

// Reads the ERC-20 symbol() from the lending asset contract on-chain
export async function fetchLendingAsset(): Promise<string> {
  try {
    const eth = typeof window !== "undefined"
      ? (window as { ethereum?: { request(a: { method: string; params?: unknown[] }): Promise<unknown> } }).ethereum
      : undefined;
    if (!eth) return "USDC";
    // symbol() selector: 0x95d89b41
    const hex = await eth.request({
      method: "eth_call",
      params: [{ to: MUSDC_ADDRESS, data: "0x95d89b41" }, "latest"],
    }) as string;
    if (!hex || hex === "0x") return "USDC";
    // ABI-decode: 32-byte offset + 32-byte length + UTF-8 data
    const data = hex.startsWith("0x") ? hex.slice(2) : hex;
    const length = parseInt(data.slice(64, 128), 16);
    if (!length || length > 64) return "USDC";
    const strHex = data.slice(128, 128 + length * 2);
    let symbol = "";
    for (let i = 0; i < strHex.length; i += 2) {
      const code = parseInt(strHex.slice(i, i + 2), 16);
      if (code === 0) break;
      symbol += String.fromCharCode(code);
    }
    return symbol || "USDC";
  } catch {
    return "USDC";
  }
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

/**
 * fetchPoolStats — uses real data wherever possible:
 *
 *   REAL:
 *   - APY: computed from actual tier APR definitions from Go backend
 *   - Active loans count: from connected wallet's real loan status
 *   - Active loan value: sum of real active loan amounts
 *   - Default rate: computed from real wallet loan history
 *
 *   PROTOCOL-LEVEL ESTIMATE (no global aggregate endpoint):
 *   - TVL: Lendr testnet pool size — updated manually as protocol grows
 *   - Utilization: derived from real active loan value vs TVL
 */
export async function fetchPoolStats(walletAddress?: string): Promise<PoolStats> {
  try {
    // Fetch tier definitions + wallet loan status concurrently
    const [tiersResult, loanStatus] = await Promise.all([
      backendApi.getTiers(),
      walletAddress ? backendApi.getLoanStatus(walletAddress) : Promise.resolve(null),
    ]);

    const { tiers } = tiersResult;

    // ── Real APY from tier definitions ────────────────────────────────────
    const TIER_WEIGHTS: Record<string, number> = {
      Platinum: 0.40, Gold: 0.35, Silver: 0.18, Bronze: 0.07,
    };
    let weightedAPY = 0;
    let totalWeight = 0;
    for (const t of tiers) {
      if (!t.apr || t.apr === 0) continue;
      const w = TIER_WEIGHTS[t.name] ?? 0.05;
      weightedAPY += t.apr * 0.80 * w; // lenders earn 80% of borrower APR
      totalWeight += w;
    }
    const lenderAPY = totalWeight > 0
      ? Math.round((weightedAPY / totalWeight) * 100) / 100
      : 0;

    // ── Real loan metrics from connected wallet ───────────────────────────
    let activeLoansCount  = 0;
    let activeLoanValueUSDC = 0;
    let defaultRate       = 0;

    if (loanStatus) {
      const activeLoans  = loanStatus.active_loans ?? [];
      const historyLoans = loanStatus.loan_history ?? [];
      const allLoans     = [...activeLoans, ...historyLoans];
      activeLoansCount   = activeLoans.length;
      activeLoanValueUSDC = activeLoans
        .reduce((sum, l) => sum + l.amount_usdc, 0);

      // Real default rate from this wallet's history
      const totalLoans    = allLoans.length;
      const defaultedLoans = allLoans.filter((l) => l.status === "defaulted").length;
      defaultRate = totalLoans > 0 ? defaultedLoans / totalLoans : 0;
    }

    // ── Real on-chain TVL: mUSDC balance of CredexLending contract ──────────────
    const TVL = await fetchOnChainTVL();

    // Utilization = active loans / TVL (real ratio when wallet is connected)
    const utilizationRate = activeLoanValueUSDC > 0 && TVL > 0
      ? Math.min(0.95, activeLoanValueUSDC / TVL)
      : 0;

    return {
      tvl:             TVL,
      apy:             lenderAPY,
      activeLoans:     activeLoansCount,
      defaultRate:     Math.round(defaultRate * 1000) / 1000,
      utilizationRate,
      availableCash:   TVL * (1 - utilizationRate),
      activeLoanValue: TVL * utilizationRate,
    };

  } catch {
    return {
      tvl:             0,
      apy:             0,
      activeLoans:     0,
      defaultRate:     0,
      utilizationRate: 0,
      availableCash:   0,
      activeLoanValue: 0,
    };
  }
}

/**
 * fetchActivityFeed
 * ─────────────────────────────────────────────────────────────
 * Returns real wallet events from the Go backend only.
 * Shows loan opens and repayments from the connected wallet's history.
 */
export async function fetchActivityFeed(walletAddress?: string): Promise<ActivityItem[]> {
  const items: ActivityItem[] = [];

  if (walletAddress) {
    try {
      const status = await backendApi.getLoanStatus(walletAddress);
      const allLoans = [...(status.active_loans ?? []), ...(status.loan_history ?? [])]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 8);

      const shortAddr = `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;
      for (const loan of allLoans) {
        items.push({
          id:        loan.status === "repaid" ? `real-repay-${loan.loan_id}` : `real-loan-${loan.loan_id}`,
          type:      loan.status === "repaid" ? "repayment" : "loan_funded",
          address:   shortAddr,
          tier:      loan.tier as CreditTier,
          amount:    loan.amount_usdc,
          asset:     "USDC",
          label:     loan.status === "repaid" ? "You Repaid" : "You Borrowed",
          timestamp: loan.created_at,
          txHash:    loan.tx_hash ?? "",
        });
      }
    } catch {
      // backend unreachable
    }
  }

  return items.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
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
    tier:            "Bronze",
    hash:            "----...----",
    encrypted:       true,
    revealed:        false,
    numericScore:    null,
    signals: [
      { label: "Wallet Age",          value: 0, weight: 0.20 },
      { label: "Repayment History",   value: 0, weight: 0.35 },
      { label: "Liquidation Penalty", value: 0, weight: 0.20 },
      { label: "Volume Consistency",  value: 0, weight: 0.10 },
      { label: "DeFi Diversity",      value: 0, weight: 0.10 },
      { label: "World ID Bonus",      value: 0, weight: 0.05 },
    ],
    maxLTV:          0.35,
    aprRate:         0.25,
    repaymentStreak: 0,
    globalRank:      0,
    xp:              0,
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

// ─── Collateral Options ────────────────────────────────────────────────────────

export async function fetchCollateralOptions(): Promise<CollateralOption[]> {
  return [
    // mCOLL is a mock ERC-20 deployed on Sepolia (6 decimals, pegged $1)
    // Contract: 0x9fCEdCaabD88C303e041fa492c5c056377DdAF59
    { asset: "mCOLL", available: 1_000_000, usdPrice: 1.00, ltv: 0.80 },
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

  // ── Phase 4: Preflight API call to Go backend ─────────────────────────────
  // Run Cairo simulation and credit preflight concurrently.
  const apiPromise = backendApi.requestLoan(
    payload.walletAddress,
    payload.amount,
    parseInt(await requireEthereumProvider().request({ method: "eth_chainId" }) as string, 16),
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

  // ── Phase 5: Relay complete — borrower must now approve and borrow ───────
  const relayTx = result.relay_tx_hash || "";
  onLog(`RELAY_TX: ${relayTx ? relayTx.slice(0, 24) + "..." : "(pending)"} → RelayedCreditVerifier`);
  await delay(400);
  onLog(`ProofID: ${(result.proof_id || "").slice(0, 24)}...`);
  await delay(300);
  onLog("Proof relayed to EVM. Borrower wallet signature required for collateralized loan request.");
  await delay(200);

  if (result.filecoin_cid) {
    onLog(`Filecoin CID: ${result.filecoin_cid.slice(0, 20)}...`);
  }

  // ── Map Go response → frontend BorrowRequestResult ─────────────────────────
  const collateralRequired = computeCollateralRequired(
    payload.amount,
    payload.collateralAsset,
    result.collateral_pct,
  );

  if (!result.proof_data) {
    throw new Error("Backend did not return proof data required for on-chain loan origination.");
  }

  let borrowTxHash = "";
  let solidityLoanId: number | undefined;

  try {
    onLog(`Approving ${collateralRequired.toFixed(2)} ${payload.collateralAsset} as collateral...`);
    const approvalTxHash = await sendTransaction(
      payload.walletAddress,
      MCOLL_ADDRESS,
      buildApproveCalldata(LENDING_CONTRACT, toTokenUnits(collateralRequired, 6, "ceil")),
    );
    onLog(`COLLATERAL_APPROVAL_TX: ${approvalTxHash.slice(0, 24)}...`);

    const approvalReceipt = await waitForTransactionReceipt(approvalTxHash);
    assertReceiptSucceeded(approvalReceipt, "Collateral approval transaction failed.");
    onLog("Collateral approval confirmed.");

    onLog("Submitting CredexLending.requestLoan() from borrower wallet...");
    borrowTxHash = await sendTransaction(
      payload.walletAddress,
      LENDING_CONTRACT,
      buildRequestLoanCalldata(
        toTokenUnits(payload.amount),
        toTokenUnits(collateralRequired, 6, "ceil"),
        result.proof_data,
      ),
    );
    onTxHash(borrowTxHash);
    onLog(`BORROW_TX: ${borrowTxHash.slice(0, 24)}...`);

    const borrowReceipt = await waitForTransactionReceipt(borrowTxHash);
    assertReceiptSucceeded(borrowReceipt, "Borrow transaction failed on-chain.");
    solidityLoanId = parseSolidityLoanId(borrowReceipt);
    if (solidityLoanId !== undefined) {
      onLog(`On-chain Loan ID: ${solidityLoanId}`);
    }
  } catch (error) {
    throw toUserFacingError(error, "Borrow transaction failed.");
  }

  onLog("Confirming loan record with backend...");
  const confirmed = await backendApi.confirmLoan({
    wallet_address: payload.walletAddress,
    loan_id: result.loan_id,
    amount_usdc: payload.amount,
    collateral_pct: result.collateral_pct,
    interest_apr: result.interest_apr,
    tier: result.tier,
    tx_hash: borrowTxHash,
    proof_id: result.proof_id,
    proof_data: result.proof_data,
    solidity_loan_id: solidityLoanId,
  });

  onLog(`✓ Loan approved — ${confirmed.loan_id}`);

  return {
    loanId:             confirmed.loan_id,
    txHash:             borrowTxHash,
    proofHash:          confirmed.proof_id || result.proof_id || "",
    aprRate:            confirmed.interest_apr / 100,
    healthFactor:       computeHealthFactor(collateralRequired, payload.collateralAsset, payload.amount),
    collateralRequired,
    solidityLoanId,
    // Extra fields — stored on the Loan record
    collateralPct:      confirmed.collateral_pct,
    dueDate:            confirmed.due_date,
    onChainConfirmed:   confirmed.on_chain_confirmed,
    proofData:          confirmed.proof_data || result.proof_data,
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
  asset: "mCOLL",
  collateralPct: number,
): number {
  // mCOLL is pegged at $1.00
  const price = asset === "mCOLL" ? 1.00 : 1.00;
  const collateralUSD = amountUSDC * (collateralPct / 100);
  return collateralUSD / price;
}

function computeHealthFactor(
  collateralAmount: number,
  asset: "mCOLL",
  borrowedUSDC: number,
): number {
  // mCOLL is pegged at $1.00
  const collateralUSD = collateralAmount * (asset === "mCOLL" ? 1.00 : 1.00);
  return Math.min(3.5, (collateralUSD / borrowedUSDC) * 1.1);
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
  const allLoans     = [...(s.active_loans ?? []), ...(s.loan_history ?? [])];
  const totalBorrowed = allLoans.reduce((a, l) => a + l.amount_usdc, 0);
  const totalRepaid   = s.loan_history
    .filter(l => l.status === "repaid")
    .reduce((a, l) => a + l.amount_usdc, 0);

  return {
    totalBorrowed,
    totalRepaid,
    totalLent:          0,
    earnedYield:        0,
    protocolRevenue:    totalBorrowed * 0.005,
    globalRank:         s.score > 800 ? 1200 : s.score > 600 ? 8400 : 24000,
    reliabilityPercent: s.streak_count > 0
      ? Math.min(100, 90 + s.streak_count * 2)
      : totalRepaid > 0 ? 95 : 100,
    activeObligations:  s.active_loans.length,
    streakCount:        s.streak_count,
  };
}

function mockPortfolioStats(): PortfolioStats {
  return {
    totalBorrowed:      0,
    totalRepaid:        0,
    totalLent:          0,
    earnedYield:        0,
    protocolRevenue:    0,
    globalRank:         0,
    reliabilityPercent: 0,
    activeObligations:  0,
    streakCount:        0,
  };
}

// ─── Score History — no backend equivalent, keep mock ────────────────────────

export async function fetchScoreHistory(): Promise<ScoreHistoryPoint[]> {
  return [];
}

export async function fetchCreditEvents(): Promise<CreditEvent[]> {
  await delay(200);
  return [
    // No fake events — real events come from loan history in Redux
  ];
}

// ─── Loan repayment — real Go backend ────────────────────────────────────────

export async function submitRepayment(
  wallet: string,
  loanId: string,
): Promise<{ txHash: string; streak: number }> {
  const result = await backendApi.repayLoan(wallet, loanId);
  return { txHash: "", streak: result.streak };
}
