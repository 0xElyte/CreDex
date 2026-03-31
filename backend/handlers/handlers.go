package handlers

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"credex-backend/chain"
	"credex-backend/fhe"
	"credex-backend/models"
	"credex-backend/relayer"
	"credex-backend/store"
)

var walletRE = regexp.MustCompile(`^0x[0-9a-fA-F]{40}$`)
var txHashRE = regexp.MustCompile(`^0x[0-9a-fA-F]{64}$`)

// H holds all shared dependencies injected at startup
type H struct {
	Store    *store.Store
	FHE      *fhe.RelayerClient
	ZK       *relayer.ZKProver
	Chain    *chain.Submitter
	Filecoin *chain.FilecoinStore
	Starknet *relayer.StarknetClient
	Relay    *chain.Relayer
	Lending  *chain.LendingCaller
}

// ── Health ────────────────────────────────────────────────────────────────────

func (h *H) Health(c *gin.Context) {
	scoringStatus := h.pingScoringEngine()

	c.JSON(http.StatusOK, gin.H{
		"status":         "ok",
		"service":        "credex-backend",
		"version":        "1.0.0",
		"time":           time.Now().UTC().Format(time.RFC3339),
		"scoring_engine": scoringStatus,
		"fhe_configured": os.Getenv("ZAMA_RELAYER_URL") != "",
		"zk_configured":  os.Getenv("CAIRO_PROVER_URL") != "",
		"chain_configured": os.Getenv("LENDING_CONTRACT_ADDRESS") != "" &&
			os.Getenv("LENDING_CONTRACT_ADDRESS") != "0x0000000000000000000000000000000000000000",
		"filecoin_configured": os.Getenv("FILECOIN_API_KEY") != "" &&
			os.Getenv("FILECOIN_API_KEY") != "your_filecoin_api_key_here",
	})
}

func (h *H) pingScoringEngine() string {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", scoringEngineURL()+"/health", nil)
	if resp, err := http.DefaultClient.Do(req); err == nil {
		resp.Body.Close()
		return "ok"
	}
	return "unreachable"
}

// ── Wallet Registration ───────────────────────────────────────────────────────

func (h *H) RegisterWallet(c *gin.Context) {
	var req models.RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	wallet := strings.ToLower(strings.TrimSpace(req.WalletAddress))

	if err := validateWallet(wallet); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// TelegramChatID is optional — 0 means Telegram notifications are not configured
	if req.TelegramChatID < 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "telegram_chat_id must be a non-negative integer"})
		return
	}

	rec := h.Store.RegisterWallet(wallet, req.TelegramChatID)
	c.JSON(http.StatusOK, gin.H{
		"success":          true,
		"wallet_address":   rec.WalletAddress,
		"telegram_chat_id": rec.TelegramChatID,
		"registered_at":    rec.RegisteredAt,
	})
}

// ── Score ─────────────────────────────────────────────────────────────────────

func (h *H) ComputeScore(c *gin.Context) {
	var req models.ScoreRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.ChainID == 0 {
		req.ChainID = 11155111
	}

	wallet := strings.ToLower(strings.TrimSpace(req.WalletAddress))
	if err := validateWallet(wallet); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	result, err := h.fetchScore(wallet, req.ChainID)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Scoring engine unavailable. Please try again."})
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *H) GetScore(c *gin.Context) {
	wallet := strings.ToLower(strings.TrimSpace(c.Param("wallet")))
	if err := validateWallet(wallet); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	result, err := h.fetchScore(wallet, 11155111)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Scoring engine unavailable. Please try again."})
		return
	}
	c.JSON(http.StatusOK, result)
}

// ── Loans ─────────────────────────────────────────────────────────────────────

