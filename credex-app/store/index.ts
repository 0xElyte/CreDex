import { configureStore } from "@reduxjs/toolkit";
import walletReducer from "./walletSlice";
import zkReducer from "./zkSlice";
import financeReducer from "./financeSlice";
import toastReducer from "./toastSlice";

export const store = configureStore({
  reducer: {
    wallet: walletReducer,
    zk: zkReducer,
    finance: financeReducer,
    toast: toastReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
