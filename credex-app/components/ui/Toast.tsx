"use client";
import { useEffect, useState } from "react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { removeToast } from "@/store/toastSlice";
import type { Toast } from "@/store/toastSlice";
import { clsx } from "clsx";

function ToastItem({ toast }: { toast: Toast }) {
  const dispatch = useAppDispatch();
  const [exiting, setExiting] = useState(false);

  const dismiss = () => {
    setExiting(true);
    setTimeout(() => dispatch(removeToast(toast.id)), 240);
  };

  useEffect(() => {
    const duration = toast.duration !== undefined ? toast.duration : 4000;
    if (duration === 0) return; // persist until manually dismissed
    const t = setTimeout(dismiss, duration);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast.id, toast.duration]);

  const ICON: Record<string, string> = {
    success: "✓",
    error:   "✗",
    info:    "○",
    loading: "◌",
  };

  return (
    <div
      className={clsx(
        "flex items-start gap-3 w-72 p-4 border bg-[#0c0c0c]",
        exiting ? "toast-out" : "toast-in",
        toast.type === "success" && "border-white/[0.2]",
        toast.type === "error"   && "border-white/[0.12]",
        toast.type === "info"    && "border-white/[0.08]",
        toast.type === "loading" && "border-white/[0.08] shimmer",
      )}
    >
      {/* Icon */}
      <span className={clsx(
        "font-mono text-xs w-4 shrink-0 mt-px",
        toast.type === "loading" && "animate-spin inline-block",
        toast.type === "success" ? "text-white" : "text-[#aaa]",
      )}>
        {ICON[toast.type]}
      </span>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="font-mono text-xs text-white tracking-widest leading-tight">{toast.title}</p>
        {toast.message && (
          <p className="font-mono text-xs text-[#999] mt-1 leading-relaxed break-words">{toast.message}</p>
        )}
      </div>

      {/* Dismiss */}
      <button
        onClick={dismiss}
        className="text-[#777] hover:text-white font-mono text-sm shrink-0 mt-px transition-colors leading-none"
      >
        ×
      </button>
    </div>
  );
}

export function ToastContainer() {
  const toasts = useAppSelector((s) => s.toast.toasts);
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-[9999] flex flex-col gap-2 items-end">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}
