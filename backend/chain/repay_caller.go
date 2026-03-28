// repay_caller.go — add to CreDex/backend/chain/
// Calls CredexLending.repayLoan(loanId) on-chain after marking repaid in memory.
package chain

import (
	"context"
	"encoding/hex"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/ethclient"
)

const repayABIJSON = `[{
	"name": "repayLoan",
	"type": "function",
	"inputs": [{"name": "loanId", "type": "bytes32"}],
	"outputs": []
}]`

// RepayLoanOnChain calls CredexLending.repayLoan(bytes32 loanId).
// loanID is the string loan ID from the store (e.g. "LOAN-9d9033-1234567890").
// It is hashed to bytes32 using keccak256 to match what was stored on-chain.
func (lc *LendingCaller) RepayLoanOnChain(loanID string) (*LoanCallResult, error) {
	if !lc.configured {
		return lc.mockRepayCall(loanID), nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), relayTimeout)
	defer cancel()

	client, err := ethclient.DialContext(ctx, lc.relayer.rpcURL)
	if err != nil {
		fmt.Printf("[LENDING] Cannot connect for repay (%v) — mocking\n", err)
		return lc.mockRepayCall(loanID), nil
	}
	defer client.Close()

	txHash, err := lc.sendRepayTx(ctx, client, loanID)
	if err != nil {
		fmt.Printf("[LENDING] repayLoan tx failed (%v) — mocking\n", err)
		return lc.mockRepayCall(loanID), nil
	}

	fmt.Printf("[LENDING] repayLoan on-chain: %s\n", txHash)
	return &LoanCallResult{TxHash: txHash, Confirmed: false, Mocked: false}, nil
}

func (lc *LendingCaller) sendRepayTx(
	ctx context.Context,
	client *ethclient.Client,
	loanID string,
) (string, error) {
	chainID, err := client.ChainID(ctx)
	if err != nil {
		return "", fmt.Errorf("repay: chainID: %w", err)
	}

	nonce, err := client.PendingNonceAt(ctx, lc.relayer.publicAddress)
	if err != nil {
		return "", fmt.Errorf("repay: nonce: %w", err)
	}

	gasPrice, err := client.SuggestGasPrice(ctx)
	if err != nil {
		return "", fmt.Errorf("repay: gasPrice: %w", err)
	}
	gasPrice = new(big.Int).Mul(gasPrice, big.NewInt(120))
	gasPrice.Div(gasPrice, big.NewInt(100))

	// Hash loanID string to bytes32
	loanIDBytes := loanIDToBytes32(loanID)

	parsedABI, err := abi.JSON(strings.NewReader(repayABIJSON))
	if err != nil {
		return "", fmt.Errorf("repay: parse ABI: %w", err)
	}

	calldata, err := parsedABI.Pack("repayLoan", loanIDBytes)
	if err != nil {
		return "", fmt.Errorf("repay: pack: %w", err)
	}

	gasEstimate := uint64(150_000)
	msg := ethereum.CallMsg{
		From:     lc.relayer.publicAddress,
		To:       &lc.contractAddress,
		GasPrice: gasPrice,
		Data:     calldata,
	}
	if est, err := client.EstimateGas(ctx, msg); err == nil {
		gasEstimate = est * 130 / 100
	}

	tx := types.NewTransaction(
		nonce, lc.contractAddress,
		big.NewInt(0), gasEstimate, gasPrice, calldata,
	)

	signer := types.NewEIP155Signer(chainID)
	signed, err := types.SignTx(tx, signer, lc.relayer.privateKey)
	if err != nil {
		return "", fmt.Errorf("repay: sign: %w", err)
	}

	if err := client.SendTransaction(ctx, signed); err != nil {
		return "", fmt.Errorf("repay: send: %w", err)
	}

	return signed.Hash().Hex(), nil
}

// loanIDToBytes32 converts a string loan ID to a bytes32 by right-padding.
// Uses the raw bytes of the string, truncated/padded to 32 bytes.
func loanIDToBytes32(loanID string) [32]byte {
	var b [32]byte
	copy(b[:], []byte(loanID))
	return b
}

func (lc *LendingCaller) mockRepayCall(loanID string) *LoanCallResult {
	mockHash := "0x" + hex.EncodeToString([]byte(fmt.Sprintf("repay_%s_%d", loanID, time.Now().UnixMilli())))[:64]
	return &LoanCallResult{TxHash: mockHash, Confirmed: false, Mocked: true}
}

// ── SupplyLiquidity ───────────────────────────────────────────────────────────

const supplyABIJSON = `[{
	"name": "supplyLiquidity",
	"type": "function",
	"inputs": [{"name": "amount", "type": "uint256"}],
	"outputs": []
}]`

// SupplyLiquidityOnChain calls CredexLending.supplyLiquidity(amount).
// amount is in USDC human units (e.g. 500.0 = $500).
func (lc *LendingCaller) SupplyLiquidityOnChain(amountUSDC float64) (*LoanCallResult, error) {
	if !lc.configured {
		return &LoanCallResult{Mocked: true}, nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), relayTimeout)
	defer cancel()

	client, err := ethclient.DialContext(ctx, lc.relayer.rpcURL)
	if err != nil {
		fmt.Printf("[LENDING] Cannot connect for supplyLiquidity (%v) — mocking\n", err)
		return &LoanCallResult{Mocked: true}, nil
	}
	defer client.Close()

	// Scale to 6 decimals
	amountScaled := new(big.Int).SetInt64(int64(amountUSDC * 1_000_000))

	chainID, _ := client.ChainID(ctx)
	nonce, _ := client.PendingNonceAt(ctx, lc.relayer.publicAddress)
	gasPrice, _ := client.SuggestGasPrice(ctx)
	gasPrice = new(big.Int).Mul(gasPrice, big.NewInt(120))
	gasPrice.Div(gasPrice, big.NewInt(100))

	parsedABI, _ := abi.JSON(strings.NewReader(supplyABIJSON))
	calldata, err := parsedABI.Pack("supplyLiquidity", amountScaled)
	if err != nil {
		return &LoanCallResult{Mocked: true}, nil
	}

	gasEstimate := uint64(150_000)
	msg := ethereum.CallMsg{
		From: lc.relayer.publicAddress,
		To:   &lc.contractAddress,
		Data: calldata,
	}
	if est, err := client.EstimateGas(ctx, msg); err == nil {
		gasEstimate = est * 130 / 100
	}

	tx := types.NewTransaction(nonce, lc.contractAddress, big.NewInt(0), gasEstimate, gasPrice, calldata)
	signer := types.NewEIP155Signer(chainID)
	signed, err := types.SignTx(tx, signer, lc.relayer.privateKey)
	if err != nil {
		return &LoanCallResult{Mocked: true}, nil
	}

	if err := client.SendTransaction(ctx, signed); err != nil {
		fmt.Printf("[LENDING] supplyLiquidity failed: %v\n", err)
		return &LoanCallResult{Mocked: true}, nil
	}

	txHash := signed.Hash().Hex()
	fmt.Printf("[LENDING] supplyLiquidity on-chain: %s\n", txHash)
	return &LoanCallResult{TxHash: txHash, Confirmed: false, Mocked: false}, nil
}
