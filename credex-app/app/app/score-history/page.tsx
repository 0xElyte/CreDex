"use client";
import { useState } from "react";
import { useScoreHistory, useRevealScore } from "@/hooks/usePortfolio";
import { useAppSelector } from "@/store/hooks";
import { useCreditScore } from "@/hooks/useQueries";
import { useWalletGuard } from "@/hooks/useWalletGuard";
import { SignalRow, SectionLabel, ProgressBar, StatusPill } from "@/components/ui";
import { ChartWrapper } from "@/components/ui/ChartWrapper";
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import { clsx } from "clsx";

const TOOLTIP_STYLE = {
  contentStyle: { background:"#111", border:"1px solid rgba(255,255,255,.1)", borderRadius:0, fontFamily:"DM Mono", fontSize:12 },
  labelStyle:   { color:"#999" },
  itemStyle:    { color:"#fff" },
};

const TIERS = [
  { name:"Bronze",   min:0,   max:699, col:"#b87333" },
  { name:"Silver",   min:700, max:749, col:"#aaa" },
  { name:"Gold",     min:750, max:819, col:"#e0c97f" },
  { name:"Platinum", min:820, max:900, col:"#fff" },
];

function CopyBtn({ text, label = "copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={copy}
      className="font-mono text-xs text-[#888] border border-white/[0.1] px-2 py-0.5 hover:text-white hover:border-white/25 transition-colors"
    >
      {copied ? "✓" : label}
    </button>
  );
}


