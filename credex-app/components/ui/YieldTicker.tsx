"use client";
import { useEffect } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { tickYield } from "@/store/financeSlice";

/**
 * Invisible component that ticks deposit yield every second.
 * Mount once inside AppShell (only runs when user is in the app).
 */
export function YieldTicker() {
  const dispatch = useAppDispatch();
  const deposits = useAppSelector((s) => s.finance.deposits);

  useEffect(() => {
    if (deposits.length === 0) return;
    const interval = setInterval(() => {
      dispatch(tickYield());
    }, 1000);
    return () => clearInterval(interval);
  }, [dispatch, deposits.length]);

  return null;
}
