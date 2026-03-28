package store

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"credex-backend/models"
)

const (
	MinLoanUSDC      = 10.0
	MaxLoanUSDC      = 10_000.0
	ScoreCacheTTL    = 10 * time.Minute
	DegradedCacheTTL = 1 * time.Minute
	LoanTermDays     = 30

	zgTimeout    = 15 * time.Second
	zgTag        = "credex-loan"
	zgTagVersion = "v1"
)

// ── 0G Storage Client ─────────────────────────────────────────────────────────

type zgClient struct {
	storageURL string
	httpClient *http.Client
	configured bool
}

func newZGClient() *zgClient {
	url := strings.TrimRight(os.Getenv("ZG_STORAGE_URL"), "/")
	configured := url != ""

	if !configured {
		fmt.Println("[0G] ZG_STORAGE_URL not set — loan data will not persist across restarts")
		fmt.Println("[0G] Set ZG_STORAGE_URL in .env to enable decentralized storage")
	} else {
		fmt.Printf("[0G] Storage configured at %s\n", url)
	}

	return &zgClient{
		storageURL: url,
		configured: configured,
		httpClient: &http.Client{Timeout: zgTimeout},
	}
}

type zgUploadRequest struct {
	Data string     `json:"data"` // base64-encoded JSON
	Tags []zgTag_kv `json:"tags"`
}

type zgTag_kv struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

type zgUploadResponse struct {
	RootHash string `json:"rootHash"`
}

type zgListItem struct {
	RootHash string     `json:"rootHash"`
	Tags     []zgTag_kv `json:"tags"`
}

// upload encodes a loan record as base64 JSON and stores it on 0G.
func (z *zgClient) upload(loan *models.LoanRecord) (string, error) {
	if !z.configured {
		return "", fmt.Errorf("0G not configured")
	}

	raw, err := json.Marshal(loan)
	if err != nil {
		return "", fmt.Errorf("0G: marshal loan: %w", err)
	}

	body := zgUploadRequest{
		Data: base64.StdEncoding.EncodeToString(raw),
		Tags: []zgTag_kv{
			{Name: "app", Value: "credex"},
			{Name: "type", Value: zgTag},
			{Name: "version", Value: zgTagVersion},
			{Name: "loan-id", Value: loan.LoanID},
			{Name: "wallet", Value: strings.ToLower(loan.WalletAddress)},
			{Name: "status", Value: string(loan.Status)},
			{Name: "stored-at", Value: time.Now().UTC().Format(time.RFC3339)},
		},
	}

	payload, _ := json.Marshal(body)
	ctx, cancel := context.WithTimeout(context.Background(), zgTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "POST", z.storageURL+"/upload", bytes.NewReader(payload))
	if err != nil {
		return "", fmt.Errorf("0G: build upload request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := z.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("0G: upload failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return "", fmt.Errorf("0G: upload returned %d: %s", resp.StatusCode, string(respBody))
	}

	var result zgUploadResponse
	if err := json.Unmarshal(respBody, &result); err != nil {
		return "", fmt.Errorf("0G: decode upload response: %w", err)
	}

	fmt.Printf("[0G] Stored loan %s → %s\n", loan.LoanID, result.RootHash[:16]+"...")
	return result.RootHash, nil
}

// loadAll fetches all loan records tagged with credex-loan from 0G.
func (z *zgClient) loadAll() ([]*models.LoanRecord, error) {
	if !z.configured {
		return nil, nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), zgTimeout)
	defer cancel()

	url := fmt.Sprintf("%s/list?tag=%s&app=credex", z.storageURL, zgTag)
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("0G: build list request: %w", err)
	}

	resp, err := z.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("0G: list failed: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("0G: list returned %d: %s", resp.StatusCode, string(body))
	}

	var items []zgListItem
	if err := json.Unmarshal(body, &items); err != nil {
		return nil, fmt.Errorf("0G: decode list: %w", err)
	}

	// Download each item and decode
	var loans []*models.LoanRecord
	// Track latest version of each loan (0G keeps history — we want newest)
	seen := map[string]bool{}

	for _, item := range items {
		// Extract loan-id from tags
		loanID := ""
		for _, t := range item.Tags {
			if t.Name == "loan-id" {
				loanID = t.Value
				break
			}
		}
		if loanID == "" || seen[loanID] {
			continue
		}
		seen[loanID] = true

		loan, err := z.download(item.RootHash)
		if err != nil {
			fmt.Printf("[0G] Failed to download loan %s: %v\n", loanID, err)
			continue
		}
		loans = append(loans, loan)
	}

	fmt.Printf("[0G] Loaded %d loan(s) from decentralized storage\n", len(loans))
	return loans, nil
}

