import { useCallback } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  startProof, setStep, setCairoStep, appendLog,
  setTxHash, setConfirmed, setFailed, resetProof,
} from "@/store/zkSlice";
import { addLoan } from "@/store/financeSlice";
import { addToast, dismissLoading } from "@/store/toastSlice";
import { executeBorrow } from "@/lib/api";
import type { BorrowRequestPayload, Loan } from "@/types";

const LOADING_TOAST_ID = "zk-proof-loading";

export function useZKProof() {
  const dispatch = useAppDispatch();
  const zkState = useAppSelector((s) => s.zk);

  const runProof = useCallback(async (payload: BorrowRequestPayload) => {
    dispatch(startProof());
    dispatch(setStep("submitting"));
    dispatch(addToast({
      id: LOADING_TOAST_ID,
      type: "loading",
      title: "ZK Proof Generating",
      message: "Cairo VM executing on StarkNet...",
      duration: 0,
    }));

    try {
      const result = await executeBorrow(
        payload,
        (msg) => dispatch(appendLog(msg)),
        (step) => {
          dispatch(setCairoStep(step));
          if (step === 1) dispatch(setStep("cairo_executing"));
        },
        (hash) => {
          dispatch(setTxHash(hash));
          dispatch(setStep("broadcasting"));
        }
      );

      dispatch(setStep("proof_generated"));

      const newLoan: Loan = {
        id: result.loanId,
        borrowedAmount: payload.amount,
        collateralAmount: result.collateralRequired,
        collateralAsset: payload.collateralAsset,
        aprRate: result.aprRate,
        healthFactor: result.healthFactor,
        dueDate: result.dueDate ?? new Date(Date.now() + payload.duration * 86_400_000).toISOString(),
        repaidPercent: 0,
        status: "active",
        openedAt: new Date().toISOString(),
        txHash: result.txHash,
        solidityLoanId: result.solidityLoanId,
      };
      dispatch(addLoan(newLoan));
      dispatch(setConfirmed({ txHash: result.txHash, proofHash: result.proofHash }));

      // Dismiss loading, show success
      dispatch(dismissLoading());
      dispatch(addToast({
        type: "success",
        title: "Loan Approved ✓",
        message: `${result.loanId} · ${payload.amount.toLocaleString()} USDC borrowed at ${(result.aprRate * 100).toFixed(1)}% APR`,
      }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Proof generation failed";
      dispatch(setFailed(msg));
      dispatch(dismissLoading());
      dispatch(addToast({ type: "error", title: "ZK Proof Failed", message: msg }));
    }
  }, [dispatch]);

  const reset = useCallback(() => dispatch(resetProof()), [dispatch]);
  const isRunning = !["idle", "confirmed", "failed"].includes(zkState.step);

  return { ...zkState, runProof, reset, isRunning };
}
