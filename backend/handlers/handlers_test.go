package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"credex-backend/store"
)

func TestConfirmLoanCreatesActiveLoan(t *testing.T) {
	gin.SetMode(gin.TestMode)

	h := &H{Store: store.New()}
	r := gin.New()
	r.POST("/confirm", h.ConfirmLoan)

	body, err := json.Marshal(map[string]any{
		"wallet_address":   "0x1111111111111111111111111111111111111111",
		"loan_id":          "LOAN-test-1",
		"amount_usdc":      250,
		"collateral_pct":   35,
		"interest_apr":     8.0,
		"tier":             "Gold",
		"tx_hash":          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		"proof_id":         "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		"proof_data":       "0x1234",
		"solidity_loan_id": 7,
	})
	if err != nil {
		t.Fatalf("marshal body: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/confirm", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()

	r.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", res.Code, res.Body.String())
	}

	active := h.Store.GetActiveLoans("0x1111111111111111111111111111111111111111")
	if len(active) != 1 {
		t.Fatalf("expected 1 active loan, got %d", len(active))
	}
	if active[0].LoanID != "LOAN-test-1" {
		t.Fatalf("expected stored loan id LOAN-test-1, got %s", active[0].LoanID)
	}
	if active[0].TxHash == "" {
		t.Fatalf("expected tx hash to be stored")
	}
}

func TestConfirmLoanRejectsDuplicateActiveLoan(t *testing.T) {
	gin.SetMode(gin.TestMode)

	h := &H{Store: store.New()}
	r := gin.New()
	r.POST("/confirm", h.ConfirmLoan)

	payload := map[string]any{
		"wallet_address":   "0x2222222222222222222222222222222222222222",
		"loan_id":          "LOAN-test-2",
		"amount_usdc":      500,
		"collateral_pct":   20,
		"interest_apr":     4.0,
		"tier":             "Platinum",
		"tx_hash":          "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
		"solidity_loan_id": 9,
	}

	post := func() *httptest.ResponseRecorder {
		body, err := json.Marshal(payload)
		if err != nil {
			t.Fatalf("marshal body: %v", err)
		}
		req := httptest.NewRequest(http.MethodPost, "/confirm", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		res := httptest.NewRecorder()
		r.ServeHTTP(res, req)
		return res
	}

	first := post()
	if first.Code != http.StatusOK {
		t.Fatalf("expected first request 200, got %d: %s", first.Code, first.Body.String())
	}

	payload["loan_id"] = "LOAN-test-3"
	payload["tx_hash"] = "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
	second := post()
	if second.Code != http.StatusConflict {
		t.Fatalf("expected duplicate request 409, got %d: %s", second.Code, second.Body.String())
	}
}
