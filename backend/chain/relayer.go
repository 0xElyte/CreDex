// Package chain contains the EVM relay sender that broadcasts a relay()
// transaction to RelayedCreditVerifier.sol on behalf of the backend relayer
// wallet.
//
// The relay transaction stores a ProofContext on-chain so the borrower
// can then call CredexLending.requestLoan() using the proof data
// (abi.encode(proofId) as the proofData bytes argument).
//
// When EVM_RPC_URL or RELAYER_PRIVATE_KEY are not set, all relay calls
// are mocked so the rest of the loan flow still executes during development.
package chain

import (
	"context"
	"crypto/ecdsa"
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
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"

	"credex-backend/models"
	"credex-backend/relayer"
)

const (
	relayTimeout = 120 * time.Second // relay + mine confirmation
	// Gas limit sufficient for relay() — stores one SSTORE (~20k) + event (~1k) + overhead
	relayGasLimit = uint64(120_000)
	// receipt poll interval
	receiptPollInterval = 3 * time.Second
)

// ── Relayer ───────────────────────────────────────────────────────────────────

// Relayer signs and broadcasts relay(ProofContext) transactions to the
// RelayedCreditVerifier contract on EVM.
type Relayer struct {
	rpcURL          string
	contractAddress common.Address
	privateKey      *ecdsa.PrivateKey
	publicAddress   common.Address
	configured      bool
}

// NewRelayer reads EVM_RPC_URL, RELAYED_VERIFIER_ADDRESS and
// RELAYER_PRIVATE_KEY from the environment.
func NewRelayer() *Relayer {
	rpcURL := strings.TrimRight(os.Getenv("EVM_RPC_URL"), "/")
	contractHex := os.Getenv("RELAYED_VERIFIER_ADDRESS")
	privKeyHex := os.Getenv("RELAYER_PRIVATE_KEY")

	configured := rpcURL != "" &&
		contractHex != "" &&
		contractHex != "0x0000000000000000000000000000000000000000" &&
		privKeyHex != ""

	r := &Relayer{
		rpcURL:     rpcURL,
		configured: configured,
	}

	if !configured {
		fmt.Println("[RELAY] Not fully configured — relay transactions will be mocked")
		fmt.Println("[RELAY] Set EVM_RPC_URL, RELAYED_VERIFIER_ADDRESS, RELAYER_PRIVATE_KEY in .env")
		return r
	}

	r.contractAddress = common.HexToAddress(contractHex)

	privKeyHex = strings.TrimPrefix(privKeyHex, "0x")
	key, err := crypto.HexToECDSA(privKeyHex)
	if err != nil {
		fmt.Printf("[RELAY] Invalid RELAYER_PRIVATE_KEY: %v — relay will be mocked\n", err)
		r.configured = false
		return r
	}
	r.privateKey = key
	r.publicAddress = crypto.PubkeyToAddress(key.PublicKey)
	fmt.Printf("[RELAY] Relayer wallet: %s → contract: %s\n", r.publicAddress.Hex(), contractHex)

	return r
}

// ── Public API ────────────────────────────────────────────────────────────────