func (h *H) RequestLoan(c *gin.Context) {
	var req models.LoanRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.ChainID == 0 {
		req.ChainID = 11155111
	}

	wallet := strings.ToLower(strings.TrimSpace(req.WalletAddress))

	if err := validateWallet(wallet); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.AmountUSDC <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Loan amount must be greater than 0"})
		return
	}
	if req.AmountUSDC < store.MinLoanUSDC {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   fmt.Sprintf("Minimum loan amount is $%.0f USDC", store.MinLoanUSDC),
			"minimum": store.MinLoanUSDC,
		})
		return
	}
	if req.AmountUSDC > store.MaxLoanUSDC {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   fmt.Sprintf("Maximum loan amount is $%.0f USDC", store.MaxLoanUSDC),
			"maximum": store.MaxLoanUSDC,
		})
		return
	}
	if h.Store.HasActiveLoan(wallet) {
		c.JSON(http.StatusConflict, gin.H{"error": "This wallet already has an active loan. Repay it before borrowing again."})
		return
	}

	score, err := h.fetchScore(wallet, req.ChainID)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Cannot process loan — scoring engine unavailable"})
		return
	}

	if score.Degraded {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error":  "Cannot approve loan — credit score is incomplete. Please try again shortly.",
			"reason": score.DegradedReason,
		})
		return
	}

	if !score.LoanTerms.Eligible {
		c.JSON(http.StatusForbidden, gin.H{
			"error":  "Wallet is not eligible for a loan",
			"score":  score.Score,
			"tier":   score.Tier,
			"reason": "Credit score below minimum threshold of 400",
		})
		return
	}

	if req.AmountUSDC > float64(score.LoanTerms.MaxLoanUSDC) {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":     fmt.Sprintf("Amount exceeds your %s tier maximum of $%d USDC", score.Tier, score.LoanTerms.MaxLoanUSDC),
			"requested": req.AmountUSDC,
			"maximum":   score.LoanTerms.MaxLoanUSDC,
			"tier":      score.Tier,
		})
		return
	}

	collateralPct := 100
	interestAPR := 25.0
	if score.LoanTerms.CollateralPct != nil {
		collateralPct = *score.LoanTerms.CollateralPct
	}
	if score.LoanTerms.InterestRateAPR != nil {
		interestAPR = *score.LoanTerms.InterestRateAPR
	}
	if collateralPct < 0 || collateralPct > 100 {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Invalid collateral percentage from scoring engine"})
		return
	}

	snResult, err := h.Starknet.ValidateCredit(wallet, score.Score, req.AmountUSDC)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to validate credit via Starknet — please try again"})
		return
	}

	relayResult, err := h.Relay.RelayProof(wallet, snResult)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to relay proof to EVM — please try again"})
		return
	}

	// ── Step 7: Prepare provisional loan metadata only ────────────────────────
	now := time.Now().UTC()
	loanID := fmt.Sprintf("LOAN-%s-%d", wallet[2:8], now.UnixMilli())
	dueDate := now.AddDate(0, 0, store.LoanTermDays)

	// ── Step 8: Async — persist proof metadata / notify only ─────────────────
	go func() {
		defer func() {
			if r := recover(); r != nil {
				fmt.Printf("[WARN] Async post-loan panic: %v\n", r)
			}
		}()

		// 1. Filecoin
		if _, err := h.Filecoin.StoreProofMetadata(
			wallet, loanID,
			relayResult.ProofID, relayResult.ProofData,
			score.Score, score.Tier,
		); err != nil {
			fmt.Printf("[WARN] Filecoin storage failed for %s: %v\n", loanID, err)
		}

		// 2. Telegram
		if chatID := h.Store.GetChatID(wallet); chatID != 0 {
			msg := fmt.Sprintf(
				"*Loan Ready For Signature*\n\n"+
					"Amount: *$%.0f USDC*\n"+
					"Tier: *%s*\n"+
					"Collateral: *%d%%*\n"+
					"Interest: *%.1f%% APR*\n"+
					"Due: *%s*\n"+
					"Loan ID: `%s`\n"+
					"Starknet Proof: %v\n"+
					"Relay Tx: `%s`\n\n"+
					"Next step: submit the collateralized borrow transaction from your wallet.",
				req.AmountUSDC, score.Tier, collateralPct, interestAPR,
				dueDate.Format("Jan 2, 2006"),
				loanID,
				relayResult.StarknetUsed,
				relayResult.RelayTxHash,
			)
			if err := sendTelegram(chatID, msg); err != nil {
				fmt.Printf("[WARN] Telegram notification failed: %v\n", err)
			}
		}
	}()

	h.Store.InvalidateScore(wallet, req.ChainID)

	c.JSON(http.StatusOK, models.LoanRequestResponse{
		Success:          true,
		Message:          fmt.Sprintf("Credit proof ready. %d%% collateral required. Submit CredexLending.requestLoan() from the borrower wallet.", collateralPct),
		LoanID:           loanID,
		AmountUSDC:       req.AmountUSDC,
		CollateralPct:    collateralPct,
		InterestAPR:      interestAPR,
		DueDate:          dueDate.Format(time.RFC3339),
		Tier:             score.Tier,
		OnChainConfirmed: false,
		ProofID:          relayResult.ProofID,
		ProofData:        relayResult.ProofData,
		RelayTxHash:      relayResult.RelayTxHash,
		ProofExpiry:      fmt.Sprintf("%d", relayResult.ProofExpiry),
	})
}

