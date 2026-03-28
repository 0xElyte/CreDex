"use client";
import { useEffect, useState } from "react";
import { useDeposit } from "@/hooks/useDeposit";
import { ProgressBar } from "@/components/ui";
import { clsx } from "clsx";

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={copy}
      className="shrink-0 font-mono text-xs text-[#888] border border-white/[0.1] px-2 py-0.5 hover:text-white hover:border-white/30 transition-colors"
    >
      {copied ? "✓" : "copy"}
    </button>
  );
}

export function DepositModal({
  amount,
  onClose,
}: {
  amount: number;
  onClose: () => void;
}) {
  const { isPending, success, txHash, stepMessage, error, reset } = useDeposit();
  const [visible, setVisible] = useState(false);

  useEffect(() => { requestAnimationFrame(() => setVisible(true)); }, []);

  const handleClose = () => {
    setVisible(false);
    setTimeout(() => { reset(); onClose(); }, 180);
  };

  const progress = success ? 100
    : !isPending ? 0
    : stepMessage.includes("Broadcasting") ? 70
    : stepMessage.includes("pool") ? 85
    : stepMessage.includes("Confirmed") ? 95
    : 35;

  return (
    <div
      className={clsx(
        "modal-backdrop transition-opacity duration-200",
        visible ? "opacity-100" : "opacity-0"
      )}
      onClick={(e) => { if (e.target === e.currentTarget && (success || !!error)) handleClose(); }}
    >
      <div
        className={clsx(
          "modal-box max-w-md transition-all duration-200",
          visible ? "translate-y-0 scale-100" : "translate-y-4 scale-[.98]"
        )}
        style={{ transition: "transform .22s cubic-bezier(.16,1,.3,1), opacity .2s" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.08] shrink-0">
          <div className="flex items-center gap-3">
            <span className={clsx(
              "w-2 h-2 rounded-full",
              error ? "bg-[#888]" : success ? "bg-white" : "bg-white pulse-dot"
            )} />
            <span className="font-mono text-sm text-[#aaa] tracking-widest uppercase">
              {error ? "Transaction Failed" : success ? "Deposit Confirmed" : "Deposit Transaction"}
            </span>
          </div>
          {(success || !!error) && (
            <button onClick={handleClose} className="text-[#aaa] hover:text-white font-mono text-lg leading-none transition-colors">×</button>
          )}
        </div>

        {/* Scrollable body */}
        <div className="modal-body p-6 space-y-5">
          {/* Amount */}
          <div>
            <p className="font-mono text-xs text-[#777] uppercase tracking-wide mb-1">Depositing</p>
            <p className="font-mono text-4xl text-white">
              {amount.toLocaleString()} <span className="text-lg text-[#777]">USDC</span>
            </p>
          </div>

          {/* Progress */}
          <div>
            <div className="flex justify-between font-mono text-xs text-[#777] mb-2">
              <span className="uppercase tracking-wide">Progress</span>
              <span className="text-white">{progress}%</span>
            </div>
            <ProgressBar value={progress} pulse={isPending} />
          </div>

          {/* Step message */}
          <div className="bg-[#050505] border border-white/[0.07] px-4 py-4 min-h-[56px] relative">
            {isPending && <div className="absolute top-0 left-0 right-0 h-px shimmer" />}
            <p className="font-mono text-sm text-[#aaa] leading-relaxed">
              {stepMessage || (success ? "Deposit confirmed." : error || "Awaiting confirmation...")}
              {isPending && !stepMessage && <span className="blink ml-0.5">_</span>}
            </p>
          </div>

          {/* TX hash with copy — Issue 8 */}
          {txHash && (
            <div className="bg-[#0a0a0a] border border-white/[0.07] px-4 py-3">
              <div className="flex items-center justify-between mb-1.5">
                <p className="font-mono text-xs text-[#777] uppercase tracking-wide">TX Hash</p>
                <CopyBtn text={txHash} />
              </div>
              <p className="font-mono text-xs text-[#aaa] break-all">{txHash}</p>
            </div>
          )}

          {/* Success breakdown */}
          {success && (
            <div className="grid grid-cols-3 gap-2 slide-up">
              {[
                { label: "30D Yield",    value: `+$${((amount * 0.1482) / 12).toFixed(2)}` },
                { label: "Annual Yield", value: `+$${(amount * 0.1482).toLocaleString("en", { maximumFractionDigits: 0 })}` },
                { label: "APY",          value: "14.82%" },
              ].map((item) => (
                <div key={item.label} className="bg-[#0a0a0a] border border-white/[0.07] p-3 text-center">
                  <p className="font-mono text-base text-white">{item.value}</p>
                  <p className="font-mono text-xs text-[#777] uppercase tracking-wide mt-1">{item.label}</p>
                </div>
              ))}
            </div>
          )}

          {error && (
            <div className="border border-white/[0.1] px-4 py-3">
              <p className="font-mono text-sm text-[#aaa]">{error}</p>
            </div>
          )}

          {/* Action */}
          {success ? (
            <button
              onClick={handleClose}
              className="w-full bg-white text-black font-mono text-sm tracking-widest uppercase py-3 hover:bg-[#e8e8e8] transition-colors"
            >
              Done ✓
            </button>
          ) : error ? (
            <button
              onClick={handleClose}
              className="w-full border border-white/[0.14] text-[#aaa] font-mono text-sm tracking-widest uppercase py-3 hover:text-white hover:border-white/30 transition-colors"
            >
              Close
            </button>
          ) : (
            <p className="font-mono text-xs text-[#999] text-center tracking-wide uppercase">
              Do not close this window during the transaction
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
