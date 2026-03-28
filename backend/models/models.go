package models

import "time"

// ── Loan Status ───────────────────────────────────────────────────────────────

type LoanStatus string

const (
	LoanActive    LoanStatus = "active"
	LoanRepaid    LoanStatus = "repaid"
	LoanDefaulted LoanStatus = "defaulted"
)

// ── Score ─────────────────────────────────────────────────────────────────────

type ScoreRequest struct {
	WalletAddress string `json:"wallet_address" binding:"required"`
	ChainID       int    `json:"chain_id"`
}

type SignalBreakdown struct {
	WalletAgeScore     int  `json:"wallet_age_score"`
	RepaymentScore     int  `json:"repayment_score"`
	LiquidationPenalty int  `json:"liquidation_penalty"`
	VolumeConsistency  int  `json:"volume_consistency"`
	DefiDiversity      int  `json:"defi_diversity"`
	WorldIDBonus       int  `json:"world_id_bonus"`
	RawTotal           int  `json:"raw_total"`
	FinalScore         int  `json:"final_score"`
	WalletAgeDays      int  `json:"wallet_age_days"`
	TotalTransactions  int  `json:"total_transactions"`
	DefiRepayments     int  `json:"defi_repayments"`
	LiquidationCount   int  `json:"liquidation_count"`
	UniqueProtocols    int  `json:"unique_protocols"`
	HasWorldID         bool `json:"has_world_id"`
}

type LoanTerms struct {
	Tier            string   `json:"tier"`
	CollateralPct   *int     `json:"collateral_pct"`
	InterestRateAPR *float64 `json:"interest_rate_apr"`
	MaxLoanUSDC     int      `json:"max_loan_usdc"`
	MinLoanUSDC     int      `json:"min_loan_usdc"`
	Eligible        bool     `json:"eligible"`
}

type ScoreResponse struct {
	WalletAddress  string          `json:"wallet_address"`
	ChainID        int             `json:"chain_id"`
	Score          int             `json:"score"`
	Tier           string          `json:"tier"`
	Signals        SignalBreakdown `json:"signals"`
	LoanTerms      LoanTerms       `json:"loan_terms"`
	ComputedAt     string          `json:"computed_at"`
	Degraded       bool            `json:"degraded"`
	DegradedReason *string         `json:"degraded_reason,omitempty"`
}

// ── Loans ─────────────────────────────────────────────────────────────────────

type LoanRequest struct {
	WalletAddress string  `json:"wallet_address" binding:"required"`
	AmountUSDC    float64 `json:"amount_usdc"    binding:"required"`
	ChainID       int     `json:"chain_id"`
}

type LoanRecord struct {
	LoanID        string     `json:"loan_id"`
	WalletAddress string     `json:"wallet_address"`
	AmountUSDC    float64    `json:"amount_usdc"`
	CollateralPct int        `json:"collateral_pct"`
	InterestAPR   float64    `json:"interest_apr"`
	Tier          string     `json:"tier"`
	Status        LoanStatus `json:"status"`
	CreatedAt     time.Time  `json:"created_at"`
	DueDate       time.Time  `json:"due_date"`
	RepaidAt      *time.Time `json:"repaid_at,omitempty"`
	// On-chain fields — populated after contract interaction
	TxHash           string `json:"tx_hash,omitempty"`
	EncryptedHandle  string `json:"encrypted_handle,omitempty"`
	ZKProofHash      string `json:"zk_proof_hash,omitempty"`
	OnChainConfirmed bool   `json:"on_chain_confirmed"`
}

type LoanRequestResponse struct {
	Success          bool    `json:"success"`
	Message          string  `json:"message"`
	LoanID           string  `json:"loan_id"`
	AmountUSDC       float64 `json:"amount_usdc"`
	CollateralPct    int     `json:"collateral_pct"`
	InterestAPR      float64 `json:"interest_apr"`
	DueDate          string  `json:"due_date"`
	Tier             string  `json:"tier"`
	TxHash           string  `json:"tx_hash,omitempty"`
	OnChainConfirmed bool    `json:"on_chain_confirmed"`
	FilecoinCID      string  `json:"filecoin_cid,omitempty"`
	// Relay fields — returned so the frontend can call CredexLending.requestLoan()
	ProofID     string `json:"proof_id,omitempty"`
	ProofData   string `json:"proof_data,omitempty"`
	RelayTxHash string `json:"relay_tx_hash,omitempty"`
	ProofExpiry string `json:"proof_expiry,omitempty"`
}

