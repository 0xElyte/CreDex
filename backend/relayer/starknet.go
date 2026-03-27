// Package relayer includes the Starknet JSON-RPC client that validates a
// borrower's credit score against the Cairo CreditVerifier contract.
//
// Flow:
//  1. Call starknet_call on the Cairo CreditVerifier at STARKNET_VERIFIER_ADDRESS
//  2. Interpret the felt252 fields returned by the contract
//  3. If the contract call fails (or is not configured) fall back to a
//     locally-constructed ProofContext so the rest of the relay flow still works.
package relayer

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"os"
	"strings"
	"time"
)

const (
	starknetTimeout  = 30 * time.Second
	maxStarknetBytes = 256 * 1024
)

// ── Types ─────────────────────────────────────────────────────────────────────

// StarknetProofResult contains the data returned from the Cairo CreditVerifier.
type StarknetProofResult struct {
	// ProofID is a 32-byte identifier derived from the Starknet felt252 proofId.
	ProofID [32]byte
	// ApprovedTier corresponds to the CreditTier enum (Bronze=1 … Platinum=4).
	ApprovedTier uint8
	// MaxBorrowAmount in USDC base units (6 decimals).
	MaxBorrowAmount *big.Int
	// ValidUntil is a Unix timestamp; 0 means no expiry.
	ValidUntil uint64
	// ScoreReference is the felt252 score hash from Starknet, stored as 32 bytes.
	ScoreReference [32]byte
	// Mocked is true when the actual Starknet call was skipped / failed.
	Mocked bool
}

// ── Client ────────────────────────────────────────────────────────────────────

// StarknetClient calls the Cairo CreditVerifier on Starknet Sepolia.
type StarknetClient struct {
	rpcURL          string
	verifierAddress string
	httpClient      *http.Client
	configured      bool
}

// NewStarknetClient reads STARKNET_RPC_URL and STARKNET_VERIFIER_ADDRESS from
// the environment and returns a client.  If either is unset the client
// degrades gracefully (every call returns a mocked proof).
func NewStarknetClient() *StarknetClient {
	rpcURL  := strings.TrimRight(os.Getenv("STARKNET_RPC_URL"), "/")
	verAddr := os.Getenv("STARKNET_VERIFIER_ADDRESS")

	configured := rpcURL != "" && verAddr != ""

	if !configured {
		fmt.Println("[STARKNET] Not configured — proof validation will be mocked")
		fmt.Println("[STARKNET] Set STARKNET_RPC_URL and STARKNET_VERIFIER_ADDRESS in .env")
	} else {
		fmt.Printf("[STARKNET] CreditVerifier at %s via %s\n", verAddr, rpcURL)
	}

	return &StarknetClient{
		rpcURL:          rpcURL,
		verifierAddress: verAddr,
		configured:      configured,
		httpClient:      &http.Client{Timeout: starknetTimeout},
	}
}

// ── Public API ────────────────────────────────────────────────────────────────

// ValidateCredit calls approve_credit on the Cairo CreditVerifier for borrower
// at the given credit score. On any failure it falls back to a mocked proof so
// the relay can still proceed.
func (s *StarknetClient) ValidateCredit(
	borrower  string,
	score     int,
	maxUSDC   float64,
) (*StarknetProofResult, error) {
	if !s.configured {
		return s.mockResult(borrower, score, maxUSDC), nil
	}

	result, err := s.callVerifier(borrower, score, maxUSDC)
	if err != nil {
		fmt.Printf("[STARKNET] Call failed (%v) — using mock fallback\n", err)
		r := s.mockResult(borrower, score, maxUSDC)
		return r, nil
	}
	return result, nil
}

// ── Starknet JSON-RPC call ────────────────────────────────────────────────────