func (h *H) ConfirmLoan(c *gin.Context) {
	var req models.LoanConfirmRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	wallet := strings.ToLower(strings.TrimSpace(req.WalletAddress))
	if err := validateWallet(wallet); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if strings.TrimSpace(req.LoanID) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "loan_id cannot be empty"})
		return
	}
	if req.AmountUSDC < store.MinLoanUSDC || req.AmountUSDC > store.MaxLoanUSDC {
		c.JSON(http.StatusBadRequest, gin.H{"error": "amount_usdc out of supported range"})
		return
	}
	if req.CollateralPct < 0 || req.CollateralPct > 100 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "collateral_pct must be between 0 and 100"})
		return
	}
	if strings.TrimSpace(req.Tier) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "tier cannot be empty"})
		return
	}
	if !txHashRE.MatchString(strings.TrimSpace(req.TxHash)) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "tx_hash must be a 32-byte hex string"})
		return
	}

	now := time.Now().UTC()
	loan := &models.LoanRecord{
		LoanID:           strings.TrimSpace(req.LoanID),
		WalletAddress:    wallet,
		AmountUSDC:       req.AmountUSDC,
		CollateralPct:    req.CollateralPct,
		InterestAPR:      req.InterestAPR,
		Tier:             strings.TrimSpace(req.Tier),
		Status:           models.LoanActive,
		CreatedAt:        now,
		DueDate:          now.AddDate(0, 0, store.LoanTermDays),
		TxHash:           strings.TrimSpace(req.TxHash),
		EncryptedHandle:  req.ProofData,
		ZKProofHash:      req.ProofID,
		OnChainConfirmed: true,
		SolidityLoanID:   req.SolidityLoanID,
	}

	if err := h.Store.CreateLoanIfNoActive(loan); err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}

	h.Store.InvalidateScore(wallet, 11155111)

	go func() {
		defer func() {
			if r := recover(); r != nil {
				fmt.Printf("[WARN] Async confirm panic: %v\n", r)
			}
		}()

		if chatID := h.Store.GetChatID(wallet); chatID != 0 {
			msg := fmt.Sprintf(
				"*Loan Confirmed On-Chain*\n\n"+
					"Amount: *$%.0f USDC*\n"+
					"Tier: *%s*\n"+
					"Collateral: *%d%%*\n"+
					"Interest: *%.1f%% APR*\n"+
					"Due: *%s*\n"+
					"Loan ID: `%s`\n"+
					"Tx: `%s`",
				req.AmountUSDC, loan.Tier, req.CollateralPct, req.InterestAPR,
				loan.DueDate.Format("Jan 2, 2006"),
				loan.LoanID,
				loan.TxHash,
			)
			if err := sendTelegram(chatID, msg); err != nil {
				fmt.Printf("[WARN] Telegram confirm notification failed: %v\n", err)
			}
		}
	}()

	c.JSON(http.StatusOK, models.LoanRequestResponse{
		Success:          true,
		Message:          "Loan confirmed on-chain and recorded by backend",
		LoanID:           loan.LoanID,
		AmountUSDC:       loan.AmountUSDC,
		CollateralPct:    loan.CollateralPct,
		InterestAPR:      loan.InterestAPR,
		DueDate:          loan.DueDate.Format(time.RFC3339),
		Tier:             loan.Tier,
		TxHash:           loan.TxHash,
		OnChainConfirmed: true,
		ProofID:          req.ProofID,
		ProofData:        req.ProofData,
		SolidityLoanID:   req.SolidityLoanID,
	})
}

func (h *H) GetLoanStatus(c *gin.Context) {
	wallet := strings.ToLower(strings.TrimSpace(c.Param("wallet")))
	if err := validateWallet(wallet); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	scoreVal := 0
	tierStr := "Unknown"
	if cached, ok := h.Store.GetCachedScore(wallet, 11155111); ok {
		scoreVal = cached.Score
		tierStr = cached.Tier
	}

	all := h.Store.GetLoansForWallet(wallet)
	active := h.Store.GetActiveLoans(wallet)

	history := []models.LoanRecord{}
	for _, l := range all {
		if l.Status == models.LoanRepaid || l.Status == models.LoanDefaulted {
			history = append(history, l)
		}
	}

	c.JSON(http.StatusOK, models.LoanStatusResponse{
		WalletAddress: wallet,
		Score:         scoreVal,
		Tier:          tierStr,
		ActiveLoans:   active,
		LoanHistory:   history,
		StreakCount:   h.Store.GetStreak(wallet),
	})
}

