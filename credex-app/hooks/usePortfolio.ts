"use client";
import { useQuery } from "@tanstack/react-query";
import { useState, useCallback } from "react";
import { fetchPortfolioStats, fetchScoreHistory, fetchCreditEvents, revealScore } from "@/lib/api";
import { useAppSelector } from "@/store/hooks";

export function usePortfolio() {
  const loans    = useAppSelector((s) => s.finance.loans);
  const deposits = useAppSelector((s) => s.finance.deposits);
  const address  = useAppSelector((s) => s.wallet.address);

  const statsQuery = useQuery({
    queryKey: ["portfolio-stats", address],
    queryFn:  () => fetchPortfolioStats(address ?? undefined),
    refetchInterval: 15_000,
  });

  return { ...statsQuery, loans, deposits };
}

export function useScoreHistory() {
  const historyQuery = useQuery({
    queryKey: ["score-history"],
    queryFn:  fetchScoreHistory,
    staleTime: 60_000,
  });
  const eventsQuery = useQuery({
    queryKey: ["credit-events"],
    queryFn:  fetchCreditEvents,
    staleTime: 60_000,
  });
  return { historyQuery, eventsQuery };
}

export function useRevealScore() {
  const address = useAppSelector((s) => s.wallet.address);
  const [isRevealing,  setIsRevealing]  = useState(false);
  const [revealedScore, setRevealedScore] = useState<number | null>(null);

  const reveal = useCallback(async () => {
    setIsRevealing(true);
    try {
      const { numericScore } = await revealScore(address ?? undefined);
      setRevealedScore(numericScore);
    } finally {
      setIsRevealing(false);
    }
  }, [address]);

  return { reveal, isRevealing, revealedScore };
}