// RelayProof broadcasts a relay(ProofContext) transaction encoding the result
// from the Starknet CreditVerifier.
//
// Returns a RelayResult with the proofId and the abi-encoded proofData the
// frontend must pass to CredexLending.requestLoan().
func (r *Relayer) RelayProof(
	borrower string,
	sn *relayer.StarknetProofResult,
) (*models.RelayResult, error) {
	if !r.configured {
		return r.mockRelay(borrower, sn), nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), relayTimeout)
	defer cancel()

	client, err := ethclient.DialContext(ctx, r.rpcURL)
	if err != nil {
		return nil, fmt.Errorf("relay: cannot connect to EVM RPC: %w", err)
	}
	defer client.Close()

	txHash, err := r.sendRelayTx(ctx, client, borrower, sn)
	if err != nil {
		return nil, fmt.Errorf("relay: send failed: %w", err)
	}
	fmt.Printf("[RELAY] relay tx sent: %s — waiting for confirmation...\n", txHash[:18])

	// Wait for the relay tx to be mined before returning. The borrower's
	// requestLoan() call reads _proofs[proofId] from RelayedCreditVerifier —
	// if we return before the relay tx is confirmed the lookup returns
	// bytes32(0) and the contract reverts with InvalidProof.
	if err := waitForReceipt(ctx, client, txHash); err != nil {
		return nil, fmt.Errorf("relay: confirmation failed for tx %s: %w", txHash[:18], err)
	}

	// Build the proofData bytes the borrower sends to requestLoan()
	// proofData = abi.encode(bytes32 proofId)
	proofData := abiEncodeBytes32(sn.ProofID)

	return &models.RelayResult{
		ProofID:      "0x" + hex.EncodeToString(sn.ProofID[:]),
		ProofData:    "0x" + hex.EncodeToString(proofData),
		RelayTxHash:  txHash,
		ProofExpiry:  int64(sn.ValidUntil),
		StarknetUsed: !sn.Mocked,
		Mocked:       false,
	}, nil
}

// ── EVM transaction ───────────────────────────────────────────────────────────

func (r *Relayer) sendRelayTx(
	ctx context.Context,
	client *ethclient.Client,
	borrower string,
	sn *relayer.StarknetProofResult,
) (string, error) {
	chainID, err := client.ChainID(ctx)
	if err != nil {
		return "", fmt.Errorf("relay: get chainID: %w", err)
	}

	nonce, err := client.PendingNonceAt(ctx, r.publicAddress)
	if err != nil {
		return "", fmt.Errorf("relay: get nonce: %w", err)
	}

	gasPrice, err := client.SuggestGasPrice(ctx)
	if err != nil {
		return "", fmt.Errorf("relay: get gasPrice: %w", err)
	}
	// Add 20% tip to avoid stuck txs on Sepolia
	gasPrice = new(big.Int).Mul(gasPrice, big.NewInt(120))
	gasPrice.Div(gasPrice, big.NewInt(100))

	calldata, err := buildRelayCalldata(common.HexToAddress(borrower), sn)
	if err != nil {
		return "", fmt.Errorf("relay: build calldata: %w", err)
	}

	// Pre-estimate gas — use relayGasLimit as fallback on failure
	gasEstimate := relayGasLimit
	msg := ethereum.CallMsg{
		From:     r.publicAddress,
		To:       &r.contractAddress,
		GasPrice: gasPrice,
		Data:     calldata,
	}
	if est, err := client.EstimateGas(ctx, msg); err == nil {
		// 20% headroom
		gasEstimate = est * 120 / 100
	}

	tx := types.NewTransaction(
		nonce,
		r.contractAddress,
		big.NewInt(0), // no ETH value
		gasEstimate,
		gasPrice,
		calldata,
	)

	signer := types.NewEIP155Signer(chainID)
	signed, err := types.SignTx(tx, signer, r.privateKey)
	if err != nil {
		return "", fmt.Errorf("relay: sign tx: %w", err)
	}

	if err := client.SendTransaction(ctx, signed); err != nil {
		return "", fmt.Errorf("relay: send tx: %w", err)
	}

	return signed.Hash().Hex(), nil
}

// ── Receipt waiting ───────────────────────────────────────────────────────────

// waitForReceipt polls until the tx is mined or ctx is cancelled.
// Returns an error if the tx reverted (status == 0) or timed out.
func waitForReceipt(ctx context.Context, client *ethclient.Client, txHash string) error {
	hash := common.HexToHash(txHash)
	for {
		select {
		case <-ctx.Done():
			return fmt.Errorf("relay: timed out waiting for receipt of %s", txHash)
		case <-time.After(receiptPollInterval):
		}

		receipt, err := client.TransactionReceipt(ctx, hash)
		if err != nil {
			// Not yet mined — keep polling
			continue
		}
		if receipt.Status == 0 {
			return fmt.Errorf("relay: relay() transaction %s reverted on-chain", txHash)
		}
		fmt.Printf("[RELAY] relay tx %s confirmed in block %d\n", txHash[:18], receipt.BlockNumber.Uint64())
		return nil
	}
}