func (h *H) RepayLoan(c *gin.Context) {
	var req models.RepayRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	wallet := strings.ToLower(strings.TrimSpace(req.WalletAddress))
	if err := validateWallet(wallet); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	loanID := strings.TrimSpace(req.LoanID)
	if loanID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "loan_id cannot be empty"})
		return
	}

	loan, err := h.Store.MarkRepaidIfActive(loanID, wallet)
	if err != nil {
		msg := err.Error()
		switch {
		case strings.Contains(msg, "not found"):
			c.JSON(http.StatusNotFound, gin.H{"error": msg})
		case strings.Contains(msg, "does not belong"):
			c.JSON(http.StatusForbidden, gin.H{"error": msg})
		default:
			c.JSON(http.StatusConflict, gin.H{"error": msg})
		}
		return
	}

	h.Store.InvalidateScore(wallet, 11155111)
	streak := h.Store.GetStreak(wallet)

	go func() {
		defer func() {
			if r := recover(); r != nil {
				fmt.Printf("[WARN] Async repay panic: %v\n", r)
			}
		}()

		chainResult, err := h.Chain.SubmitRepayment(wallet, loanID)
		if err != nil {
			fmt.Printf("[WARN] Repayment chain submission failed: %v\n", err)
		} else {
			fmt.Printf("[INFO] Repayment on-chain: %s (mocked=%v)\n",
				chainResult.TxHash[:18]+"...", chainResult.Mocked)
		}

		if chatID := h.Store.GetChatID(wallet); chatID != 0 {
			msg := fmt.Sprintf(
				"💚 *Loan Repaid!*\n\nLoan ID: `%s`\nAmount: *$%.0f USDC*\nStreak: *%d* 🔥",
				loanID, loan.AmountUSDC, streak,
			)
			if streak > 0 && streak%3 == 0 {
				msg += "\n\n⬆️ *Tier upgrade unlocked!*"
			}
			sendTelegram(chatID, msg)
		}
	}()

	c.JSON(http.StatusOK, gin.H{
		"success":   true,
		"message":   "Loan repaid successfully",
		"loan_id":   loanID,
		"repaid_at": loan.RepaidAt,
		"streak":    streak,
	})
}

// ── Tiers ─────────────────────────────────────────────────────────────────────

func (h *H) GetTiers(c *gin.Context) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	req, _ := http.NewRequestWithContext(ctx, "GET", scoringEngineURL()+"/tiers", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"tiers": []models.TierDef{
				{Name: "Platinum", MinScore: 850, MaxScore: 1000, CollateralPct: 20, APR: 4.0, MaxLoanUSDC: 10000},
				{Name: "Gold", MinScore: 700, MaxScore: 849, CollateralPct: 35, APR: 8.0, MaxLoanUSDC: 5000},
				{Name: "Silver", MinScore: 550, MaxScore: 699, CollateralPct: 50, APR: 14.0, MaxLoanUSDC: 2000},
				{Name: "Bronze", MinScore: 400, MaxScore: 549, CollateralPct: 65, APR: 22.0, MaxLoanUSDC: 500},
				{Name: "Denied", MinScore: 0, MaxScore: 399, CollateralPct: 0, APR: 0, MaxLoanUSDC: 0},
			},
			"source": "fallback",
		})
		return
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	c.Data(resp.StatusCode, "application/json", body)
}

// ── Notifications ─────────────────────────────────────────────────────────────

func (h *H) SendNotification(c *gin.Context) {
	var req models.NotifyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if strings.TrimSpace(req.Message) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "message cannot be empty"})
		return
	}
	if len(req.Message) > 4096 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": fmt.Sprintf("message too long (%d chars), Telegram limit is 4096", len(req.Message)),
		})
		return
	}

	if err := sendTelegram(req.TelegramChatID, req.Message); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// ── Deposits ──────────────────────────────────────────────────────────────────

type DepositRequest struct {
	WalletAddress string  `json:"wallet_address" binding:"required"`
	AmountUSDC    float64 `json:"amount_usdc"    binding:"required,gt=0"`
}

