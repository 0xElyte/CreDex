import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import type { WalletState, CreditTier } from "@/types";

const initialState: WalletState = {
  status: "disconnected",
  address: null,
  balance: 0,
  ethBalance: 0,
  tier: null,
  zkProofActive: false,
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
  },
});

export const { setConnecting, setConnected, setDisconnected, updateBalance } =
  walletSlice.actions;
export default walletSlice.reducer;
