import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import type { WalletState, CreditTier } from "@/types";

const initialState: WalletState = {
  status: "disconnected",
  address: null,
  balance: 0,
  ethBalance: 0,
  tier: null,
  zkProofActive: false,
  revealedScore: null,
};

export const walletSlice = createSlice({
  name: "wallet",
  initialState,
  reducers: {
    setConnecting(state) {
      state.status = "connecting";
    },
    setConnected(
      state,
      action: PayloadAction<{
        address: string;
        balance: number;
        ethBalance: number;
        tier: CreditTier;
      }>
    ) {
      state.status = "connected";
      state.address = action.payload.address;
      state.balance = action.payload.balance;
      state.ethBalance = action.payload.ethBalance;
      state.tier = action.payload.tier;
      state.zkProofActive = true;
    },
    setDisconnected(state) {
      state.status = "disconnected";
      state.address = null;
      state.balance = 0;
      state.ethBalance = 0;
      state.tier = null;
      state.zkProofActive = false;
    },
    updateBalance(state, action: PayloadAction<{ balance: number }>) {
      state.balance = action.payload.balance;
    },
    setRevealedScore(state, action: PayloadAction<number>) {
      state.revealedScore = action.payload;
    },
  },
});

export const { setConnecting, setConnected, setDisconnected, updateBalance, setRevealedScore } =
  walletSlice.actions;
export default walletSlice.reducer;
