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
// Circle's official USDC on each network
const USDC_CONTRACTS: Record<string, string> = {
  "0xaa36a7": "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", // Sepolia
  "0x1":      "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // Mainnet
  "0x89":     "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", // Polygon
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
  return goLoans.map((l) => ({
    id:               l.loan_id,
    borrowedAmount:   l.amount_usdc,
    collateralAmount: 0,
    collateralAsset:  "WETH" as const,
    aprRate:          l.interest_apr / 100,
    healthFactor:     2.0,
    dueDate:          l.due_date,
    repaidPercent:    l.status === "repaid" ? 100 : 0,
    status:           l.status === "defaulted" ? "liquidated" as const
                    : l.status === "repaid"    ? "repaid"     as const
                    : "active" as const,
    openedAt:         l.created_at,
    txHash:           l.tx_hash ?? "",
  }));
}

async function loadLoansFromBackend(
  address: string,
  dispatch: ReturnType<typeof useAppDispatch>
) {
  try {
    const status = await backendApi.getLoanStatus(address);
    const allLoans = [
      ...goLoansToFrontend(status.active_loans),
      ...goLoansToFrontend(status.loan_history),
    ];
    dispatch(setLoans(allLoans));
  } catch (err) {
    console.warn("[wallet] Failed to load loans from backend:", err);
    dispatch(setLoans([]));
  }
}

async function postConnect(address: string): Promise<CreditTier> {
  backendApi.registerWallet(address, 0).catch((err) => {
    console.warn("[wallet] register failed (non-fatal):", err);
  });
  try {
    const score = await backendApi.getScore(address);
    return parseTier(score.tier);
  } catch (err) {
    console.warn("[wallet] score fetch failed, defaulting to Bronze:", err);
    return "Bronze";
  }
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
          const [tier, usdcBalance] = await Promise.all([
            postConnect(newAddress),
            fetchUSDCBalance(newAddress),
          ]);
          dispatch(setConnected({
            address:    newAddress,
            balance:    usdcBalance,
            ethBalance: 0,
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

      // Fetch tier + USDC balance concurrently
      const [tier, usdcBalance] = await Promise.all([
        postConnect(address),
        fetchUSDCBalance(address),
      ]);

      console.info(`[wallet] USDC balance: ${usdcBalance}`);

      // Set connected with real balance
      dispatch(setConnected({
        address,
        balance:    usdcBalance,
        ethBalance: 0,
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
    const balance = await fetchUSDCBalance(wallet.address);
    dispatch(updateBalance({ balance }));
  }, [dispatch, wallet.address]);

  const shortAddress = wallet.address
    ? `${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`
    : null;

  return {
    ...wallet,
    shortAddress,
    isConnected:  wallet.status === "connected",
    isConnecting: wallet.status === "connecting",
    connect,
    disconnect,
    refreshBalance,
  };
}
