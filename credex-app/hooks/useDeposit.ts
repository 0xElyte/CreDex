"use client";
import { useState, useCallback } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { updateBalance } from "@/store/walletSlice";
import { confirmDeposit, startDeposit } from "@/store/financeSlice";
import { executeDeposit } from "@/lib/api";

export function useDeposit() {
  const dispatch      = useAppDispatch();
  const walletAddress = useAppSelector((s) => s.wallet.address);
  const walletBalance = useAppSelector((s) => s.wallet.balance);
  const [isPending,  setIsPending]  = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [stepText,   setStepText]   = useState<string>("");

  const handleDeposit = useCallback(async (amount: number) => {
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
    setStepText("Initiating deposit...");
    dispatch(startDeposit(amount));

    try {
      const result = await executeDeposit(walletAddress, amount, setStepText);

      // Generate a deposit position ID
      const depositId = `DEP-${walletAddress.slice(2, 6).toUpperCase()}-${Date.now() % 100000}`;

      dispatch(confirmDeposit({
        txHash:   result.txHash,
        position: {
          id:           depositId,
          amount,
          sharePercent: 0,        // on-chain share computed separately
          earnedYield:  0,
          depositedAt:  new Date().toISOString(),
          currentValue: amount,
        },
      }));

      // Refresh wallet balance after on-chain deduction
      dispatch(updateBalance({ balance: Math.max(0, walletBalance - amount) }));

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Deposit failed";
      setError(msg);
    } finally {
      setIsPending(false);
      setStepText("");
    }
  }, [walletAddress, walletBalance, dispatch]);

  return { executeDeposit: handleDeposit, isPending, error, stepText };
}
