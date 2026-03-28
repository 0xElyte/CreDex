"use client";
import { useQuery } from "@tanstack/react-query";
import {
  fetchPoolStats, fetchActivityFeed,
  fetchCreditScore, fetchCollateralOptions,
} from "@/lib/api";
import { useAppSelector } from "@/store/hooks";

// Pool stats — mocked (no backend equivalent)
export function usePoolStats() {
  return useQuery({
    queryKey: ["pool-stats"],
    queryFn:  fetchPoolStats,
    refetchInterval: 10_000,
    staleTime:        8_000,
  });
}

// Activity feed — mocked
export function useActivityFeed() {
  return useQuery({
    queryKey: ["activity-feed"],
    queryFn:  fetchActivityFeed,
    refetchInterval: 6_000,
    staleTime:        5_000,
  });
}

// Credit score — real backend, keyed on wallet address
export function useCreditScore() {
  const address = useAppSelector((s) => s.wallet.address);
  return useQuery({
    queryKey: ["credit-score", address],
    queryFn:  () => fetchCreditScore(address ?? undefined),
    staleTime: Infinity, // score doesn't change during a session
    enabled:   true,     // always run (returns fallback when no wallet)
  });
}

// Collateral options — mocked (price oracle not in Go backend)
export function useCollateralOptions() {
  return useQuery({
    queryKey: ["collateral-options"],
    queryFn:  fetchCollateralOptions,
    refetchInterval: 30_000,
    staleTime:        25_000,
  });
}