func (h *H) Deposit(c *gin.Context) {
	var req DepositRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	wallet := strings.ToLower(req.WalletAddress)

	const MinDepositUSDC = 10.0
	if req.AmountUSDC < MinDepositUSDC {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": fmt.Sprintf("Minimum deposit is $%.0f USDC", MinDepositUSDC),
		})
		return
	}

	depositID := fmt.Sprintf("DEP-%s-%d",
		strings.ToUpper(wallet[2:6]),
		time.Now().UnixMilli()%100000,
	)

	const ProtocolTVL = 142_509_211.0
	sharePercent := req.AmountUSDC / ProtocolTVL
	txHash := fmt.Sprintf("0x%x", time.Now().UnixNano())

	record := &models.DepositRecord{
		DepositID:     depositID,
		WalletAddress: wallet,
		AmountUSDC:    req.AmountUSDC,
		SharePercent:  sharePercent,
		EarnedYield:   0,
		DepositedAt:   time.Now().UTC(),
		CurrentValue:  req.AmountUSDC,
		TxHash:        txHash,
	}

	h.Store.CreateDeposit(record)

	// Call CredexLending.supplyLiquidity() on-chain asynchronously
	go func() {
		result, err := h.Lending.SupplyLiquidityOnChain(req.AmountUSDC)
		if err != nil {
			fmt.Printf("[WARN] supplyLiquidity failed: %v\n", err)
		} else if result != nil && !result.Mocked {
			fmt.Printf("[CHAIN] supplyLiquidity on-chain: %s\n", result.TxHash)
		}
	}()

	c.JSON(http.StatusCreated, gin.H{
		"deposit_id":    depositID,
		"wallet":        wallet,
		"amount_usdc":   req.AmountUSDC,
		"share_percent": sharePercent,
		"apy":           14.82,
		"tx_hash":       txHash,
		"deposited_at":  record.DepositedAt,
		"message":       "Deposit recorded. Earning yield immediately.",
	})
}

func (h *H) GetDeposits(c *gin.Context) {
	wallet := strings.ToLower(c.Param("wallet"))
	if wallet == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "wallet address required"})
		return
	}

	deposits := h.Store.GetDepositsForWallet(wallet)

	now := time.Now().UTC()
	const APY = 0.1482
	totalDeposited := 0.0
	totalEarned := 0.0

	for i := range deposits {
		elapsed := now.Sub(deposits[i].DepositedAt).Hours() / (24 * 365)
		deposits[i].EarnedYield = deposits[i].AmountUSDC * APY * elapsed
		deposits[i].CurrentValue = deposits[i].AmountUSDC + deposits[i].EarnedYield
		totalDeposited += deposits[i].AmountUSDC
		totalEarned += deposits[i].EarnedYield
	}

	c.JSON(http.StatusOK, gin.H{
		"wallet":          wallet,
		"deposits":        deposits,
		"total_deposited": totalDeposited,
		"total_earned":    totalEarned,
		"total_value":     totalDeposited + totalEarned,
	})
}

// ── Internal Helpers ──────────────────────────────────────────────────────────

func validateWallet(wallet string) error {
	if wallet == "" {
		return fmt.Errorf("wallet address cannot be empty")
	}
	if !walletRE.MatchString(wallet) {
		return fmt.Errorf("invalid wallet address — must be 0x + 40 hex characters")
	}
	if wallet == "0x"+strings.Repeat("0", 40) {
		return fmt.Errorf("zero address is not valid")
	}
	return nil
}

func scoringEngineURL() string {
	url := os.Getenv("SCORING_ENGINE_URL")
	if url == "" {
		return "http://localhost:8001"
	}
	return strings.TrimRight(url, "/")
}

func (h *H) fetchScore(wallet string, chainID int) (*models.ScoreResponse, error) {
	if cached, ok := h.Store.GetCachedScore(wallet, chainID); ok {
		return cached, nil
	}
	result, err := callScoringEngine(wallet, chainID)
	if err != nil {
		return nil, err
	}
	h.Store.SetCachedScore(wallet, chainID, result)
	return result, nil
}

