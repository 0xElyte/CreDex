import { useCallback, useState } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { startDeposit, confirmDeposit, resetDepositFlow } from "@/store/financeSlice";
import { updateBalance } from "@/store/walletSlice";
import { addToast, dismissLoading } from "@/store/toastSlice";
import { executeDeposit } from "@/lib/api";
import type { DepositPosition } from "@/types";

const LOADING_TOAST_ID = "deposit-loading";

export function useDeposit() {
  const dispatch = useAppDispatch();
  const { depositTxPending, depositTxHash, depositSuccess, deposits } =
    useAppSelector((s) => s.finance);
  const walletAddress = useAppSelector((s) => s.wallet.address);
  const walletBalance = useAppSelector((s) => s.wallet.balance);
  const [stepMessage, setStepMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  const deposit = useCallback(async (amount: number) => {
    if (!walletAddress) return;
    setError(null);
    setStepMessage("");
    dispatch(startDeposit(amount));
    dispatch(addToast({
      id: LOADING_TOAST_ID,
      type: "loading",
      title: "Processing Deposit",
      message: "Approving USDC spend...",
      duration: 0,
    }));

    try {
      const result = await executeDeposit(
        { amount, walletAddress: walletAddress! },
        (msg) => setStepMessage(msg)
      );

      const position: DepositPosition = {
        id: `DEP-${Date.now()}`,
        amount: result.depositedAmount,
        sharePercent: result.sharePercent,
        earnedYield: 0,
        depositedAt: result.timestamp,
        currentValue: result.depositedAmount,
      };

      dispatch(confirmDeposit({ txHash: result.txHash, position }));
      // Balance will be refreshed from chain after deposit confirms
      // For immediate UI feedback, subtract locally
      dispatch(updateBalance({ balance: Math.max(0, walletBalance - amount) }));
      setStepMessage("Deposit confirmed!");

      // Dismiss loading, show success
      dispatch(dismissLoading());
      dispatch(addToast({
        type: "success",
        title: "Deposit Confirmed ✓",
        message: `${amount.toLocaleString()} USDC · Est. +$${(amount * 0.1482).toLocaleString("en", { maximumFractionDigits: 0 })}/yr`,
      }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Deposit failed";
      setError(msg);
      dispatch(resetDepositFlow());
      dispatch(dismissLoading());
      dispatch(addToast({ type: "error", title: "Deposit Failed", message: msg }));
    }
  }, [dispatch, walletAddress, walletBalance]);

  const reset = useCallback(() => {
    dispatch(resetDepositFlow());
    setStepMessage("");
    setError(null);
  }, [dispatch]);

  return {
    deposit,
    reset,
    isPending: depositTxPending,
    txHash: depositTxHash,
    success: depositSuccess,
    stepMessage,
    error,
    deposits,
  };
}
