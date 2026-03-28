"use client";
import { useWallet } from "@/hooks/useWallet";
import { clearToasts } from "@/store/toastSlice";
import { useAppDispatch } from "@/store/hooks";
import { clsx } from "clsx";

const TIER_ICON: Record<string, string> = {
  Platinum: "♦", Gold: "★", Silver: "◈", Bronze: "○",
};

export function WalletButton() {
  const { status, shortAddress, tier, balance, connect, disconnect } = useWallet();
  const dispatch = useAppDispatch();

  const handleDisconnect = () => { dispatch(clearToasts()); disconnect(); };

  if (status === "connected") {
    return (
      <div className="flex items-center gap-2">
        <div className="hidden sm:flex items-center gap-1.5 font-mono text-sm text-[#aaa] border border-white/[0.1] px-3 py-2 bg-[#0a0a0a]">
          <span className="text-white font-medium">{balance.toLocaleString("en", { maximumFractionDigits: 0 })}</span>
          <span>USDC</span>
        </div>
        {tier && (
          <span className="hidden sm:block font-mono text-xs text-[#999] border border-white/[0.1] px-2.5 py-2 uppercase tracking-widest">
            {TIER_ICON[tier] ?? "○"} {tier}
          </span>
        )}
        <button
          onClick={handleDisconnect}
          title="Click to disconnect"
          className="font-mono text-sm tracking-wide uppercase text-white border border-white/[0.14] px-4 py-2 bg-white/[0.04] hover:bg-white/[0.09] hover:border-white/30 transition-all flex items-center gap-2"
        >
          <span className="w-2 h-2 bg-white rounded-full pulse-dot" />
          {shortAddress}
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={connect}
      disabled={status === "connecting"}
      className={clsx(
        "font-mono text-sm tracking-widest uppercase px-5 py-2.5 transition-all flex items-center gap-2",
        status === "connecting"
          ? "bg-white/10 text-[#777] cursor-wait"
          : "bg-white text-black hover:bg-[#e8e8e8] active:scale-[.97]"
      )}
    >
      {status === "connecting" ? (
        <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Connecting...</>
      ) : "Connect Wallet"}
    </button>
  );
}
