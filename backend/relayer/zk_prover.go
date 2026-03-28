// Package relayer handles ZK proof generation via the Cairo circuit
// deployed on StarkNet Sepolia.
//
// The Cairo circuit proves "this encrypted score is above threshold X"
// without revealing the actual score value. The resulting proof bytes
// are passed to the Solidity lending contract which verifies them
// before approving the loan.
//
// When the Cairo prover is unavailable, functions degrade gracefully
// and return mocked proofs so the rest of the loan flow can execute.
package relayer

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
	"strings"
	"time"

	"credex-backend/models"
)

const (
	cairoTimeout     = 60 * time.Second // ZK proofs can be slow
	maxProofBytes    = 1 << 20          // 1 MB
)

// ── ZK Prover Client ──────────────────────────────────────────────────────────

type ZKProver struct {
	baseURL    string
	httpClient *http.Client
	configured bool
}

func NewZKProver() *ZKProver {
	url := strings.TrimRight(os.Getenv("CAIRO_PROVER_URL"), "/")

	configured := url != "" &&
		url != "https://prover.starknet-sepolia.credex.io"

	if !configured {
		fmt.Println("[ZK] Cairo prover not configured — using mock proofs")
		fmt.Println("[ZK] Set CAIRO_PROVER_URL in .env to enable real ZK proofs")
	} else {
		fmt.Printf("[ZK] Cairo prover configured at %s\n", url)
	}

	return &ZKProver{
		baseURL:    url,
		configured: configured,
		httpClient: &http.Client{Timeout: cairoTimeout},
	}
}

// GenerateProof asks the Cairo circuit to prove that the encrypted score
// handle corresponds to a score above the given threshold.
//
// Edge cases handled:
// - Prover not configured → mock proof, mocked=true
// - Threshold must be positive → error before network call
// - Prover timeout (ZK proof generation can be slow) → error
// - Prover returns non-200 → error with body
// - Empty proof in response → error
// - Prover unreachable → fall back to mock
func (z *ZKProver) GenerateProof(
	encryptedHandle string,
	threshold int,
) (*models.ZKProofResult, error) {
	// Edge case: threshold must be a valid score
	if threshold < 0 || threshold > 1000 {
		return nil, fmt.Errorf("zk: threshold %d is invalid (must be 0–1000)", threshold)
	}

	// Edge case: encrypted handle must not be empty
	if strings.TrimSpace(encryptedHandle) == "" {
		return nil, fmt.Errorf("zk: encrypted handle cannot be empty")
	}

	// Edge case: prover not configured — return mock
	if !z.configured {
		return z.mockProof(encryptedHandle, threshold), nil
	}

	payload, err := json.Marshal(map[string]interface{}{
		"encrypted_handle": encryptedHandle,
		"threshold":        threshold,
	})
	if err != nil {
		return nil, fmt.Errorf("zk: failed to marshal proof request: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), cairoTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(
		ctx, "POST",
		z.baseURL+"/prove",
		bytes.NewBuffer(payload),
	)
	if err != nil {
		return nil, fmt.Errorf("zk: failed to build proof request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := z.httpClient.Do(req)
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			// ZK proof generation timed out — fall back to mock for hackathon
			fmt.Printf("[ZK] Prover timed out after %v — falling back to mock\n", cairoTimeout)
			return z.mockProof(encryptedHandle, threshold), nil
		}
		// Prover unreachable — fall back to mock
		fmt.Printf("[ZK] Prover unreachable (%v) — falling back to mock\n", err)
		return z.mockProof(encryptedHandle, threshold), nil
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxProofBytes))
	if err != nil {
		return nil, fmt.Errorf("zk: failed to read proof response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("zk: prover returned %d: %s", resp.StatusCode, string(body))
	}

	if len(body) == 0 {
		return nil, fmt.Errorf("zk: prover returned empty response")
	}

	var result struct {
		Proof     string `json:"proof"`      // hex-encoded proof bytes
		ProofHash string `json:"proof_hash"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("zk: failed to decode proof response: %w", err)
	}

	if result.Proof == "" {
		return nil, fmt.Errorf("zk: prover response missing 'proof' field")
	}

	// Decode hex proof to bytes
	proofBytes, err := hex.DecodeString(strings.TrimPrefix(result.Proof, "0x"))
	if err != nil {
		return nil, fmt.Errorf("zk: failed to decode proof hex: %w", err)
	}

	return &models.ZKProofResult{
		Proof:      proofBytes,
		ProofHash:  result.ProofHash,
		ScoreAbove: threshold,
		Mocked:     false,
	}, nil
}

// mockProof generates a deterministic mock proof for development.
func (z *ZKProver) mockProof(handle string, threshold int) *models.ZKProofResult {
	h := sha256.Sum256([]byte(fmt.Sprintf("mock_zk_%s_%d", handle, threshold)))
	proofHash := "0x" + hex.EncodeToString(h[:])

	fmt.Printf("[ZK] Mock proof generated for threshold %d → %s\n", threshold, proofHash[:18]+"...")

	return &models.ZKProofResult{
		Proof:      h[:],
		ProofHash:  proofHash,
		ScoreAbove: threshold,
		Mocked:     true,
	}
}

// TierThreshold returns the minimum score required for a credit tier.
// The ZK circuit proves the score is above this threshold.
func TierThreshold(tier string) int {
	switch tier {
	case "Platinum":
		return 850
	case "Gold":
		return 700
	case "Silver":
		return 550
	case "Bronze":
		return 400
	default:
		return 400
	}
}
