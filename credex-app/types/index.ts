// ─── Wallet ───────────────────────────────────────────────────────────────────
export type WalletStatus = "disconnected" | "connecting" | "connected";
export type CreditTier = "Bronze" | "Silver" | "Gold" | "Platinum";

export interface WalletState {
  status: WalletStatus;
  address: string | null;
  balance: number; // USDC
  collateralBalance: number; // mCOLL
  ethBalance: number;
  tier: CreditTier | null;
  zkProofActive: boolean;
  revealedScore: number | null;
}

// ─── Credit Score ─────────────────────────────────────────────────────────────
export interface CreditSignal {
  label: string;
  value: number; // 0–100
  weight: number;
}

export interface CreditScore {
  tier: CreditTier;
  hash: string;
  encrypted: boolean;
  revealed: boolean;
  numericScore: number | null; // null when encrypted
  signals: CreditSignal[];
  maxLTV: number; // e.g. 0.9 = 90%
  aprRate: number; // e.g. 0.042
  repaymentStreak: number; // days
  globalRank: number;
  xp: number;
  nextTierXP: number;
}

// ─── Loans / Borrowing ────────────────────────────────────────────────────────
export type LoanStatus = "active" | "overdue" | "repaid" | "liquidated";

export interface Loan {
  id: string;
  borrowedAmount: number; // USDC
  collateralAmount: number;
  collateralAsset: "mCOLL";
  aprRate: number;
  healthFactor: number;
  dueDate: string; // ISO string
  repaidPercent: number; // 0–100
  status: LoanStatus;
  openedAt: string;
  txHash: string;
  solidityLoanId?: number; // uint256 loanId from CredexLending.requestLoan()
}

// ─── ZK Proof Flow ────────────────────────────────────────────────────────────
export type ZKStep =
  | "idle"
  | "submitting"
  | "cairo_executing"
  | "proof_generated"
  | "broadcasting"
  | "confirmed"
  | "failed";

export interface ZKProofState {
  step: ZKStep;
  progress: number; // 0–100
  txHash: string | null;
  proofHash: string | null;
  stepLog: string[];
  cairoStep: number;
  totalCairoSteps: number;
  error: string | null;
}

// ─── Borrow Request Payload ───────────────────────────────────────────────────
export interface BorrowRequestPayload {
  amount: number; // USDC
  collateralAsset: "mCOLL";
  duration: 30 | 60 | 90 | 180;
  walletAddress: string;
}

export interface BorrowRequestResult {
  loanId: string;
  txHash: string;
  proofHash: string;
  aprRate: number;
  healthFactor: number;
  collateralRequired: number;
  solidityLoanId?: number; // uint256 from CredexLending contract
  // Go backend extras
  collateralPct?: number;
  dueDate?: string;
  onChainConfirmed?: boolean;
  proofData?: string;
  filecoinCid?: string;
}

// ─── Lending ──────────────────────────────────────────────────────────────────
export interface DepositPayload {
  amount: number; // USDC
  walletAddress: string;
}

export interface DepositResult {
  txHash: string;
  depositedAmount: number;
  sharePercent: number;
  projectedAPY: number;
  timestamp: string;
}

export interface PoolStats {
  tvl: number;
  apy: number;
  activeLoans: number;
  defaultRate: number;
  utilizationRate: number; // 0–1
  availableCash: number;
  activeLoanValue: number;
}

export interface DepositPosition {
  id: string;
  amount: number;
  sharePercent: number;
  earnedYield: number;
  depositedAt: string;
  currentValue: number;
}

// ─── Activity Feed ────────────────────────────────────────────────────────────
export type ActivityType =
  | "loan_funded"
  | "interest_distribution"
  | "borrower_verified"
  | "repayment"
  | "deposit"
  | "withdrawal";

export interface ActivityItem {
  id: string;
  type: ActivityType;
  address: string;
  tier?: CreditTier;
  amount?: number;
  asset?: string;
  timestamp: string;
  txHash: string;
  label: string;
}

// ─── Portfolio ────────────────────────────────────────────────────────────────
export interface PortfolioStats {
  totalBorrowed: number;
  totalRepaid: number;
  totalLent: number;
  earnedYield: number;
  protocolRevenue: number;
  globalRank: number;
  reliabilityPercent: number;
  activeObligations: number;
  streakCount: number;
}

// ─── Score History ────────────────────────────────────────────────────────────
export interface ScoreHistoryPoint {
  date: string;
  score: number;
  tier: CreditTier;
  event?: string;
}

export interface CreditEvent {
  id: string;
  date: string;
  type: "loan" | "repayment" | "default" | "deposit" | "tier_upgrade";
  title: string;
  description: string;
  creditImpact: number; // +/- pts
  tier: CreditTier;
  txHash: string;
}

// ─── API Response Envelope ────────────────────────────────────────────────────
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
  timestamp: string;
}

// ─── Collateral Options ───────────────────────────────────────────────────────
export interface CollateralOption {
  asset: "mCOLL";
  available: number;
  usdPrice: number;
  ltv: number; // max LTV for this asset
}
