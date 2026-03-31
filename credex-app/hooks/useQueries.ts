"use client";
import { useQuery } from "@tanstack/react-query";
import type { PoolStats } from "@/types";
import {
  fetchPoolStats, fetchActivityFeed,
  fetchCreditScore, fetchCollateralOptions,
  fetchLendingAsset, fetchProtocolBalances, fetchUserLenderDeposit,
} from "@/lib/api";
import { useAppSelector } from "@/store/hooks";

// Pool stats — APY real from tiers, active loans real from wallet
export function usePoolStats() {
  const address = useAppSelector((s) => s.wallet.address);
  return useQuery<PoolStats>({
    queryKey: ["pool-stats", address],
    queryFn:  () => fetchPoolStats(address ?? undefined),
    refetchInterval: 15_000,
    staleTime:       10_000,
  });
}

// Activity feed — real wallet events + deterministic background activity
export function useActivityFeed() {
  const address = useAppSelector((s) => s.wallet.address);
  return useQuery({
    queryKey: ["activity-feed", address],
    queryFn:  () => fetchActivityFeed(address ?? undefined),
    refetchInterval: 30_000, // refresh every 30s (hourly seed means no flicker)
    staleTime:       25_000,
  });
}

// Credit score — real Go backend → Python scorer → Alchemy
export function useCreditScore() {
  const address = useAppSelector((s) => s.wallet.address);
  return useQuery({
    queryKey: ["credit-score", address],
    queryFn:  () => fetchCreditScore(address ?? undefined),
    staleTime: Infinity,
    enabled:   true,
  });
}

// Collateral prices — no price oracle in backend, use stable values
export function useCollateralOptions() {
  return useQuery({
    queryKey: ["collateral-options"],
    queryFn:  fetchCollateralOptions,
    refetchInterval: 30_000,
    staleTime:        25_000,
  });
}

// Lending asset symbol — reads ERC-20 symbol() from mUSDC contract on-chain
export function useLendingAsset() {
  return useQuery({
    queryKey: ["lending-asset"],
    queryFn:  fetchLendingAsset,
    staleTime: Infinity, // symbol never changes
    retry: 2,
  });
}

// Protocol balances — mUSDC and mCOLL held by the CredexLending contract
export function useProtocolBalances() {
  return useQuery({
    queryKey: ["protocol-balances"],
    queryFn:  fetchProtocolBalances,
    refetchInterval: 15_000,
    staleTime:       10_000,
  });
}

// User's on-chain lender deposit amount from lenderDeposits[user] mapping
export function useUserLenderDeposit() {
  const address = useAppSelector((s) => s.wallet.address);
  return useQuery({
    queryKey: ["user-lender-deposit", address],
    queryFn:  () => address ? fetchUserLenderDeposit(address) : Promise.resolve(0),
    enabled:  !!address,
    refetchInterval: 15_000,
    staleTime:       10_000,
  });
}
