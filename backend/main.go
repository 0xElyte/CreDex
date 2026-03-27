package main

import (
	"log"
	"os"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"

	"credex-backend/chain"
	"credex-backend/fhe"
	"credex-backend/handlers"
	"credex-backend/middleware"
	"credex-backend/relayer"
	"credex-backend/store"
)

func main() {
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file — reading from environment")
	}

	// ── Startup warnings ──────────────────────────────────────────────────────
	checkEnv("TELEGRAM_BOT_TOKEN",          "Telegram notifications disabled")
	checkEnv("ALCHEMY_API_KEY",              "Scoring engine will use demo Alchemy key (rate limited)")
	checkEnv("STARKNET_RPC_URL",             "Starknet credit validation will be mocked")
	checkEnv("STARKNET_VERIFIER_ADDRESS",    "Starknet credit validation will be mocked")
	checkEnv("EVM_RPC_URL",                  "EVM relay transactions will be mocked")
	checkEnv("RELAYED_VERIFIER_ADDRESS",     "EVM relay transactions will be mocked")
	checkEnv("RELAYER_PRIVATE_KEY",          "EVM relay transactions will be mocked")
	checkEnv("LENDING_CONTRACT_ADDRESS",     "On-chain loan submission will target zero address")
	checkEnv("FILECOIN_API_KEY",             "Filecoin storage will be mocked")

	// ── Initialise all dependencies ───────────────────────────────────────────
	appStore     := store.New()
	fheClient    := fhe.NewRelayerClient()
	zkProver     := relayer.NewZKProver()
	chainSub     := chain.NewSubmitter()
	filecoinStr  := chain.NewFilecoinStore()
	starknetCli  := relayer.NewStarknetClient()
	evmRelayer   := chain.NewRelayer()

	// ── Background: mark overdue loans every hour ─────────────────────────────
	go func() {
		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			if n := appStore.MarkOverdueLoans(); n > 0 {
				log.Printf("[INFO] Marked %d loan(s) as defaulted", n)
			}
		}
	}()

	// ── Gin ───────────────────────────────────────────────────────────────────
	if os.Getenv("GIN_MODE") == "release" {
		gin.SetMode(gin.ReleaseMode)
	}

	r := gin.New()
	r.SetTrustedProxies([]string{"127.0.0.1"})
	r.Use(gin.Recovery())
	r.Use(middleware.CORS())
	r.Use(middleware.Logger())

	// Inject all dependencies into handlers
	h := &handlers.H{
		Store:    appStore,
		FHE:      fheClient,
		ZK:       zkProver,
		Chain:    chainSub,
		Filecoin: filecoinStr,
		Starknet: starknetCli,
		Relay:    evmRelayer,
	}

	// ── Routes ────────────────────────────────────────────────────────────────
	r.GET("/health", h.Health)

	api := r.Group("/api/v1")
	{
		api.POST("/score",               h.ComputeScore)
		api.GET("/score/:wallet",        h.GetScore)
		api.POST("/loan/request",        h.RequestLoan)
		api.GET("/loan/status/:wallet",  h.GetLoanStatus)
		api.POST("/loan/repay",          h.RepayLoan)
		api.POST("/wallet/register",     h.RegisterWallet)
		api.GET("/tiers",                h.GetTiers)
		api.POST("/notify",              h.SendNotification)
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8000"
	}

	log.Printf("CreDex Backend running on :%s", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}

func checkEnv(key, warnMsg string) {
	val := os.Getenv(key)
	if val == "" || val == "your_"+key+"_here" {
		log.Printf("[WARN] %s not set — %s", key, warnMsg)
	}
}
