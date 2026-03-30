// Package chain — lending_caller.go
// Calls CredexLending.requestLoan() on-chain after the relay proof is set.
// This is the final step that actually creates the loan record on-chain.
package chain

import (
	"context"
	"encoding/hex"
	"fmt"
	"math/big"
	"os"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/ethclient"
)

const lendingGasLimit = uint64(300_000)

// LendingCaller submits requestLoan() to CredexLending.sol on-chain.
type LendingCaller struct {
	relayer         *Relayer // reuse relayer's key + RPC
	contractAddress common.Address
	configured      bool
}

// NewLendingCaller creates a caller that reuses the relayer's private key
// to submit requestLoan() transactions to CredexLending.
func NewLendingCaller(r *Relayer) *LendingCaller {
	contract := os.Getenv("LENDING_CONTRACT_ADDRESS")
	configured := r.configured &&
		contract != "" &&
		contract != "0x0000000000000000000000000000000000000000"

	lc := &LendingCaller{
		relayer:    r,
		configured: configured,
	}

	if configured {
		lc.contractAddress = common.HexToAddress(contract)
		fmt.Printf("[LENDING] Caller configured → %s\n", contract)
	} else {
		fmt.Println("[LENDING] Contract not configured — requestLoan calls will be mocked")
	}

	return lc
}

// LoanCallResult is the result of calling requestLoan() on CredexLending.
type LoanCallResult struct {
	TxHash    string
	Confirmed bool
	Mocked    bool
}

// RequestLoan calls CredexLending.requestLoan(amount, collateralAmount, proofData)
// after the relayer has set the proof on RelayedCreditVerifier.
//
// Parameters:
//
//	borrower       — wallet address of the borrower
//	amountUSDC     — loan amount in USDC (human-readable, e.g. 200.0)
//	collateralAmt  — collateral amount in token units (18 decimals for WETH)
//	proofData      — abi.encode(bytes32 proofId) from the relay result
func (lc *LendingCaller) RequestLoan(
	borrower string,
	amountUSDC float64,
	collateralAmt float64,
	proofData string,
) (*LoanCallResult, error) {
	if !lc.configured {
		return lc.mockCall(borrower, amountUSDC), nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), relayTimeout)
	defer cancel()

	client, err := ethclient.DialContext(ctx, lc.relayer.rpcURL)
	if err != nil {
		fmt.Printf("[LENDING] Cannot connect to RPC (%v) — mocking\n", err)
		return lc.mockCall(borrower, amountUSDC), nil
	}
	defer client.Close()

	txHash, err := lc.sendRequestLoanTx(ctx, client, borrower, amountUSDC, collateralAmt, proofData)
	if err != nil {
		fmt.Printf("[LENDING] requestLoan tx failed (%v) — mocking\n", err)
		return lc.mockCall(borrower, amountUSDC), nil
	}

	fmt.Printf("[LENDING] requestLoan tx: %s\n", txHash)
	return &LoanCallResult{TxHash: txHash, Confirmed: false, Mocked: false}, nil
}

// ── ABI ───────────────────────────────────────────────────────────────────────

// Minimal ABI for CredexLending.requestLoan()
// Matches: function requestLoan(uint256 principalAmount, uint256 collateralAmount, bytes calldata proofData)
//         returns (uint256 loanId)
const lendingABIJSON = `[{
	"name": "requestLoan",
	"type": "function",
	"inputs": [
		{"name": "principalAmount",  "type": "uint256"},
		{"name": "collateralAmount", "type": "uint256"},
		{"name": "proofData",        "type": "bytes"}
	],
	"outputs": [
		{"name": "loanId", "type": "uint256"}
	]
}]`

func (lc *LendingCaller) sendRequestLoanTx(
	ctx context.Context,
	client *ethclient.Client,
	borrower string,
	amountUSDC float64,
	collateralAmt float64,
	proofDataHex string,
) (string, error) {
	chainID, err := client.ChainID(ctx)
	if err != nil {
		return "", fmt.Errorf("lending: get chainID: %w", err)
	}

	nonce, err := client.PendingNonceAt(ctx, lc.relayer.publicAddress)
	if err != nil {
		return "", fmt.Errorf("lending: get nonce: %w", err)
	}

	gasPrice, err := client.SuggestGasPrice(ctx)
	if err != nil {
		return "", fmt.Errorf("lending: get gasPrice: %w", err)
	}
	// 20% tip
	gasPrice = new(big.Int).Mul(gasPrice, big.NewInt(120))
	gasPrice.Div(gasPrice, big.NewInt(100))

	// Scale amounts:
	// USDC has 6 decimals: 200 USDC → 200_000_000
	amountScaled := new(big.Int).SetInt64(int64(amountUSDC * 1_000_000))
	// Collateral has 6 decimals (mCOLL): collateralAmt → scaled
	collateralScaled := new(big.Int).SetInt64(int64(collateralAmt * 1_000_000))

	// Decode proof data hex → bytes
	proofDataHex = strings.TrimPrefix(proofDataHex, "0x")
	proofBytes, err := hex.DecodeString(proofDataHex)
	if err != nil {
		return "", fmt.Errorf("lending: decode proofData: %w", err)
	}

	// ABI encode the call
	parsedABI, err := abi.JSON(strings.NewReader(lendingABIJSON))
	if err != nil {
		return "", fmt.Errorf("lending: parse ABI: %w", err)
	}

	calldata, err := parsedABI.Pack("requestLoan", amountScaled, collateralScaled, proofBytes)
	if err != nil {
		return "", fmt.Errorf("lending: pack calldata: %w", err)
	}

	// Estimate gas with fallback
	gasEstimate := lendingGasLimit
	msg := ethereum.CallMsg{
		From:     lc.relayer.publicAddress,
		To:       &lc.contractAddress,
		GasPrice: gasPrice,
		Data:     calldata,
	}
	if est, err := client.EstimateGas(ctx, msg); err == nil {
		gasEstimate = est * 130 / 100 // 30% headroom for storage writes
	} else {
		fmt.Printf("[LENDING] Gas estimate failed (%v) — using default %d\n", err, lendingGasLimit)
	}

	tx := types.NewTransaction(
		nonce,
		lc.contractAddress,
		big.NewInt(0),
		gasEstimate,
		gasPrice,
		calldata,
	)

	signer := types.NewEIP155Signer(chainID)
	signed, err := types.SignTx(tx, signer, lc.relayer.privateKey)
	if err != nil {
		return "", fmt.Errorf("lending: sign tx: %w", err)
	}

	if err := client.SendTransaction(ctx, signed); err != nil {
		return "", fmt.Errorf("lending: send tx: %w", err)
	}

	return signed.Hash().Hex(), nil
}

func (lc *LendingCaller) mockCall(borrower string, amount float64) *LoanCallResult {
	h := fmt.Sprintf("mock_loan_%s_%.0f_%d", borrower[:10], amount, time.Now().UnixMilli())
	mockHash := "0x" + hex.EncodeToString([]byte(h))[:64]
	return &LoanCallResult{TxHash: mockHash, Confirmed: false, Mocked: true}
}
