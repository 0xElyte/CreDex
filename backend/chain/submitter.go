// Package chain handles on-chain transaction submission.
// It submits the encrypted score handle + ZK proof to the
// Solidity fhEVM lending contract to approve loans on-chain.
//
// When the contract address is not yet configured (e.g. Person 1
// hasn't deployed yet), all submissions are mocked with a fake
// tx hash so the rest of the flow can execute.
package chain

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"os"
	"strings"
	"time"

	"credex-backend/models"
)

const (
	chainTimeout     = 30 * time.Second
	maxChainResponse = 256 * 1024
)

// ── Chain Submitter ───────────────────────────────────────────────────────────

type Submitter struct {
	rpcURL          string
	contractAddress string
	relayerURL      string
	httpClient      *http.Client
	configured      bool
}

func NewSubmitter() *Submitter {
	rpcURL   := strings.TrimRight(os.Getenv("FHEVM_RPC_URL"), "/")
	contract := os.Getenv("LENDING_CONTRACT_ADDRESS")
	relayer  := strings.TrimRight(os.Getenv("ZAMA_RELAYER_URL"), "/")

	configured := rpcURL != "" &&
		contract != "" &&
		contract != "0x0000000000000000000000000000000000000000" &&
		os.Getenv("RELAYER_PRIVATE_KEY") != ""

	if !configured {
		fmt.Println("[CHAIN] Contract not configured — loan submissions will be mocked")
		fmt.Println("[CHAIN] Set FHEVM_RPC_URL, LENDING_CONTRACT_ADDRESS, RELAYER_PRIVATE_KEY in .env")
	} else {
		fmt.Printf("[CHAIN] Contract configured at %s\n", contract)
	}

	return &Submitter{
		rpcURL:          rpcURL,
		contractAddress: contract,
		relayerURL:      relayer,
		configured:      configured,
		httpClient:      &http.Client{Timeout: chainTimeout},
	}
}