// ── ABI encoding ──────────────────────────────────────────────────────────────

// relayABI is the minimal ABI for the relay(ProofContext) function.
// ProofContext struct field order must match CredexTypes.sol exactly.
const relayABIJSON = `[{
	"name": "relay",
	"type": "function",
	"inputs": [{
		"name": "ctx",
		"type": "tuple",
		"components": [
			{"name": "proofId",         "type": "bytes32"},
			{"name": "borrower",        "type": "address"},
			{"name": "approvedTier",    "type": "uint8"},
			{"name": "maxBorrowAmount", "type": "uint256"},
			{"name": "validUntil",      "type": "uint256"},
			{"name": "issuedAt",        "type": "uint256"},
			{"name": "sourceChainId",   "type": "uint256"},
			{"name": "status",          "type": "uint8"},
			{"name": "scoreReference",  "type": "bytes32"}
		]
	}],
	"outputs": []
}]`

// proofContextABI is the Go-side struct that mirrors CredexTypes.ProofContext.
type proofContextABI struct {
	ProofId         [32]byte
	Borrower        common.Address
	ApprovedTier    uint8
	MaxBorrowAmount *big.Int
	ValidUntil      *big.Int
	IssuedAt        *big.Int
	SourceChainId   *big.Int
	Status          uint8
	ScoreReference  [32]byte
}

func buildRelayCalldata(borrower common.Address, sn *relayer.StarknetProofResult) ([]byte, error) {
	parsedABI, err := abi.JSON(strings.NewReader(relayABIJSON))
	if err != nil {
		return nil, fmt.Errorf("relay: parse ABI: %w", err)
	}

	ctx := proofContextABI{
		ProofId:         sn.ProofID,
		Borrower:        borrower,
		ApprovedTier:    sn.ApprovedTier,
		MaxBorrowAmount: sn.MaxBorrowAmount,
		ValidUntil:      new(big.Int).SetUint64(sn.ValidUntil),
		IssuedAt:        big.NewInt(time.Now().Unix()),
		SourceChainId:   big.NewInt(0), // 0 = chain-agnostic (validated by CredexLending)
		Status:          0,             // ProofStatus.Unused
		ScoreReference:  sn.ScoreReference,
	}

	return parsedABI.Pack("relay", ctx)
}

// abiEncodeBytes32 produces abi.encode(bytes32) — the proofData the frontend
// passes to CredexLending.requestLoan().
func abiEncodeBytes32(b [32]byte) []byte {
	// ABI encoding of a single bytes32 is just the 32 bytes padded to 32 bytes (no-op).
	result := make([]byte, 32)
	copy(result, b[:])
	return result
}

// ── Mock fallback ─────────────────────────────────────────────────────────────

func (r *Relayer) mockRelay(borrower string, sn *relayer.StarknetProofResult) *models.RelayResult {
	proofData := abiEncodeBytes32(sn.ProofID)
	mockTxHash := "0x" + hex.EncodeToString(append(sn.ProofID[:16], []byte(borrower)...))
	if len(mockTxHash) > 66 {
		mockTxHash = mockTxHash[:66]
	}
	// Pad to 66 chars (0x + 32 bytes)
	for len(mockTxHash) < 66 {
		mockTxHash += "0"
	}

	return &models.RelayResult{
		ProofID:      "0x" + hex.EncodeToString(sn.ProofID[:]),
		ProofData:    "0x" + hex.EncodeToString(proofData),
		RelayTxHash:  mockTxHash,
		ProofExpiry:  int64(sn.ValidUntil),
		StarknetUsed: !sn.Mocked,
		Mocked:       true,
	}
}
