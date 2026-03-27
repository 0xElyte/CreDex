// Package chain also includes Filecoin storage for proof metadata.
// Stores encrypted score history and ZK proof metadata on Filecoin
// via the Synapse SDK HTTP API.
package chain

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"credex-backend/models"
)

const filecoinTimeout = 30 * time.Second

// ── Filecoin Storage ──────────────────────────────────────────────────────────

type FilecoinStore struct {
	apiURL     string
	apiKey     string
	httpClient *http.Client
	configured bool
}

func NewFilecoinStore() *FilecoinStore {
	apiURL := strings.TrimRight(os.Getenv("FILECOIN_SYNAPSE_URL"), "/")
	apiKey := os.Getenv("FILECOIN_API_KEY")

	configured := apiURL != "" && apiKey != "" &&
		apiKey != "your_filecoin_api_key_here"

	if !configured {
		fmt.Println("[FILECOIN] Synapse not configured — storage will be mocked")
		fmt.Println("[FILECOIN] Set FILECOIN_SYNAPSE_URL and FILECOIN_API_KEY in .env")
	} else {
		fmt.Printf("[FILECOIN] Synapse configured at %s\n", apiURL)
	}

	return &FilecoinStore{
		apiURL:     apiURL,
		apiKey:     apiKey,
		configured: configured,
		httpClient: &http.Client{Timeout: filecoinTimeout},
	}
}

// StoreProofMetadata stores the encrypted score handle, ZK proof hash,
// and loan metadata on Filecoin for verifiable audit trail.
//
// Edge cases handled:
// - Synapse not configured → mock CID, mocked=true
// - Empty wallet or handle → error before network call
// - Synapse timeout → mock CID fallback
// - Synapse unreachable → mock CID fallback
func (f *FilecoinStore) StoreProofMetadata(
	wallet       string,
	loanID       string,
	encHandle    string,
	zkProofHash  string,
	score        int,
	tier         string,
) (*models.FilecoinStoreResult, error) {
	// Edge case: validate inputs
	if strings.TrimSpace(wallet) == "" {
		return nil, fmt.Errorf("filecoin: wallet cannot be empty")
	}
	if strings.TrimSpace(loanID) == "" {
		return nil, fmt.Errorf("filecoin: loanID cannot be empty")
	}

	// Edge case: not configured — mock
	if !f.configured {
		return f.mockStore(wallet, loanID), nil
	}

	data := map[string]interface{}{
		"wallet_address":   wallet,
		"loan_id":          loanID,
		"encrypted_handle": encHandle,
		"zk_proof_hash":    zkProofHash,
		"score_tier":       tier,
		// Note: raw score NOT stored — only the tier and encrypted handle
		// Privacy: Filecoin is public, so we never store the plaintext score
		"stored_at": time.Now().UTC().Format(time.RFC3339),
		"version":   "1.0",
	}

	payload, err := json.Marshal(data)
	if err != nil {
		return nil, fmt.Errorf("filecoin: failed to marshal metadata: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), filecoinTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(
		ctx, "POST",
		f.apiURL+"/upload",
		bytes.NewBuffer(payload),
	)
	if err != nil {
		return nil, fmt.Errorf("filecoin: failed to build upload request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+f.apiKey)

	resp, err := f.httpClient.Do(req)
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			fmt.Println("[FILECOIN] Upload timed out — falling back to mock")
			return f.mockStore(wallet, loanID), nil
		}
		fmt.Printf("[FILECOIN] Upload failed (%v) — falling back to mock\n", err)
		return f.mockStore(wallet, loanID), nil
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if err != nil {
		return nil, fmt.Errorf("filecoin: failed to read upload response: %w", err)
	}

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return nil, fmt.Errorf("filecoin: upload returned %d: %s", resp.StatusCode, string(body))
	}

	var result struct {
		CID string `json:"cid"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("filecoin: failed to decode upload response: %w", err)
	}

	if result.CID == "" {
		return nil, fmt.Errorf("filecoin: response missing 'cid' field")
	}

	fmt.Printf("[FILECOIN] Stored proof metadata: %s\n", result.CID)

	return &models.FilecoinStoreResult{
		CID:    result.CID,
		Mocked: false,
	}, nil
}

func (f *FilecoinStore) mockStore(wallet, loanID string) *models.FilecoinStoreResult {
	// Mock CID format mimics real Filecoin CIDs
	mockCID := fmt.Sprintf("baga6ea4seaq%s%s",
		wallet[2:10],
		loanID[5:13],
	)
	fmt.Printf("[FILECOIN] Mock CID: %s\n", mockCID)
	return &models.FilecoinStoreResult{CID: mockCID, Mocked: true}
}