export default function ScoreHistoryPage() {
  useWalletGuard();
  const { data: score } = useCreditScore();
  const { historyQuery, eventsQuery } = useScoreHistory();
  const { reveal, isRevealing, revealedScore } = useRevealScore();
  const [copied, setCopied] = useState(false);
  const loans = useAppSelector((s) => s.finance.loans);

  // Build real credit events from actual loan history in Redux
  // Falls back to mock events only when no real loans exist yet
  const realEvents = loans.length > 0
    ? loans.map((loan, i) => ({
        id:           loan.id,
        date:         loan.openedAt,
        type:         loan.status === "repaid"    ? "repayment" as const
                    : loan.status === "liquidated" ? "default"   as const
                    : "loan" as const,
        title:        loan.status === "repaid"
                        ? `Loan Repaid — ${loan.id}`
                        : `Loan Opened — ${loan.id}`,
        description:  `${loan.borrowedAmount.toLocaleString()} USDC · ${(loan.aprRate * 100).toFixed(1)}% APR · Due ${new Date(loan.dueDate).toLocaleDateString()}`,
        creditImpact: loan.status === "repaid"    ?  +12.0
                    : loan.status === "liquidated" ?  -50.0
                    : +5.0,
        tier:         score?.tier ?? "Bronze",
        txHash:       loan.txHash || ("0x" + loan.id.replace(/[^a-f0-9]/gi, "").padEnd(64, "0")),
      }))
    : (eventsQuery.data ?? []);

  const displayScore = revealedScore ?? score?.numericScore;

  const copyHash = async () => {
    if (score?.hash) {
      await navigator.clipboard.writeText(score.hash);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="space-y-6">
      {/* ── Header ────────────────────────────────────────────── */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-5xl text-white tracking-wide leading-none">Score History</h1>
          <p className="font-mono text-sm text-[#999] mt-2">FHE-Encrypted · ZK-Verified · Soulbound #8842</p>
        </div>
        <StatusPill label="Decryption Ready" />
      </div>

      {/* ── Top row: score card + signals ─────────────────────── */}
      <div className="grid grid-cols-2 gap-4">

        {/* Score reveal card */}
        <div className="card p-6 relative overflow-hidden">
          {/* Decorative ring */}
          <div className="absolute -right-12 -top-12 w-48 h-48 border border-white/[0.04] rounded-full ring-spin" style={{ animationDuration:"18s" }} />
          <div className="absolute -right-4 -top-4 w-28 h-28 border border-white/[0.05] rounded-full ring-spin" style={{ animationDuration:"12s", animationDirection:"reverse" }} />

          <div className="relative z-10">
            <p className="font-mono text-xs text-[#999] uppercase tracking-widest mb-5">Protocol Credit Score</p>

            <div className="flex items-center gap-5 mb-6">
              <span className="text-5xl">{displayScore ? "🔓" : "🔒"}</span>
              <div>
                {displayScore ? (
                  <div className="slide-up">
                    <p className="font-display text-7xl text-white leading-none">{displayScore}</p>
                    <p className="font-mono text-sm text-[#999] mt-1">
                      {score?.tier?.toUpperCase()} TIER · TOP 4.2% GLOBALLY
                    </p>
                  </div>
                ) : (
                  <div>
                    <p className="font-display text-4xl text-white">ENCRYPTED</p>
                    <div className="flex items-center gap-2 mt-2">
                      <p className="font-mono text-sm text-[#777]">SHA-256: {score?.hash}</p>
                      <button
                        onClick={copyHash}
                        className="font-mono text-xs text-[#777] border border-white/[0.1] px-2 py-0.5 hover:text-white hover:border-white/30 transition-colors"
                      >
                        {copied ? "✓" : "copy"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {!displayScore && (
              <button
                onClick={reveal}
                disabled={isRevealing}
                className={clsx(
                  "flex items-center gap-3 font-mono text-sm tracking-widest uppercase px-6 py-3 transition-all",
                  isRevealing ? "bg-white/10 text-[#777] cursor-wait" : "bg-white text-black hover:bg-[#e8e8e8]"
                )}
              >
                {isRevealing ? (
                  <><span className="w-4 h-4 border-2 border-[#777] border-t-white rounded-full animate-spin" />Decrypting...</>
                ) : "👁 Reveal My Score"}
              </button>
            )}

            {displayScore && score && (
              <div className="grid grid-cols-3 gap-3 mt-4">
                {[
                  { label:"Max LTV", value:`${score.maxLTV*100}%` },
                  { label:"Your APR", value:`${(score.aprRate*100).toFixed(1)}%` },
                  { label:"Streak",  value:`${score.repaymentStreak}d` },
                ].map(s => (
                  <div key={s.label} className="bg-[#0a0a0a] border border-white/[0.07] p-3 text-center">
                    <p className="font-mono text-base text-white">{s.value}</p>
                    <p className="font-mono text-xs text-[#777] uppercase tracking-wide mt-1">{s.label}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Signals breakdown */}
        <div className="card p-6">
          <SectionLabel>Signal Breakdown</SectionLabel>
          {score ? (
            <div className="space-y-1">
              {score.signals.map(s => (
                <SignalRow key={s.label} label={s.label} value={s.value} dimBar={s.value < 20} />
              ))}
            </div>
          ) : (
            <p className="font-mono text-sm text-[#777]">Loading signals...</p>
          )}

          {/* NFT mini-card */}
          <div className="mt-5 pt-5 border-t border-white/[0.07] flex items-center gap-4">
            <div className="w-12 h-12 bg-[#0a0a0a] border border-white/[0.1] flex items-center justify-center text-2xl" style={{ filter:"grayscale(1)" }}>🏆</div>
            <div>
              <p className="font-mono text-sm text-white">Soulbound ID #8842</p>
              <p className="font-mono text-xs text-[#777]">Non-Transferable · Gold v.2</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Score chart (full width) ──────────────────────────── */}
      <div className="card p-6">
        <SectionLabel>Score History (12 Months)</SectionLabel>
        {historyQuery.isLoading ? (
          <div className="h-52 flex items-center justify-center">
            <div className="flex items-center gap-2 font-mono text-sm text-[#999]">
              <span className="w-4 h-4 border border-[#555] border-t-white rounded-full animate-spin" />
              Loading score data...
            </div>
          </div>
        ) : (
          <ChartWrapper height={210}>
            <ResponsiveContainer width="100%" height={210}>
              <LineChart data={historyQuery.data ?? []} margin={{ left:-10, right:16 }}>
                <XAxis dataKey="date" tick={{ fill:"#888", fontSize:13, fontFamily:"DM Mono" }} axisLine={false} tickLine={false} tickFormatter={v=>v.slice(2)} />
                <YAxis domain={[580,920]} tick={{ fill:"#888", fontSize:13, fontFamily:"DM Mono" }} axisLine={false} tickLine={false} />
                <Tooltip {...TOOLTIP_STYLE} formatter={(v:unknown)=>[Number(v),"Score"]} />
                {[{ y:700, label:"Silver" },{ y:750, label:"Gold" },{ y:820, label:"Platinum" }].map(t => (
                  <ReferenceLine key={t.label} y={t.y} stroke="rgba(255,255,255,.08)" strokeDasharray="4 4"
                    label={{ value:t.label, position:"right", fill:"#666", fontSize:13, fontFamily:"DM Mono" }} />
                ))}
                <Line type="monotone" dataKey="score" stroke="rgba(255,255,255,0.85)" strokeWidth={2}
                  dot={{ r:3.5, fill:"#fff", stroke:"#000", strokeWidth:2 }} activeDot={{ r:6 }} />
              </LineChart>
            </ResponsiveContainer>
          </ChartWrapper>
        )}
      </div>

      {/* ── Bottom row: tiers + timeline ─────────────────────── */}
      <div className="grid grid-cols-3 gap-4">

        {/* Tier thresholds */}
        <div className="card p-6">
          <SectionLabel>Tier Thresholds</SectionLabel>
          <div className="space-y-4">
            {TIERS.map(t => (
              <div key={t.name}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-mono text-sm font-medium" style={{ color:t.col }}>{t.name}</span>
                  <span className="font-mono text-xs text-[#777]">{t.min}–{t.max} pts</span>
                </div>
                <div className="h-1.5 bg-[#1e1e1e] rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ background:t.col, width:"100%" }} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5 bg-[#0a0a0a] border border-white/[0.08] px-4 py-3 border-l-2 border-l-white/20">
            <p className="font-mono text-sm text-white">Current: Gold Tier</p>
            <p className="font-mono text-sm text-[#999] mt-1">~847 pts · 28 pts from Platinum</p>
          </div>
        </div>

        {/* Credit event timeline */}
        <div className="col-span-2 card p-6">
          <div className="flex items-center justify-between mb-5">
            <SectionLabel>Credit History</SectionLabel>
            <div className="flex gap-4">
              <div className="flex items-center gap-2 font-mono text-xs text-[#999]"><div className="w-2 h-2 rounded-full bg-white" />Positive</div>
              <div className="flex items-center gap-2 font-mono text-xs text-[#999]"><div className="w-2 h-2 rounded-full bg-[#777]" />Negative</div>
            </div>
          </div>
          {eventsQuery.isLoading ? (
            <p className="font-mono text-sm text-[#777]">Loading...</p>
          ) : (
            <div className="relative ml-3">
              <div className="absolute left-0 top-0 w-px h-full bg-white/[0.08]" />
              <div className="space-y-5">
                {realEvents.map(ev => (
                  <div key={ev.id} className="relative pl-7">
                    <div className={clsx(
                      "absolute left-[-5px] top-1.5 w-2.5 h-2.5 rounded-full",
                      ev.creditImpact > 0 ? "bg-white shadow-[0_0_8px_rgba(255,255,255,.3)]" : "bg-[#888]"
                    )} />
                    <div className="grid grid-cols-12 gap-3 items-start">
                      <div className="col-span-2">
                        <p className="font-mono text-xs text-[#777]">
                          {new Date(ev.date).toLocaleDateString("en",{month:"short",day:"numeric",year:"numeric"})}
                        </p>
                      </div>
                      <div className="col-span-7">
                        <p className="font-mono text-sm text-white uppercase tracking-wide mb-1">{ev.title}</p>
                        <p className="text-sm text-[#999] leading-relaxed">{ev.description}</p>
                      </div>
                      <div className="col-span-3 text-right space-y-1.5">
                        <span className={clsx("font-mono text-sm font-medium block", ev.creditImpact > 0 ? "text-white" : "text-[#777]")}>
                          {ev.creditImpact > 0 ? "+" : ""}{ev.creditImpact.toFixed(1)} PTS
                        </span>
                        <p className="font-mono text-xs text-[#999] uppercase tracking-wide">Credit Impact</p>
                        <div className="flex justify-end">
                          <CopyBtn text={ev.txHash} label="copy tx" />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
