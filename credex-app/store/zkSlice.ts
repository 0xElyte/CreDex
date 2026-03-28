import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import type { ZKProofState, ZKStep } from "@/types";

const initialState: ZKProofState = {
  step: "idle",
  progress: 0,
  txHash: null,
  proofHash: null,
  stepLog: [],
  cairoStep: 0,
  totalCairoSteps: 1024,
  error: null,
};

export const zkSlice = createSlice({
  name: "zk",
  initialState,
  reducers: {
    startProof(state) {
      state.step = "submitting";
      state.progress = 0;
      state.txHash = null;
      state.proofHash = null;
      state.stepLog = [];
      state.cairoStep = 0;
      state.error = null;
    },
    setStep(state, action: PayloadAction<ZKStep>) {
      state.step = action.payload;
    },
    setProgress(state, action: PayloadAction<number>) {
      state.progress = action.payload;
    },
    setCairoStep(state, action: PayloadAction<number>) {
      state.cairoStep = action.payload;
      state.progress = Math.round((action.payload / state.totalCairoSteps) * 100);
    },
    appendLog(state, action: PayloadAction<string>) {
      state.stepLog = [...state.stepLog.slice(-9), action.payload];
    },
    setTxHash(state, action: PayloadAction<string>) {
      state.txHash = action.payload;
    },
    setProofHash(state, action: PayloadAction<string>) {
      state.proofHash = action.payload;
    },
    setConfirmed(
      state,
      action: PayloadAction<{ txHash: string; proofHash: string }>
    ) {
      state.step = "confirmed";
      state.progress = 100;
      state.txHash = action.payload.txHash;
      state.proofHash = action.payload.proofHash;
    },
    setFailed(state, action: PayloadAction<string>) {
      state.step = "failed";
      state.error = action.payload;
    },
    resetProof(state) {
      return initialState;
    },
  },
});

export const {
  startProof,
  setStep,
  setProgress,
  setCairoStep,
  appendLog,
  setTxHash,
  setProofHash,
  setConfirmed,
  setFailed,
  resetProof,
} = zkSlice.actions;
export default zkSlice.reducer;
