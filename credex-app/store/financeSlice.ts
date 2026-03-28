import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import type { Loan, DepositPosition } from "@/types";

interface FinanceState {
  loans: Loan[];
  deposits: DepositPosition[];
  pendingRepaymentId: string | null;
  pendingDepositAmount: number;
  depositTxPending: boolean;
  depositTxHash: string | null;
  depositSuccess: boolean;
}

// Empty initial state — real loans loaded from Go backend on wallet connect
const initialState: FinanceState = {
  loans:                [],
  deposits:             [],
  pendingRepaymentId:   null,
  pendingDepositAmount: 0,
  depositTxPending:     false,
  depositTxHash:        null,
  depositSuccess:       false,
};

export const financeSlice = createSlice({
  name: "finance",
  initialState,
  reducers: {
    addLoan(state, action: PayloadAction<Loan>) {
      state.loans.unshift(action.payload);
    },
    // Load real loans from Go backend (replaces the entire loans array)
    setLoans(state, action: PayloadAction<Loan[]>) {
      state.loans = action.payload;
    },
    updateLoanRepayment(
      state,
      action: PayloadAction<{ id: string; repaidPercent: number }>
    ) {
      const loan = state.loans.find((l) => l.id === action.payload.id);
      if (loan) {
        loan.repaidPercent = action.payload.repaidPercent;
        if (action.payload.repaidPercent >= 100) loan.status = "repaid";
      }
    },
    updateLoanHealth(
      state,
      action: PayloadAction<{ id: string; healthFactor: number }>
    ) {
      const loan = state.loans.find((l) => l.id === action.payload.id);
      if (loan) loan.healthFactor = action.payload.healthFactor;
    },
    setPendingRepayment(state, action: PayloadAction<string | null>) {
      state.pendingRepaymentId = action.payload;
    },
    clearLoans(state) {
      state.loans = [];
    },
    // Deposit flow
    startDeposit(state, action: PayloadAction<number>) {
      state.pendingDepositAmount = action.payload;
      state.depositTxPending    = true;
      state.depositTxHash       = null;
      state.depositSuccess      = false;
    },
    confirmDeposit(
      state,
      action: PayloadAction<{ txHash: string; position: DepositPosition }>
    ) {
      state.depositTxPending = false;
      state.depositTxHash    = action.payload.txHash;
      state.depositSuccess   = true;
      state.deposits.unshift(action.payload.position);
    },
    resetDepositFlow(state) {
      state.depositTxPending    = false;
      state.depositTxHash       = null;
      state.depositSuccess      = false;
      state.pendingDepositAmount = 0;
    },
    tickYield(state) {
      const APY       = 0.1482;
      const perSecond = APY / (365 * 24 * 3600);
      state.deposits  = state.deposits.map((d) => ({
        ...d,
        earnedYield:  d.earnedYield + d.amount * perSecond,
        currentValue: d.amount + d.earnedYield + d.amount * perSecond,
      }));
    },
  },
});

export const {
  addLoan,
  setLoans,
  updateLoanRepayment,
  updateLoanHealth,
  setPendingRepayment,
  clearLoans,
  startDeposit,
  confirmDeposit,
  resetDepositFlow,
  tickYield,
} = financeSlice.actions;
export default financeSlice.reducer;
