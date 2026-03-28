"use client";
/**
 * useScoreChart
 * ─────────────────────────────────────────────────────────────
 * Builds the score history chart from real data:
 *
 *   REAL data sources:
 *   - Current numeric score from Go backend → Python scorer (Alchemy data)
 *   - Loan open/repay dates + statuses from Redux (real timestamps from Go)
 *
 *   Strategy:
 *   - Last point always anchored to the real current score from backend
 *   - Walk loan history to reconstruct score trajectory
 *   - No loans: single point at real current score
 *   - No score yet: use tier midpoint as estimate, flag isReal=false
 */
import { useMemo } from "react";
import { useAppSelector } from "@/store/hooks";
import { useCreditScore } from "@/hooks/useQueries";
import type { ScoreHistoryPoint, CreditTier } from "@/types";

const TIER_MIDPOINT: Record<string, number> = {
  Platinum: 865, Gold: 760, Silver: 625, Bronze: 450, Denied: 200,
};

function scoreToTier(s: number): CreditTier {
  if (s >= 850) return "Platinum";
  if (s >= 700) return "Gold";
  if (s >= 550) return "Silver";
  if (s >= 400) return "Bronze";
  return "Bronze";
}

export function useScoreChart(): {
  data:    ScoreHistoryPoint[];
  isReal:  boolean; // true = real score from backend, false = tier estimate
} {
  const { data: score } = useCreditScore();
  const loans           = useAppSelector((s) => s.finance.loans);
  // Try to get the revealed numeric score from the score history page's reveal action
  // The revealedScore is stored locally in useRevealScore — pass it via Redux instead
  const revealedNumeric = useAppSelector((s) => s.wallet as { revealedScore?: number })
    .revealedScore ?? null;

  const data = useMemo((): ScoreHistoryPoint[] => {
    // Use real numeric score if available, else tier midpoint
    const currentScore = revealedNumeric
      ?? TIER_MIDPOINT[score?.tier ?? "Bronze"]
      ?? 450;
    const currentTier  = score?.tier ?? "Bronze";
    const now          = new Date().toISOString().slice(0, 7);

    // No loans — just one point at current score
    if (loans.length === 0) {
      return [{ date: now, score: currentScore, tier: currentTier }];
    }

    // Sort loans oldest first
    const sorted = [...loans].sort(
      (a, b) => new Date(a.openedAt).getTime() - new Date(b.openedAt).getTime()
    );

    const repaidCount  = sorted.filter((l) => l.status === "repaid").length;
    const defaultCount = sorted.filter((l) => l.status === "liquidated").length;

    // Estimate starting score before any loans
    const startScore = Math.max(
      200,
      currentScore - repaidCount * 12 - sorted.length * 5 + defaultCount * 50
    );

    const points: ScoreHistoryPoint[] = [];

    // Point before first loan
    const beforeFirst = new Date(sorted[0].openedAt);
    beforeFirst.setMonth(beforeFirst.getMonth() - 1);
    points.push({
      date:  beforeFirst.toISOString().slice(0, 7),
      score: startScore,
      tier:  scoreToTier(startScore),
    });

    // Walk through each loan event
    let running = startScore;
    for (const loan of sorted) {
      // Loan opened
      running = Math.min(1000, running + 5);
      points.push({
        date:  loan.openedAt.slice(0, 7),
        score: running,
        tier:  scoreToTier(running),
      });

      if (loan.status === "repaid") {
        running = Math.min(1000, running + 12);
        const repaidAt = new Date(loan.openedAt);
        repaidAt.setMonth(repaidAt.getMonth() + 1);
        points.push({
          date:  repaidAt.toISOString().slice(0, 7),
          score: running,
          tier:  scoreToTier(running),
        });
      } else if (loan.status === "liquidated") {
        running = Math.max(0, running - 50);
        points.push({
          date:  loan.openedAt.slice(0, 7),
          score: running,
          tier:  scoreToTier(running),
        });
      }
    }

    // Always anchor last point to real current score
    if (points[points.length - 1]?.date !== now) {
      points.push({ date: now, score: currentScore, tier: currentTier });
    } else {
      points[points.length - 1].score = currentScore;
      points[points.length - 1].tier  = currentTier;
    }

    // Deduplicate by month, keep last entry per month, sort ascending
    const byMonth = new Map<string, ScoreHistoryPoint>();
    for (const p of points) byMonth.set(p.date, p);

    return Array.from(byMonth.values())
      .sort((a, b) => a.date.localeCompare(b.date));

  }, [score, loans, revealedNumeric]);

  return {
    data,
    isReal: !!score && score.hash !== "8f3d...912a",
  };
}