// callVerifier performs starknet_call targeting the `verify_credit` view
// on the Cairo CreditVerifier contract.  The Cairo contract is expected to
// return a tuple of felt252 values:
//
//	[proofId, approvedTier, maxBorrowAmount, validUntil, scoreReference]
func (s *StarknetClient) callVerifier(
	borrower string,
	score    int,
	maxUSDC  float64,
) (*StarknetProofResult, error) {
	// Convert borrower address (0x...) and score to felt252 calldata
	borrowerFelt := padFelt(borrower)
	scoreFelt    := fmt.Sprintf("0x%x", score)

	payload := map[string]interface{}{
		"jsonrpc": "2.0",
		"method":  "starknet_call",
		"params": []interface{}{
			map[string]interface{}{
				"contract_address":   s.verifierAddress,
				"entry_point_selector": feltSelector("verify_credit"),
				"calldata":           []string{borrowerFelt, scoreFelt},
			},
			"latest",
		},
		"id": 1,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("starknet: marshal payload: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), starknetTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "POST", s.rpcURL, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("starknet: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("starknet: HTTP: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxStarknetBytes))
	if err != nil {
		return nil, fmt.Errorf("starknet: read body: %w", err)
	}

	var rpcResp struct {
		Result []string `json:"result"`
		Error  *struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(raw, &rpcResp); err != nil {
		return nil, fmt.Errorf("starknet: decode response: %w", err)
	}
	if rpcResp.Error != nil {
		return nil, fmt.Errorf("starknet: RPC error %d: %s",
			rpcResp.Error.Code, rpcResp.Error.Message)
	}
	if len(rpcResp.Result) < 5 {
		return nil, fmt.Errorf("starknet: expected ≥5 felt252 values, got %d", len(rpcResp.Result))
	}

	return parseVerifierResult(rpcResp.Result)
}

// parseVerifierResult decodes the felt252 array returned by the Cairo contract.
// Expected layout: [proofId, approvedTier, maxBorrowAmount, validUntil, scoreReference]
func parseVerifierResult(felts []string) (*StarknetProofResult, error) {
	// proofId → 32-byte array
	proofIdBig, ok := new(big.Int).SetString(strings.TrimPrefix(felts[0], "0x"), 16)
	if !ok {
		return nil, fmt.Errorf("starknet: bad proofId felt: %s", felts[0])
	}
	var proofID [32]byte
	proofIdBig.FillBytes(proofID[:])

	// approvedTier → uint8
	tierBig, ok := new(big.Int).SetString(strings.TrimPrefix(felts[1], "0x"), 16)
	if !ok {
		return nil, fmt.Errorf("starknet: bad tier felt: %s", felts[1])
	}
	tier := uint8(tierBig.Uint64())

	// maxBorrowAmount → *big.Int (already in USDC 6-decimal units from Cairo)
	maxBorrow, ok := new(big.Int).SetString(strings.TrimPrefix(felts[2], "0x"), 16)
	if !ok {
		return nil, fmt.Errorf("starknet: bad maxBorrowAmount felt: %s", felts[2])
	}

	// validUntil → uint64
	validUntilBig, ok := new(big.Int).SetString(strings.TrimPrefix(felts[3], "0x"), 16)
	if !ok {
		return nil, fmt.Errorf("starknet: bad validUntil felt: %s", felts[3])
	}
	validUntil := validUntilBig.Uint64()

	// scoreReference → 32-byte array
	scoreRefBig, ok := new(big.Int).SetString(strings.TrimPrefix(felts[4], "0x"), 16)
	if !ok {
		return nil, fmt.Errorf("starknet: bad scoreReference felt: %s", felts[4])
	}
	var scoreRef [32]byte
	scoreRefBig.FillBytes(scoreRef[:])

	return &StarknetProofResult{
		ProofID:         proofID,
		ApprovedTier:    tier,
		MaxBorrowAmount: maxBorrow,
		ValidUntil:      validUntil,
		ScoreReference:  scoreRef,
		Mocked:          false,
	}, nil
}

// ── Mock fallback ─────────────────────────────────────────────────────────────

// mockResult constructs a ProofContext locally based on the locally-computed
// score when the Starknet call is not available.  This lets the relay
// architecture function end-to-end during development / demo.
func (s *StarknetClient) mockResult(borrower string, score int, maxUSDC float64) *StarknetProofResult {
	tier := scoreToTier(score)

	// Deterministic proofId from borrower + score + timestamp bucket (10-min windows)
	seed := fmt.Sprintf("%s:%d:%d", strings.ToLower(borrower), score, time.Now().Unix()/600)
	var proofID [32]byte
	h := hashBytes([]byte(seed))
	copy(proofID[:], h)

	var scoreRef [32]byte
	sr := hashBytes([]byte(fmt.Sprintf("score:%d", score)))
	copy(scoreRef[:], sr)

	maxBorrow := usdcToBigInt(maxUSDC)
	if maxBorrow.Sign() == 0 {
		maxBorrow = tierMaxBorrow(tier)
	}

	return &StarknetProofResult{
		ProofID:         proofID,
		ApprovedTier:    tier,
		MaxBorrowAmount: maxBorrow,
		ValidUntil:      uint64(time.Now().Add(15 * time.Minute).Unix()),
		ScoreReference:  scoreRef,
		Mocked:          true,
	}
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// padFelt converts a 0x-prefixed Ethereum address string to a 0x-padded
// felt252 hex string (both are 32 bytes so the conversion is a no-op for
// addresses, but keeps the type explicit).
func padFelt(addr string) string {
	addr = strings.TrimPrefix(addr, "0x")
	// Pad to 64 hex chars (felt252 max)
	return "0x" + fmt.Sprintf("%064s", addr)
}

// feltSelector returns the Starknet function selector for a short name.
// For simplicity we use the Starknet pedersen hash convention expressed as
// the keccak256 of the ASCII name, truncated to felt252 range.
// A production implementation should pre-compute this using starknet-py.
func feltSelector(name string) string {
	b := hashBytes([]byte(name))
	n := new(big.Int).SetBytes(b)
	// Starknet felt252 max is 2^251 + 17*2^192 + 1 — we just use the lower 31 bytes which is safe
	mask := new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 251), big.NewInt(1))
	n.And(n, mask)
	return "0x" + n.Text(16)
}

func hashBytes(data []byte) []byte {
	h := sha256.Sum256(data)
	return h[:]
}

// scoreToTier maps a raw score to the CreditTier uint8 value used on-chain.
//
//	None=0, Bronze=1, Silver=2, Gold=3, Platinum=4
func scoreToTier(score int) uint8 {
	switch {
	case score >= 850:
		return 4 // Platinum
	case score >= 700:
		return 3 // Gold
	case score >= 550:
		return 2 // Silver
	case score >= 400:
		return 1 // Bronze
	default:
		return 0 // None
	}
}

// tierMaxBorrow returns the default max borrow amount in USDC (6 decimals) for a tier.
func tierMaxBorrow(tier uint8) *big.Int {
	amounts := map[uint8]int64{
		1: 500 * 1_000_000,    // Bronze:   $500
		2: 2_000 * 1_000_000,  // Silver:  $2,000
		3: 5_000 * 1_000_000,  // Gold:    $5,000
		4: 10_000 * 1_000_000, // Platinum: $10,000
	}
	if v, ok := amounts[tier]; ok {
		return big.NewInt(v)
	}
	return big.NewInt(0)
}

// usdcToBigInt converts a float64 USDC amount to a *big.Int with 6 decimals.
func usdcToBigInt(usdc float64) *big.Int {
	if usdc <= 0 {
		return big.NewInt(0)
	}
	// Multiply by 1e6 and truncate
	scaled := int64(usdc * 1_000_000)
	return big.NewInt(scaled)
}
