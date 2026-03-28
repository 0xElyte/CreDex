"use client";
import { useEffect, useRef, useState } from "react";
import { useZKProof } from "@/hooks/useZKProof";
import { ProgressBar } from "@/components/ui";
import { clsx } from "clsx";

const STEP_LABELS: Record<string, string> = {
  idle:            "Ready",
  submitting:      "Submitting to StarkNet...",
  cairo_executing: "Cairo VM Executing...",
  proof_generated: "Proof Generated ✓",
  broadcasting:    "Broadcasting to Network...",
  confirmed:       "Loan Confirmed ✓",
  failed:          "Failed",
};

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

export function ZKProofModal({ onClose }: { onClose: () => void }) {
  const {
    step, progress, txHash, proofHash,
    stepLog, cairoStep, totalCairoSteps,
    error, isRunning, reset,
  } = useZKProof();

  const logRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => { requestAnimationFrame(() => setVisible(true)); }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [stepLog]);

  const handleClose = () => {
    setVisible(false);
    setTimeout(() => { reset(); onClose(); }, 200);
  };

  const isConfirmed = step === "confirmed";
  const isFailed    = step === "failed";

  return (
    <div
      className={clsx(
        "modal-backdrop transition-opacity duration-200",
        visible ? "opacity-100" : "opacity-0"
      )}
      onClick={(e) => { if (e.target === e.currentTarget && (isConfirmed || isFailed)) handleClose(); }}
    >
      <div
        className={clsx(
          "modal-box max-w-lg transition-all duration-200",
          visible ? "translate-y-0 scale-100" : "translate-y-4 scale-[.98]"
        )}
        style={{ transition: "transform .22s cubic-bezier(.16,1,.3,1), opacity .2s" }}
      >
        {/* ── Header ──────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.08] shrink-0">
          <div className="flex items-center gap-3">
            <span className={clsx(
              "w-2 h-2 rounded-full",
              isConfirmed ? "bg-white" : isFailed ? "bg-[#888]" : "bg-white pulse-dot"
            )} />
            <span className="font-mono text-sm text-[#aaa] tracking-widest uppercase">
              Cairo VM Execution
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span className="font-mono text-xs text-[#999]">SP-420-ZK</span>
            {(isConfirmed || isFailed) && (
              <button onClick={handleClose} className="text-[#aaa] hover:text-white font-mono text-lg leading-none transition-colors">×</button>
            )}
          </div>
        </div>

        {/* ── Scrollable body ──────────────────────────────────── */}
        <div className="modal-body p-6 space-y-5">
          {/* Status + Cairo progress */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-mono text-xs text-[#777] tracking-widest uppercase mb-1">Status</p>
              <p className="font-mono text-base text-white">{STEP_LABELS[step] ?? step}</p>
            </div>
            {step === "cairo_executing" && (
              <div className="text-right shrink-0">
                <p className="font-mono text-xs text-[#777] uppercase tracking-wide mb-1">Cairo Step</p>
                <p className="font-mono text-base text-white">
                  {cairoStep.toLocaleString()} / {totalCairoSteps.toLocaleString()}
                </p>
              </div>
            )}
          </div>

          {/* Progress */}
          <div>
            <div className="flex justify-between font-mono text-xs text-[#777] mb-2">
              <span className="uppercase tracking-wide">Progress</span>
              <span className="text-white">{progress}%</span>
            </div>
            <ProgressBar value={progress} pulse={isRunning} />
          </div>

          {/* Terminal */}
          <div>
            <p className="font-mono text-xs text-[#777] uppercase tracking-wide mb-2">Execution Log</p>
            <div
              ref={logRef}
              className="bg-[#050505] border border-white/[0.07] p-4 h-40 overflow-y-auto"
            >
              {isRunning && <div className="h-px shimmer mb-2" />}
              {stepLog.length === 0 ? (
                <span className="font-mono text-sm text-[#888]">Awaiting execution...</span>
              ) : (
                <div className="space-y-1.5">
                  {stepLog.map((line, i) => (
                    <div key={i} className="flex gap-2 font-mono text-xs leading-relaxed">
                      <span className="text-[#999] shrink-0">&gt;</span>
                      <span className={i === stepLog.length - 1 ? "text-[#aaa]" : "text-[#aaa]"}>{line}</span>
                    </div>
                  ))}
                </div>
              )}
              {isRunning && (
                <div className="flex gap-2 font-mono text-xs mt-2">
                  <span className="text-[#999]">&gt;</span>
                  <span className="text-[#999] blink">_</span>
                </div>
              )}
            </div>
          </div>

          {/* Runtime stats */}
          {step === "cairo_executing" && (
            <div className="flex gap-6 font-mono text-xs text-[#777]">
              <span>CPU: 88.2%</span>
              <span>ENTROPY: 0.99923</span>
              <span>LATENCY: 14ms</span>
            </div>
          )}

          {/* Hashes — Issue 8: copy buttons */}
          {txHash && (
            <div className="space-y-2">
              <div className="bg-[#0a0a0a] border border-white/[0.07] px-4 py-3">
                <div className="flex items-center justify-between mb-1.5">
                  <p className="font-mono text-xs text-[#777] uppercase tracking-wide">TX Hash</p>
                  <CopyBtn text={txHash} />
                </div>
                <p className="font-mono text-xs text-[#aaa] break-all">{txHash}</p>
              </div>
              {proofHash && (
                <div className="bg-[#0a0a0a] border border-white/[0.07] px-4 py-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="font-mono text-xs text-[#777] uppercase tracking-wide">ZK Proof Hash</p>
                    <CopyBtn text={proofHash} />
                  </div>
                  <p className="font-mono text-xs text-[#aaa] break-all">{proofHash}</p>
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="border border-white/[0.1] px-4 py-3">
              <p className="font-mono text-sm text-[#aaa]">Error: {error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            {isConfirmed && (
              <button
                onClick={handleClose}
                className="flex-1 bg-white text-black font-mono text-sm tracking-widest uppercase py-3 hover:bg-[#e8e8e8] transition-colors"
              >
                View Loan →
              </button>
            )}
            {isFailed && (
              <button
                onClick={handleClose}
                className="flex-1 border border-white/[0.14] text-[#aaa] font-mono text-sm tracking-widest uppercase py-3 hover:text-white hover:border-white/30 transition-colors"
              >
                Close
              </button>
            )}
            {isRunning && (
              <p className="flex-1 font-mono text-sm text-[#999] text-center py-3 tracking-wide uppercase">
                Do not close this window
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