func callScoringEngine(wallet string, chainID int) (*models.ScoreResponse, error) {
	url := scoringEngineURL()

	payload, err := json.Marshal(map[string]interface{}{
		"wallet_address": wallet,
		"chain_id":       chainID,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to marshal score request: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "POST", url+"/score", bytes.NewBuffer(payload))
	if err != nil {
		return nil, fmt.Errorf("failed to build score request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return nil, fmt.Errorf("scoring engine timed out after 45s")
		}
		return nil, fmt.Errorf("scoring engine unreachable: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("failed to read score response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("scoring engine returned %d: %s", resp.StatusCode, string(body))
	}
	if len(body) == 0 {
		return nil, fmt.Errorf("scoring engine returned empty response")
	}

	var result models.ScoreResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("failed to decode score response: %w", err)
	}

	if result.Score < 0 || result.Score > 1000 {
		return nil, fmt.Errorf("scoring engine returned invalid score %d", result.Score)
	}

	return &result, nil
}

func sendTelegram(chatID int64, text string) error {
	token := os.Getenv("TELEGRAM_BOT_TOKEN")
	if token == "" {
		return fmt.Errorf("TELEGRAM_BOT_TOKEN not configured")
	}
	if strings.TrimSpace(text) == "" {
		return fmt.Errorf("telegram message cannot be empty")
	}
	if len(text) > 4096 {
		text = text[:4090] + "..."
	}

	payload, _ := json.Marshal(map[string]interface{}{
		"chat_id":    chatID,
		"text":       text,
		"parse_mode": "Markdown",
	})

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	req, _ := http.NewRequestWithContext(
		ctx, "POST",
		fmt.Sprintf("https://api.telegram.org/bot%s/sendMessage", token),
		bytes.NewBuffer(payload),
	)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("telegram request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("telegram API %d: %s", resp.StatusCode, string(b))
	}
	return nil
}

type DepositRequest struct {
	WalletAddress string  `json:"wallet_address" binding:"required"`
	AmountUSDC    float64 `json:"amount_usdc"    binding:"required,gt=0"`
}

func (h *H) Deposit(c *gin.Context) {
	var req DepositRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	wallet := strings.ToLower(req.WalletAddress)
	if err := validateWallet(wallet); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	const MinDepositUSDC = 10.0
	if req.AmountUSDC < MinDepositUSDC {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": fmt.Sprintf("Minimum deposit is $%.0f USDC", MinDepositUSDC),
		})
		return
	}

	depositID := fmt.Sprintf("DEP-%s-%d",
		strings.ToUpper(wallet[2:6]),
		time.Now().UnixMilli()%100000,
	)

	const ProtocolTVL = 142_509_211.0
	sharePercent := req.AmountUSDC / ProtocolTVL

	// Generate a deterministic 66-char mock tx hash (0x + 64 hex)
	hashInput := fmt.Sprintf("deposit:%s:%s:%d", depositID, wallet, time.Now().UnixNano())
	hashSum := sha256.Sum256([]byte(hashInput))
	txHash := "0x" + hex.EncodeToString(hashSum[:])

	record := &models.DepositRecord{
		DepositID:     depositID,
		WalletAddress: wallet,
		AmountUSDC:    req.AmountUSDC,
		SharePercent:  sharePercent,
		EarnedYield:   0,
		DepositedAt:   time.Now().UTC(),
		CurrentValue:  req.AmountUSDC,
		TxHash:        txHash,
	}

	h.Store.CreateDeposit(record)

	c.JSON(http.StatusCreated, gin.H{
		"deposit_id":    depositID,
		"wallet":        wallet,
		"amount_usdc":   req.AmountUSDC,
		"share_percent": sharePercent,
		"apy":           14.82,
		"tx_hash":       txHash,
		"deposited_at":  record.DepositedAt,
		"message":       "Deposit recorded. Earning yield immediately.",
	})
}

func (h *H) GetDeposits(c *gin.Context) {
	wallet := strings.ToLower(c.Param("wallet"))
	if wallet == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "wallet address required"})
		return
	}

	deposits := h.Store.GetDepositsForWallet(wallet)

	now := time.Now().UTC()
	const APY = 0.1482
	totalDeposited := 0.0
	totalEarned := 0.0

	for i := range deposits {
		elapsed := now.Sub(deposits[i].DepositedAt).Hours() / (24 * 365)
		deposits[i].EarnedYield = deposits[i].AmountUSDC * APY * elapsed
		deposits[i].CurrentValue = deposits[i].AmountUSDC + deposits[i].EarnedYield
		totalDeposited += deposits[i].AmountUSDC
		totalEarned += deposits[i].EarnedYield
	}

	c.JSON(http.StatusOK, gin.H{
		"wallet":          wallet,
		"deposits":        deposits,
		"total_deposited": totalDeposited,
		"total_earned":    totalEarned,
		"total_value":     totalDeposited + totalEarned,
	})
}