// download fetches and decodes a single loan record by root hash.
func (z *zgClient) download(rootHash string) (*models.LoanRecord, error) {
	ctx, cancel := context.WithTimeout(context.Background(), zgTimeout)
	defer cancel()

	url := fmt.Sprintf("%s/download?rootHash=%s", z.storageURL, rootHash)
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("0G: build download request: %w", err)
	}

	resp, err := z.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("0G: download failed: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("0G: download returned %d", resp.StatusCode)
	}

	// Body is base64-encoded JSON
	raw, err := base64.StdEncoding.DecodeString(string(bytes.TrimSpace(body)))
	if err != nil {
		// Try raw JSON (some 0G nodes return it directly)
		raw = body
	}

	var loan models.LoanRecord
	if err := json.Unmarshal(raw, &loan); err != nil {
		return nil, fmt.Errorf("0G: decode loan: %w", err)
	}
	return &loan, nil
}

// ── Store ─────────────────────────────────────────────────────────────────────

type Store struct {
	mu       sync.RWMutex
	loans    map[string]*models.LoanRecord // in-memory cache
	wallets  map[string]*models.WalletRecord
	chatIdx  map[int64]string
	deposits map[string]*models.DepositRecord
	scoreMu  sync.RWMutex
	scores   map[string]*cachedScore

	zg *zgClient // 0G storage client
}

type cachedScore struct {
	response  *models.ScoreResponse
	expiresAt time.Time
}

// New creates a Store and loads existing loans from 0G Storage.
func New() *Store {
	s := &Store{
		loans:    make(map[string]*models.LoanRecord),
		wallets:  make(map[string]*models.WalletRecord),
		chatIdx:  make(map[int64]string),
		deposits: make(map[string]*models.DepositRecord),
		scores:   make(map[string]*cachedScore),
		zg:       newZGClient(),
	}

	// Load persisted loans from 0G on startup
	if loans, err := s.zg.loadAll(); err != nil {
		fmt.Printf("[0G] Failed to load loans on startup: %v\n", err)
	} else {
		for _, l := range loans {
			s.loans[l.LoanID] = l
		}
	}

	return s
}

// persist saves a loan to 0G asynchronously (non-blocking).
func (s *Store) persist(loan *models.LoanRecord) {
	go func() {
		if _, err := s.zg.upload(loan); err != nil {
			fmt.Printf("[0G] Failed to persist loan %s: %v\n", loan.LoanID, err)
		}
	}()
}

// ── Wallet ────────────────────────────────────────────────────────────────────

func (s *Store) RegisterWallet(wallet string, chatID int64) *models.WalletRecord {
	wallet = strings.ToLower(wallet)
	s.mu.Lock()
	defer s.mu.Unlock()

	if existing, ok := s.wallets[wallet]; ok {
		delete(s.chatIdx, existing.TelegramChatID)
	}
	if oldWallet, ok := s.chatIdx[chatID]; ok {
		delete(s.wallets, oldWallet)
	}

	rec := &models.WalletRecord{
		WalletAddress:  wallet,
		TelegramChatID: chatID,
		RegisteredAt:   time.Now().UTC(),
	}
	s.wallets[wallet] = rec
	if chatID != 0 {
		s.chatIdx[chatID] = wallet
	}
	return rec
}

func (s *Store) GetChatID(wallet string) int64 {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if rec, ok := s.wallets[strings.ToLower(wallet)]; ok {
		return rec.TelegramChatID
	}
	return 0
}

func (s *Store) GetWalletByChatID(chatID int64) string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.chatIdx[chatID]
}

// ── Loans ─────────────────────────────────────────────────────────────────────

func (s *Store) CreateLoanIfNoActive(loan *models.LoanRecord) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	wallet := strings.ToLower(loan.WalletAddress)
	for _, l := range s.loans {
		if l.WalletAddress == wallet && l.Status == models.LoanActive {
			return fmt.Errorf(
				"wallet already has active loan %s (due %s)",
				l.LoanID, l.DueDate.Format("Jan 2, 2006"),
			)
		}
	}

	loan.WalletAddress = wallet
	s.loans[loan.LoanID] = loan

	// Persist to 0G asynchronously
	loanCopy := *loan
	s.persist(&loanCopy)

	return nil
}

