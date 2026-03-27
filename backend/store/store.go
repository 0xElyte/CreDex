package store

import (
	"fmt"
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
)

type Store struct {
	mu      sync.RWMutex
	loans   map[string]*models.LoanRecord
	wallets map[string]*models.WalletRecord
	chatIdx map[int64]string

	scoreMu sync.RWMutex
	scores  map[string]*cachedScore
}

type cachedScore struct {
	response  *models.ScoreResponse
	expiresAt time.Time
}

func New() *Store {
	return &Store{
		loans:   make(map[string]*models.LoanRecord),
		wallets: make(map[string]*models.WalletRecord),
		chatIdx: make(map[int64]string),
		scores:  make(map[string]*cachedScore),
	}
}

// ── Wallet ────────────────────────────────────────────────────────────────────

func (s *Store) RegisterWallet(wallet string, chatID int64) *models.WalletRecord {
	wallet = strings.ToLower(wallet)
	s.mu.Lock()
	defer s.mu.Unlock()

	// Clean up old mappings
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
	s.chatIdx[chatID] = wallet
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

// ── Loans — Atomic Operations ─────────────────────────────────────────────────

// CreateLoanIfNoActive atomically checks + creates in one lock.
// Fixes the check-then-act race condition.
func (s *Store) CreateLoanIfNoActive(loan *models.LoanRecord) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	wallet := strings.ToLower(loan.WalletAddress)

	// Check and create are inside the same lock — no gap for another goroutine
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
	return nil
}

// MarkRepaidIfActive atomically checks + updates in one lock.
// Fixes the check-then-update race condition.
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
	loan.Status   = models.LoanRepaid
	loan.RepaidAt = &now
	return loan, nil
}

// UpdateTxHash updates a loan record with the on-chain transaction hash.
func (s *Store) UpdateTxHash(loanID, txHash, encHandle, zkProofHash string, confirmed bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if loan, ok := s.loans[loanID]; ok {
		loan.TxHash          = txHash
		loan.EncryptedHandle  = encHandle
		loan.ZKProofHash      = zkProofHash
		loan.OnChainConfirmed = confirmed
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
	result := []models.LoanRecord{}
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
	result := []models.LoanRecord{}
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
