import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export type ToastType = "success" | "error" | "info" | "loading";

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number; // ms — 0 = persist until manually dismissed
}

interface ToastState {
  toasts: Toast[];
}

const initialState: ToastState = { toasts: [] };

export const toastSlice = createSlice({
  name: "toast",
  initialState,
  reducers: {
    addToast(state, action: PayloadAction<Omit<Toast, "id"> & { id?: string }>) {
      const id = action.payload.id ?? `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      // Remove any existing toast with same id (for idempotent loading toasts)
      state.toasts = state.toasts.filter((t) => t.id !== id);
      state.toasts.push({ ...action.payload, id });
    },
    removeToast(state, action: PayloadAction<string>) {
      state.toasts = state.toasts.filter((t) => t.id !== action.payload);
    },
    // Remove all loading toasts — call this when an async operation finishes
    dismissLoading(state) {
      state.toasts = state.toasts.filter((t) => t.type !== "loading");
    },
    clearToasts(state) {
      state.toasts = [];
    },
  },
});

export const { addToast, removeToast, dismissLoading, clearToasts } = toastSlice.actions;
export default toastSlice.reducer;
