"use client";
import { useCallback, useEffect } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  setConnecting, setConnected, setDisconnected, updateBalance,
} from "@/store/walletSlice";
import { setLoans, clearLoans } from "@/store/financeSlice";
import { backendApi } from "@/lib/backendApi";
import type { CreditTier, Loan } from "@/types";

// ─── USDC contract addresses ──────────────────────────────────────────────────
// Mock USDC (mUSDC) deployed on Sepolia for hackathon demo
const USDC_CONTRACTS: Record<string, string> = {
  "0xaa36a7": "0x0ed7269d9Cc82b16E9E6D0f40c3bbF64c6Be17c2", // Sepolia — mUSDC (mock)
  "0x1":      "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // Mainnet
  "0x89":     "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", // Polygon
  "0x106a":   "0x0ed7269d9Cc82b16E9E6D0f40c3bbF64c6Be17c2", // Sepolia alt chain ID — mUSDC
  "0x14a34":  "0x0ed7269d9Cc82b16E9E6D0f40c3bbF64c6Be17c2", // Base Sepolia — mUSDC
};

// ─── Human-readable chain names ───────────────────────────────────────────────
export const CHAIN_NAMES: Record<string, string> = {
  "0x1":      "ETH_MAINNET",
  "0x89":     "POLYGON",
  "0xaa36a7": "ETH_SEPOLIA",
  "0x106a":   "ETH_SEPOLIA",
  "0x14a34":  "BASE_SEPOLIA",
};

async function getChainId(): Promise<string> {
  if (!window.ethereum) return "";
  try {
    return ((await window.ethereum.request({ method: "eth_chainId" })) as string).toLowerCase();
  } catch {
    return "";
  }
}

// ─── Collateral contract addresses ───────────────────────────────────────────
// Mock Collateral (mCOLL) deployed on Sepolia for hackathon demo
const COLL_CONTRACTS: Record<string, string> = {
  "0xaa36a7": "0x2858Cb1D9C7b2e0420d04A0E988c4C425eF50964", // Sepolia — mCOLL (newly deployed)
  "0x106a":   "0x2858Cb1D9C7b2e0420d04A0E988c4C425eF50964", // Sepolia alt chain ID
  "0x14a34":  "0x2858Cb1D9C7b2e0420d04A0E988c4C425eF50964", // Base Sepolia
};

// balanceOf(address) selector = keccak256("balanceOf(address)")[0:4]
const BALANCE_OF_SELECTOR = "0x70a08231";

// Fetch real USDC balance via eth_call to the ERC-20 contract
async function fetchUSDCBalance(address: string): Promise<number> {
  if (!window.ethereum) return 0;

  try {
    // Get current chain to pick the right USDC contract
    const chainHex = await window.ethereum.request({
      method: "eth_chainId",
    }) as string;

    const usdcContract = USDC_CONTRACTS[chainHex.toLowerCase()];
    if (!usdcContract) {
      console.warn(`[wallet] No USDC contract for chain ${chainHex}`);
      return 0;
    }

    // Encode balanceOf(address) call data
    // Pad address to 32 bytes: remove 0x, left-pad with zeros to 64 hex chars
    const paddedAddress = address.slice(2).toLowerCase().padStart(64, "0");
    const callData      = BALANCE_OF_SELECTOR + paddedAddress;

    const result = await window.ethereum.request({
      method: "eth_call",
      params: [{
        to:   usdcContract,
        data: callData,
      }, "latest"],
    }) as string;

    if (!result || result === "0x") return 0;

    // result is a 32-byte hex uint256 — USDC has 6 decimals
    const raw     = BigInt(result);
    const balance = Number(raw) / 1_000_000; // convert from 6-decimal units
    return Math.floor(balance * 100) / 100;  // round to 2 decimal places

  } catch (err) {
    console.warn("[wallet] fetchUSDCBalance failed:", err);
    return 0;
  }
}

