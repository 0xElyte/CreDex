// Package fhe handles Fully Homomorphic Encryption operations.
// It integrates with Zama's fhEVM relayer to encrypt credit scores
// into euint32 ciphertext handles that the Solidity lending contract
// can operate on without ever decrypting the value.
//
// When the Zama relayer is unavailable (e.g. during development or
// if the relayer endpoint is not yet configured), all functions degrade
// gracefully and return mocked values so the rest of the loan flow
// can still execute. The mocked flag in the result tells callers
// whether real encryption was performed.
package fhe

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

// ── Constants ─────────────────────────────────────────────────────────────────

const (
	relayerTimeout    = 15 * time.Second
	maxResponseBytes  = 512 * 1024 // 512 KB
)

// ── Relayer Client ────────────────────────────────────────────────────────────

type RelayerClient struct {
	baseURL         string
	contractAddress string
	httpClient      *http.Client
	configured      bool
}

func NewRelayerClient() *RelayerClient {
	url := strings.TrimRight(
		os.Getenv("ZAMA_RELAYER_URL"),
		"/",
	)
	contract := os.Getenv("LENDING_CONTRACT_ADDRESS")

	configured := url != "" &&
		url != "https://relayer.sepolia.zama.ai" &&
		contract != "" &&
		contract != "0x0000000000000000000000000000000000000000"

	if !configured {
		fmt.Println("[FHE] Zama relayer not configured — using mock encryption")
		fmt.Println("[FHE] Set ZAMA_RELAYER_URL and LENDING_CONTRACT_ADDRESS in .env to enable")
	} else {
		fmt.Printf("[FHE] Zama relayer configured at %s\n", url)
	}

	return &RelayerClient{
		baseURL:         url,
		contractAddress: contract,
		configured:      configured,
		httpClient:      &http.Client{Timeout: relayerTimeout},
	}
}

// EncryptScore encrypts a plaintext score integer into a Zama fhEVM
// euint32 ciphertext handle. The handle is what gets passed to the
// Solidity contract — the contract never sees the raw number.
//
// Edge cases handled:
// - Relayer not configured → mock handle returned, mocked=true
// - Score out of range → error before any network call
// - Relayer timeout → error with clear message
// - Relayer returns non-200 → error with body
// - Response missing handle field → error
func (r *RelayerClient) EncryptScore(score int) (*models.EncryptResult, error) {
	// Edge case: score must be valid before encrypting
	if score < 0 || score > 1000 {
		return nil, fmt.Errorf("cannot encrypt invalid score %d (must be 0–1000)", score)
	}

	// Edge case: relayer not configured — return mock
	if !r.configured {
		return r.mockEncrypt(score), nil
	}

	payload, err := json.Marshal(map[string]interface{}{
		"value":            score,
		"type":             "euint32",
		"contractAddress":  r.contractAddress,
	})
	if err != nil {
		return nil, fmt.Errorf("fhe: failed to marshal encrypt request: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), relayerTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(
		ctx, "POST",
		r.baseURL+"/encrypt",
		bytes.NewBuffer(payload),
	)
	if err != nil {
		return nil, fmt.Errorf("fhe: failed to build encrypt request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := r.httpClient.Do(req)
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return nil, fmt.Errorf("fhe: relayer timed out after %v", relayerTimeout)
		}
		// Edge case: relayer unreachable — fall back to mock
		fmt.Printf("[FHE] Relayer unreachable (%v) — falling back to mock\n", err)
		return r.mockEncrypt(score), nil
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
	if err != nil {
		return nil, fmt.Errorf("fhe: failed to read relayer response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fhe: relayer returned %d: %s", resp.StatusCode, string(body))
	}

	// Edge case: empty response
	if len(body) == 0 {
		return nil, fmt.Errorf("fhe: relayer returned empty response")
	}

	var result struct {
		Handle string `json:"handle"`
		Proof  string `json:"proof"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("fhe: failed to decode relayer response: %w", err)
	}

	// Edge case: handle missing from response
	if result.Handle == "" {
		return nil, fmt.Errorf("fhe: relayer response missing 'handle' field")
	}

	return &models.EncryptResult{
		Handle: result.Handle,
		Proof:  result.Proof,
		Mocked: false,
	}, nil
}

// mockEncrypt generates a deterministic mock handle for development.
// The handle is a SHA256 hash of the score so it's unique per score
// and consistent across calls — useful for testing.
func (r *RelayerClient) mockEncrypt(score int) *models.EncryptResult {
	// Deterministic mock handle — same score always produces same handle
	h := sha256.Sum256([]byte(fmt.Sprintf("mock_fhe_score_%d", score)))
	handle := "0x" + hex.EncodeToString(h[:16]) // 32-char handle
	proof  := "0x" + hex.EncodeToString(h[16:])

	fmt.Printf("[FHE] Mock encrypted score %d → handle %s\n", score, handle)

	return &models.EncryptResult{
		Handle: handle,
		Proof:  proof,
		Mocked: true,
	}
}