type LoanStatusResponse struct {
	WalletAddress string       `json:"wallet_address"`
	Score         int          `json:"score"`
	Tier          string       `json:"tier"`
	ActiveLoans   []LoanRecord `json:"active_loans"`
	LoanHistory   []LoanRecord `json:"loan_history"`
	StreakCount   int          `json:"streak_count"`
}

type RepayRequest struct {
	WalletAddress string `json:"wallet_address" binding:"required"`
	LoanID        string `json:"loan_id"        binding:"required"`
}

// ── Wallet ────────────────────────────────────────────────────────────────────

type RegisterRequest struct {
	WalletAddress  string `json:"wallet_address"   binding:"required"`
	TelegramChatID int64  `json:"telegram_chat_id" binding:"required"`
}

type WalletRecord struct {
	WalletAddress  string    `json:"wallet_address"`
	TelegramChatID int64     `json:"telegram_chat_id"`
	RegisteredAt   time.Time `json:"registered_at"`
}

// ── Notifications ─────────────────────────────────────────────────────────────

type NotifyRequest struct {
	TelegramChatID int64  `json:"telegram_chat_id" binding:"required"`
	Message        string `json:"message"          binding:"required"`
}

// ── Tiers ─────────────────────────────────────────────────────────────────────

type TierDef struct {
	Name          string  `json:"name"`
	MinScore      int     `json:"min_score"`
	MaxScore      int     `json:"max_score"`
	CollateralPct int     `json:"collateral_pct"`
	APR           float64 `json:"apr"`
	MaxLoanUSDC   int     `json:"max_loan_usdc"`
}

// ── Relayer / Chain ───────────────────────────────────────────────────────────

// EncryptResult is returned by the FHE encryption step
type EncryptResult struct {
	Handle string `json:"handle"` // euint32 ciphertext handle
	Proof  string `json:"proof"`  // input proof for contract verification
	Mocked bool   `json:"mocked"` // true if real Zama relayer was unavailable
}

// ZKProofResult is returned by the Cairo proof generation step
type ZKProofResult struct {
	Proof      []byte `json:"proof"`       // proof bytes
	ProofHash  string `json:"proof_hash"`  // hex hash of proof
	ScoreAbove int    `json:"score_above"` // threshold that was proven
	Mocked     bool   `json:"mocked"`      // true if Cairo prover was unavailable
}

// RelayResult is returned after the backend relays a proof from Starknet to EVM.
type RelayResult struct {
	// ProofID is the 0x-prefixed bytes32 identifier stored in RelayedCreditVerifier.
	ProofID string `json:"proof_id"`
	// ProofData is the abi.encode(proofId) hex string the frontend passes to
	// CredexLending.requestLoan() as the proofData bytes argument.
	ProofData string `json:"proof_data"`
	// RelayTxHash is the EVM transaction hash for the relay() call.
	RelayTxHash string `json:"relay_tx_hash"`
	// ProofExpiry is the Unix timestamp after which the proof is no longer valid.
	ProofExpiry int64 `json:"proof_expiry"`
	// StarknetUsed is true when the proof was sourced from the live Starknet contract.
	StarknetUsed bool `json:"starknet_used"`
	// Mocked is true when the EVM relay transaction was simulated (contract not configured).
	Mocked bool `json:"mocked"`
}

// ChainSubmitResult is returned after submitting the loan tx on-chain
type ChainSubmitResult struct {
	TxHash    string `json:"tx_hash"`
	Confirmed bool   `json:"confirmed"`
	Mocked    bool   `json:"mocked"` // true if contract address not yet configured
}

// FilecoinStoreResult is returned after storing proof on Filecoin
type FilecoinStoreResult struct {
	CID    string `json:"cid"`
	Mocked bool   `json:"mocked"`
}

type DepositRecord struct {
	DepositID     string    `json:"deposit_id"`
	WalletAddress string    `json:"wallet_address"`
	AmountUSDC    float64   `json:"amount_usdc"`
	SharePercent  float64   `json:"share_percent"`
	EarnedYield   float64   `json:"earned_yield"`
	DepositedAt   time.Time `json:"deposited_at"`
	CurrentValue  float64   `json:"current_value"`
	TxHash        string    `json:"tx_hash"`
}