// Fetch mCOLL (collateral token) balance via eth_call
async function fetchCollateralBalance(address: string): Promise<number> {
  if (!window.ethereum) return 0;

  try {
    const chainHex = await window.ethereum.request({
      method: "eth_chainId",
    }) as string;

    const collContract = COLL_CONTRACTS[chainHex.toLowerCase()];
    if (!collContract) return 0;

    const paddedAddress = address.slice(2).toLowerCase().padStart(64, "0");
    const callData      = BALANCE_OF_SELECTOR + paddedAddress;

    const result = await window.ethereum.request({
      method: "eth_call",
      params: [{ to: collContract, data: callData }, "latest"],
    }) as string;

    if (!result || result === "0x") return 0;

    // mCOLL has 6 decimals
    const raw = BigInt(result);
    const balance = Number(raw) / 1_000_000;
    return Math.floor(balance * 100) / 100;

  } catch (err) {
    console.warn("[wallet] fetchCollateralBalance failed:", err);
    return 0;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseTier(tier: string): CreditTier {
  if (tier === "Platinum" || tier === "Gold" || tier === "Silver" || tier === "Bronze") {
    return tier as CreditTier;
  }
  return "Bronze";
}

function hasEthereum(): boolean {
  return typeof window !== "undefined" && typeof window.ethereum !== "undefined";
}

function goLoansToFrontend(
  goLoans: Awaited<ReturnType<typeof backendApi.getLoanStatus>>["active_loans"]
): Loan[] {
  if (!goLoans) return []; // Go returns null for empty arrays
  return goLoans.map((l) => ({
    id:               l.loan_id,
    borrowedAmount:   l.amount_usdc,
    collateralAmount: 0,
    collateralAsset:  "mCOLL" as const,
    aprRate:          l.interest_apr / 100,
    healthFactor:     2.0,
    dueDate:          l.due_date,
    repaidPercent:    l.status === "repaid" ? 100 : 0,
    status:           l.status === "defaulted" ? "liquidated" as const
                    : l.status === "repaid"    ? "repaid"     as const
                    : "active" as const,
    openedAt:         l.created_at,
    txHash:           l.tx_hash ?? "",
    solidityLoanId:   l.solidity_loan_id,
  }));
}

async function loadLoansFromBackend(
  address: string,
  dispatch: ReturnType<typeof useAppDispatch>
) {
  try {
    const [loanStatus, depositStatus] = await Promise.all([
      backendApi.getLoanStatus(address),
      backendApi.getDeposits(address).catch(() => null),
    ]);

    const allLoans = [
      ...goLoansToFrontend(loanStatus.active_loans),
      ...goLoansToFrontend(loanStatus.loan_history),
    ];
    dispatch(setLoans(allLoans));

    // Load real deposit positions (replaces array to avoid duplicates on re-connect)
    const { setDeposits } = await import("@/store/financeSlice");
    const positions = (depositStatus?.deposits ?? []).map((d: import("@/lib/backendApi").GoDepositRecord) => ({
      id:           d.deposit_id,
      amount:       d.amount_usdc,
      sharePercent: d.share_percent,
      earnedYield:  d.earned_yield,
      depositedAt:  d.deposited_at,
      currentValue: d.current_value,
    }));
    dispatch(setDeposits(positions));
  } catch (err) {
    console.warn("[wallet] Failed to load from backend (offline?):", err instanceof Error ? err.message : String(err));
    dispatch(setLoans([]));
  }
}

async function postConnect(address: string): Promise<CreditTier> {
  backendApi.registerWallet(address).catch((err) => {
    console.warn("[wallet] register failed (non-fatal):", err instanceof Error ? err.message : String(err));
  });
  // Retry once after 2 s — handles transient 503 when scoring engine is starting up
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const score = await backendApi.getScore(address);
      return parseTier(score.tier);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt === 0 && (msg.includes("503") || msg.includes("unavailable") || msg.includes("Failed to fetch"))) {
        console.warn("[wallet] score fetch failed (attempt 1), retrying in 2 s…");
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      console.warn("[wallet] score fetch failed, defaulting to Bronze:", msg);
      return "Bronze";
    }
  }
  return "Bronze";
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useWallet() {
  const dispatch = useAppDispatch();
  const wallet   = useAppSelector((s) => s.wallet);

  // Listen for MetaMask account/chain changes
  useEffect(() => {
    if (!hasEthereum()) return;

    const handleAccountsChanged = async (accounts: unknown) => {
      const addrs = accounts as string[];
      if (!addrs || addrs.length === 0) {
        dispatch(setDisconnected());
        dispatch(clearLoans());
      } else {
        const newAddress = addrs[0].toLowerCase();
        if (newAddress !== wallet.address) {
          dispatch(clearLoans());
          const [chainId, tier, usdcBalance, collateralBalance] = await Promise.all([
            getChainId(),
            postConnect(newAddress),
            fetchUSDCBalance(newAddress),
            fetchCollateralBalance(newAddress),
          ]);
          dispatch(setConnected({
            address:          newAddress,
            chainId,
            balance:          usdcBalance,
            collateralBalance,
            ethBalance:       0,
            tier,
          }));
          loadLoansFromBackend(newAddress, dispatch);
        }
      }
    };

    const handleChainChanged = () => { window.location.reload(); };

    window.ethereum!.on("accountsChanged", handleAccountsChanged);
    window.ethereum!.on("chainChanged",    handleChainChanged);
    return () => {
      window.ethereum!.removeListener("accountsChanged", handleAccountsChanged);
      window.ethereum!.removeListener("chainChanged",    handleChainChanged);
    };
  }, [dispatch, wallet.address]);

  // Auto-detect already-connected MetaMask account on mount
  useEffect(() => {
    if (!hasEthereum() || wallet.status !== "disconnected") return;
    (async () => {
      try {
        const accounts = await window.ethereum!.request({ method: "eth_accounts" }) as string[];
        if (!accounts || accounts.length === 0) return;
        const address = accounts[0].toLowerCase();
        dispatch(setConnecting());
        const [chainId, tier, usdcBalance, collateralBalance] = await Promise.all([
          getChainId(),
          postConnect(address),
          fetchUSDCBalance(address),
          fetchCollateralBalance(address),
        ]);
        dispatch(setConnected({ address, chainId, balance: usdcBalance, collateralBalance, ethBalance: 0, tier }));
        loadLoansFromBackend(address, dispatch);
      } catch (err) {
        console.warn("[wallet] auto-detect failed:", err);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Connect
  const connect = useCallback(async () => {
    dispatch(setConnecting());
    try {
      let address: string;

      if (hasEthereum()) {
        const accounts = await window.ethereum!.request({
          method: "eth_requestAccounts",
        }) as string[];
        if (!accounts || accounts.length === 0) {
          throw new Error("No accounts returned from wallet");
        }
        address = accounts[0].toLowerCase();
        console.info("[wallet] Connected:", address);
      } else {
        console.warn("[wallet] No MetaMask — using demo address");
        await new Promise((r) => setTimeout(r, 800));
        address = "0x4e8f2d1a9b3c7e0f5d2a8b1c4e7f0a3d6b9c2e5f";
      }

      // Fetch tier + USDC + collateral balance concurrently
      const [chainId, tier, usdcBalance, collateralBalance] = await Promise.all([
        getChainId(),
        postConnect(address),
        fetchUSDCBalance(address),
        fetchCollateralBalance(address),
      ]);

      console.info(`[wallet] USDC balance: ${usdcBalance}, mCOLL balance: ${collateralBalance}`);

      // Set connected with real balance
      dispatch(setConnected({
        address,
        chainId,
        balance:          usdcBalance,
        collateralBalance,
        ethBalance:       0,
        tier,
      }));

      // Load real loans from Go backend
      await loadLoansFromBackend(address, dispatch);

    } catch (err: unknown) {
      console.error("[wallet] Connection failed:", err);
      dispatch(setDisconnected());
    }
  }, [dispatch]);

  // Disconnect
  const disconnect = useCallback(() => {
    dispatch(setDisconnected());
    dispatch(clearLoans());
  }, [dispatch]);

  const refreshBalance = useCallback(async () => {
    if (!wallet.address) return;
    const [balance, collateralBalance] = await Promise.all([
      fetchUSDCBalance(wallet.address),
      fetchCollateralBalance(wallet.address),
    ]);
    dispatch(updateBalance({ balance, collateralBalance }));
  }, [dispatch, wallet.address]);

  const shortAddress = wallet.address
    ? `${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`
    : null;

  const chainName = wallet.chainId
    ? (CHAIN_NAMES[wallet.chainId] ?? wallet.chainId.toUpperCase())
    : null;

  return {
    ...wallet,
    shortAddress,
    chainName,
    isConnected:  wallet.status === "connected",
    isConnecting: wallet.status === "connecting",
    connect,
    disconnect,
    refreshBalance,
  };
}
