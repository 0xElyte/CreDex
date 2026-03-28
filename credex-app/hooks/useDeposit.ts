"use client";
import { useState, useCallback } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { updateBalance } from "@/store/walletSlice";
import { confirmDeposit, startDeposit } from "@/store/financeSlice";
import { backendApi } from "@/lib/backendApi";

export function useDeposit() {
  const dispatch      = useAppDispatch();
  const walletAddress = useAppSelector((s) => s.wallet.address);
  const walletBalance = useAppSelector((s) => s.wallet.balance);
  const [isPending,  setIsPending]  = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  const executeDeposit = useCallback(async (amount: number) => {
    if (!walletAddress) {
      setError("Wallet not connected");
      return;
    }
    if (amount <= 0 || amount > walletBalance) {
      setError("Invalid deposit amount");
      return;
    }

    setIsPending(true);
    setError(null);
    dispatch(startDeposit(amount));

    try {
      // Call real Go backend deposit endpoint
      const result = await backendApi.deposit(walletAddress, amount);

      // Update Redux with confirmed deposit
      dispatch(confirmDeposit({
        txHash:   result.tx_hash,
        position: {
          id:           result.deposit_id,
          amount:       result.amount_usdc,
          sharePercent: result.share_percent,
          earnedYield:  0,
          depositedAt:  result.deposited_at,
          currentValue: result.amount_usdc,
        },
      }));

      // Deduct from wallet balance immediately
      dispatch(updateBalance({ balance: Math.max(0, walletBalance - amount) }));

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Deposit failed";
      setError(msg);
      console.error("[deposit] failed:", err);
    } finally {
      setIsPending(false);
    }
  }, [walletAddress, walletBalance, dispatch]);

  return { executeDeposit, isPending, error };
}