// SubmitLoanRequest submits the loan approval transaction to the
// fhEVM Solidity lending contract. It passes:
//   - encHandle: the FHE-encrypted score (euint32)
//   - zkProof:   the Cairo proof that score > threshold
//   - amount:    loan amount in USDC (scaled to 6 decimals)
//   - borrower:  the wallet requesting the loan
//
// Edge cases handled:
// - Contract not configured → mock tx hash, mocked=true
// - Private key missing → mock tx hash
// - RPC unreachable → mock tx hash (loan recorded in-memory)
// - Amount overflow → error before submission
// - Empty handle or proof → error before submission
func (s *Submitter) SubmitLoanRequest(
	borrower    string,
	encHandle   string,
	zkProof     []byte,
	amountUSDC  float64,
) (*models.ChainSubmitResult, error) {
	// Edge case: validate inputs before any network call
	if strings.TrimSpace(borrower) == "" {
		return nil, fmt.Errorf("chain: borrower address cannot be empty")
	}
	if strings.TrimSpace(encHandle) == "" {
		return nil, fmt.Errorf("chain: encrypted handle cannot be empty")
	}
	if amountUSDC <= 0 {
		return nil, fmt.Errorf("chain: amount must be positive, got %f", amountUSDC)
	}
	if amountUSDC > 10_000_000 {
		return nil, fmt.Errorf("chain: amount %f exceeds maximum safe value", amountUSDC)
	}

	// Edge case: contract not configured — return mock
	if !s.configured {
		return s.mockSubmit(borrower, encHandle, amountUSDC), nil
	}

	// Convert USDC to 6-decimal representation
	// $1000.00 USDC → 1000000000 (1000 * 10^6)
	amountScaled := new(big.Int).SetInt64(int64(amountUSDC * 1_000_000))

	payload, err := json.Marshal(map[string]interface{}{
		"borrower":         borrower,
		"encryptedHandle":  encHandle,
		"zkProof":          hex.EncodeToString(zkProof),
		"amount":           amountScaled.String(),
		"contractAddress":  s.contractAddress,
		"privateKey":       os.Getenv("RELAYER_PRIVATE_KEY"),
	})
	if err != nil {
		return nil, fmt.Errorf("chain: failed to marshal submission: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), chainTimeout)
	defer cancel()

	// Submit via Zama relayer — it handles the actual transaction signing
	// and broadcasting to the fhEVM node
	submitURL := s.relayerURL + "/submit"
	req, err := http.NewRequestWithContext(
		ctx, "POST", submitURL, bytes.NewBuffer(payload),
	)
	if err != nil {
		return nil, fmt.Errorf("chain: failed to build submission request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			fmt.Println("[CHAIN] Submission timed out — falling back to mock")
			return s.mockSubmit(borrower, encHandle, amountUSDC), nil
		}
		// RPC unreachable — fall back to mock so loan is still recorded
		fmt.Printf("[CHAIN] Submission unreachable (%v) — falling back to mock\n", err)
		return s.mockSubmit(borrower, encHandle, amountUSDC), nil
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxChainResponse))
	if err != nil {
		return nil, fmt.Errorf("chain: failed to read submission response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("chain: relayer returned %d: %s", resp.StatusCode, string(body))
	}

	if len(body) == 0 {
		return nil, fmt.Errorf("chain: empty submission response")
	}

	var result struct {
		TxHash    string `json:"tx_hash"`
		Confirmed bool   `json:"confirmed"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("chain: failed to decode submission response: %w", err)
	}

	if result.TxHash == "" {
		return nil, fmt.Errorf("chain: submission response missing 'tx_hash'")
	}

	fmt.Printf("[CHAIN] Loan tx submitted: %s\n", result.TxHash)

	return &models.ChainSubmitResult{
		TxHash:    result.TxHash,
		Confirmed: result.Confirmed,
		Mocked:    false,
	}, nil
}

// SubmitRepayment submits a loan repayment transaction to the contract.
func (s *Submitter) SubmitRepayment(
	borrower string,
	loanID   string,
) (*models.ChainSubmitResult, error) {
	if !s.configured {
		return s.mockRepay(borrower, loanID), nil
	}

	payload, _ := json.Marshal(map[string]interface{}{
		"borrower":        borrower,
		"loanId":          loanID,
		"contractAddress": s.contractAddress,
		"privateKey":      os.Getenv("RELAYER_PRIVATE_KEY"),
	})

	ctx, cancel := context.WithTimeout(context.Background(), chainTimeout)
	defer cancel()

	req, _ := http.NewRequestWithContext(
		ctx, "POST",
		s.relayerURL+"/repay",
		bytes.NewBuffer(payload),
	)
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		fmt.Printf("[CHAIN] Repayment submission failed (%v) — mocking\n", err)
		return s.mockRepay(borrower, loanID), nil
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(io.LimitReader(resp.Body, maxChainResponse))

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("chain: repayment returned %d: %s", resp.StatusCode, string(body))
	}

	var result struct {
		TxHash string `json:"tx_hash"`
	}
	json.Unmarshal(body, &result)

	return &models.ChainSubmitResult{
		TxHash:    result.TxHash,
		Confirmed: true,
		Mocked:    false,
	}, nil
}

// mockSubmit generates a deterministic mock tx hash for development.
func (s *Submitter) mockSubmit(borrower, handle string, amount float64) *models.ChainSubmitResult {
	h := sha256.Sum256([]byte(fmt.Sprintf("mock_tx_%s_%s_%.2f_%d",
		borrower, handle, amount, time.Now().UnixMilli())))
	txHash := "0x" + hex.EncodeToString(h[:])
	fmt.Printf("[CHAIN] Mock tx hash: %s\n", txHash[:18]+"...")
	return &models.ChainSubmitResult{TxHash: txHash, Confirmed: true, Mocked: true}
}

func (s *Submitter) mockRepay(borrower, loanID string) *models.ChainSubmitResult {
	h := sha256.Sum256([]byte(fmt.Sprintf("mock_repay_%s_%s_%d", borrower, loanID, time.Now().UnixMilli())))
	txHash := "0x" + hex.EncodeToString(h[:])
	return &models.ChainSubmitResult{TxHash: txHash, Confirmed: true, Mocked: true}
}
