/**
 * backendApi.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Typed fetch wrappers for every Go backend endpoint.
 * All functions throw on network or non-2xx errors.
 * The Go backend itself mocks any unconfigured external services,
 * so the frontend never needs to handle "backend not available" gracefully —
 * it always gets a valid JSON response.
 *
 * In development:  calls http://localhost:8000 directly (CORS is * on the Go side)
 * In production:   calls /api/backend/* which Next.js proxies to NEXT_PUBLIC_API_URL
 */

// ─── URL resolution ────────────────────────────────────────────────────────────
function apiURL(path: string): string {
  // In browser: use the env var directly (CORS is open on Go side)
  // In server (SSR): use the proxy path
  if (typeof window !== "undefined") {
    const base = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    return `${base}${path}`;
  }
  // SSR — use relative proxy path
  return `/api/backend${path}`;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(apiURL(path), {
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GET ${path} → ${res.status}: ${body}`);
  }
  return res.json();
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(apiURL(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // Try to parse Go error envelope
    try {
      const parsed = JSON.parse(text);
      throw new Error(parsed.error || `POST ${path} → ${res.status}`);
    } catch {
      throw new Error(`POST ${path} → ${res.status}: ${text}`);
    }
  }
  return res.json();
}

// ─── Go model types (mirrors models/models.go) ──────────────────────────────────

export interface GoSignalBreakdown {
  wallet_age_score:     number;
  repayment_score:      number;
  liquidation_penalty:  number;
  volume_consistency:   number;
  defi_diversity:       number;
  world_id_bonus:       number;
  raw_total:            number;
  final_score:          number;
  wallet_age_days:      number;
  total_transactions:   number;
  defi_repayments:      number;
  liquidation_count:    number;
  unique_protocols:     number;
  has_world_id:         boolean;
}

export interface GoLoanTerms {
  tier:             string;
  collateral_pct:   number | null;
  interest_rate_apr: number | null;
  max_loan_usdc:    number;
  min_loan_usdc:    number;
  eligible:         boolean;
}

export interface GoScoreResponse {
  wallet_address: string;
  chain_id:       number;
  score:          number;
  tier:           string;
  signals:        GoSignalBreakdown;
  loan_terms:     GoLoanTerms;
  computed_at:    string;
  degraded:       boolean;
  degraded_reason?: string;
}

export interface GoLoanRecord {
  loan_id:           string;
  wallet_address:    string;
  amount_usdc:       number;
  collateral_pct:    number;
  interest_apr:      number;
  tier:              string;
  status:            "active" | "repaid" | "defaulted";
  created_at:        string;
  due_date:          string;
  repaid_at?:        string;
  tx_hash?:          string;
  encrypted_handle?: string;
  zk_proof_hash?:    string;
  on_chain_confirmed: boolean;
}

export interface GoLoanRequestResponse {
  success:           boolean;
  message:           string;
  loan_id:           string;
  amount_usdc:       number;
  collateral_pct:    number;
  interest_apr:      number;
  due_date:          string;
  tier:              string;
  tx_hash?:          string;
  on_chain_confirmed: boolean;
  filecoin_cid?:     string;
  proof_id?:         string;
  proof_data?:       string;
  relay_tx_hash?:    string;
  proof_expiry?:     string;
}

export interface GoLoanStatusResponse {
  wallet_address: string;
  score:          number;
  tier:           string;
  active_loans:   GoLoanRecord[];
  loan_history:   GoLoanRecord[];
  streak_count:   number;
}

export interface GoTierDef {
  name:           string;
  min_score:      number;
  max_score:      number;
  collateral_pct: number;
  apr:            number;
  max_loan_usdc:  number;
}

export interface GoHealthResponse {
  status:               string;
  service:              string;
  version:              string;
  time:                 string;
  scoring_engine:       string;
  fhe_configured:       boolean;
  zk_configured:        boolean;
  chain_configured:     boolean;
  filecoin_configured:  boolean;
}

export interface GoRegisterResponse {
  success:          boolean;
  wallet_address:   string;
  telegram_chat_id: number;
  registered_at:    string;
}

// ─── Typed API functions ──────────────────────────────────────────────────────

export interface GoDepositResponse {
  deposit_id:    string;
  wallet:        string;
  amount_usdc:   number;
  share_percent: number;
  apy:           number;
  tx_hash:       string;
  deposited_at:  string;
  message:       string;
}

export interface GoDepositRecord {
  deposit_id:     string;
  wallet_address: string;
  amount_usdc:    number;
  share_percent:  number;
  earned_yield:   number;
  deposited_at:   string;
  current_value:  number;
  tx_hash:        string;
}

export interface GoDepositsResponse {
  wallet:          string;
  deposits:        GoDepositRecord[];
  total_deposited: number;
  total_earned:    number;
  total_value:     number;
}

export const backendApi = {

  health: () =>
    get<GoHealthResponse>("/health"),

  // Score
  getScore: (wallet: string) =>
    get<GoScoreResponse>(`/api/v1/score/${wallet}`),

  computeScore: (wallet: string, chainId = 11155111) =>
    post<GoScoreResponse>("/api/v1/score", { wallet_address: wallet, chain_id: chainId }),

  // Loans
  requestLoan: (wallet: string, amountUsdc: number, chainId = 11155111) =>
    post<GoLoanRequestResponse>("/api/v1/loan/request", {
      wallet_address: wallet,
      amount_usdc:    amountUsdc,
      chain_id:       chainId,
    }),

  getLoanStatus: (wallet: string) =>
    get<GoLoanStatusResponse>(`/api/v1/loan/status/${wallet}`),

  repayLoan: (wallet: string, loanId: string) =>
    post<{ success: boolean; message: string; loan_id: string; repaid_at: string; streak: number }>(
      "/api/v1/loan/repay",
      { wallet_address: wallet, loan_id: loanId }
    ),

  // Wallet
  registerWallet: (wallet: string, telegramChatId?: number) =>
    post<GoRegisterResponse>("/api/v1/wallet/register", {
      wallet_address:   wallet,
      // Only send telegram_chat_id if provided and non-zero
      // Go backend's required tag rejects 0
      ...(telegramChatId ? { telegram_chat_id: telegramChatId } : {}),
    }),

  // Tiers
  getTiers: () =>
    get<{ tiers: GoTierDef[]; source?: string }>("/api/v1/tiers"),

  // Deposits
  deposit: (wallet: string, amountUsdc: number) =>
    post<GoDepositResponse>("/api/v1/deposit", {
      wallet_address: wallet,
      amount_usdc:    amountUsdc,
    }),

  getDeposits: (wallet: string) =>
    get<GoDepositsResponse>(`/api/v1/deposit/${wallet}`),
};