func (s *Store) MarkRepaidIfActive(loanID, wallet string) (*models.LoanRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	wallet = strings.ToLower(wallet)
	loan, ok := s.loans[loanID]
	if !ok {
		return nil, fmt.Errorf("loan %s not found", loanID)
	}
	if loan.WalletAddress != wallet {
		return nil, fmt.Errorf("loan %s does not belong to wallet %s", loanID, wallet)
	}
	if loan.Status == models.LoanRepaid {
		return nil, fmt.Errorf("loan %s is already repaid", loanID)
	}
	if loan.Status == models.LoanDefaulted {
		return nil, fmt.Errorf("loan %s has defaulted and cannot be repaid", loanID)
	}

	now := time.Now().UTC()
	loan.Status = models.LoanRepaid
	loan.RepaidAt = &now

	// Persist updated status to 0G
	loanCopy := *loan
	s.persist(&loanCopy)

	return loan, nil
}

func (s *Store) UpdateTxHash(loanID, txHash, encHandle, zkProofHash string, confirmed bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if loan, ok := s.loans[loanID]; ok {
		loan.TxHash = txHash
		loan.EncryptedHandle = encHandle
		loan.ZKProofHash = zkProofHash
		loan.OnChainConfirmed = confirmed

		loanCopy := *loan
		s.persist(&loanCopy)
	}
}

func (s *Store) HasActiveLoan(wallet string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	wallet = strings.ToLower(wallet)
	for _, l := range s.loans {
		if l.WalletAddress == wallet && l.Status == models.LoanActive {
			return true
		}
	}
	return false
}

func (s *Store) GetLoan(loanID string) (*models.LoanRecord, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	l, ok := s.loans[loanID]
	return l, ok
}

func (s *Store) GetLoansForWallet(wallet string) []models.LoanRecord {
	s.mu.RLock()
	defer s.mu.RUnlock()
	wallet = strings.ToLower(wallet)
	var result []models.LoanRecord
	for _, l := range s.loans {
		if l.WalletAddress == wallet {
			result = append(result, *l)
		}
	}
	return result
}

func (s *Store) GetActiveLoans(wallet string) []models.LoanRecord {
	s.mu.RLock()
	defer s.mu.RUnlock()
	wallet = strings.ToLower(wallet)
	var result []models.LoanRecord
	for _, l := range s.loans {
		if l.WalletAddress == wallet && l.Status == models.LoanActive {
			result = append(result, *l)
		}
	}
	return result
}

func (s *Store) GetStreak(wallet string) int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	wallet = strings.ToLower(wallet)
	streak := 0
	for _, l := range s.loans {
		if l.WalletAddress != wallet {
			continue
		}
		if l.Status == models.LoanRepaid {
			streak++
		} else if l.Status == models.LoanDefaulted {
			streak = 0
		}
	}
	return streak
}

func (s *Store) MarkOverdueLoans() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now().UTC()
	count := 0
	for _, l := range s.loans {
		if l.Status == models.LoanActive && now.After(l.DueDate) {
			l.Status = models.LoanDefaulted
			count++
			loanCopy := *l
			s.persist(&loanCopy)
		}
	}
	return count
}

// ── Score Cache ───────────────────────────────────────────────────────────────

func scoreKey(wallet string, chainID int) string {
	return fmt.Sprintf("%s:%d", strings.ToLower(wallet), chainID)
}

func (s *Store) GetCachedScore(wallet string, chainID int) (*models.ScoreResponse, bool) {
	s.scoreMu.RLock()
	defer s.scoreMu.RUnlock()
	entry, ok := s.scores[scoreKey(wallet, chainID)]
	if !ok || time.Now().After(entry.expiresAt) {
		return nil, false
	}
	return entry.response, true
}

func (s *Store) SetCachedScore(wallet string, chainID int, resp *models.ScoreResponse) {
	if resp == nil {
		return
	}
	s.scoreMu.Lock()
	defer s.scoreMu.Unlock()
	ttl := ScoreCacheTTL
	if resp.Degraded {
		ttl = DegradedCacheTTL
	}
	s.scores[scoreKey(wallet, chainID)] = &cachedScore{
		response:  resp,
		expiresAt: time.Now().Add(ttl),
	}
}

func (s *Store) InvalidateScore(wallet string, chainID int) {
	s.scoreMu.Lock()
	defer s.scoreMu.Unlock()
	delete(s.scores, scoreKey(wallet, chainID))
}

func (s *Store) CreateDeposit(dep *models.DepositRecord) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.deposits[dep.DepositID] = dep
	go func() {
		if _, err := s.zg.upload(&models.LoanRecord{}); err != nil {
			// 0G upload for deposits — optional
		}
	}()
}

func (s *Store) GetDepositsForWallet(wallet string) []models.DepositRecord {
	s.mu.RLock()
	defer s.mu.RUnlock()
	wallet = strings.ToLower(wallet)
	var result []models.DepositRecord
	for _, d := range s.deposits {
		if d.WalletAddress == wallet {
			result = append(result, *d)
		}
	}
	return result
}
