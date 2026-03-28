"use client";
import { useState } from "react";
import { useRevealScore } from "@/hooks/usePortfolio";
import { useAppSelector } from "@/store/hooks";
import { useCreditScore } from "@/hooks/useQueries";
import { useWalletGuard } from "@/hooks/useWalletGuard";
import { useScoreChart } from "@/hooks/useScoreChart";
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

const TIER_THRESHOLDS = [
  { name:"Bronze",   min:400, max:549, col:"#b87333" },
  { name:"Silver",   min:550, max:699, col:"#aaa" },
  { name:"Gold",     min:700, max:819, col:"#e0c97f" },
  { name:"Platinum", min:820, max:900, col:"#fff" },
];

const NEXT_TIER: Record<string, { name: string; threshold: number }> = {
  Bronze:   { name: "Silver",   threshold: 550 },
  Silver:   { name: "Gold",     threshold: 700 },
  Gold:     { name: "Platinum", threshold: 820 },
  Platinum: { name: "Platinum", threshold: 820 },
  Denied:   { name: "Bronze",   threshold: 400 },
};

const TIER_MIDPOINT: Record<string, number> = {
  Platinum: 860, Gold: 760, Silver: 620, Bronze: 450, Denied: 200,
};

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

  const { data: score }                  = useCreditScore();
  const { reveal, isRevealing, revealedScore } = useRevealScore();
  const { data: chartData, isReal }      = useScoreChart();
  const loans                            = useAppSelector((s) => s.finance.loans);
  const walletAddress                    = useAppSelector((s) => s.wallet.address);
  const [copied, setCopied]              = useState(false);

  const displayScore    = revealedScore ?? score?.numericScore;
  const approxScore     = TIER_MIDPOINT[score?.tier ?? "Bronze"] ?? 450;
  const currentTier     = score?.tier ?? "Bronze";
  const nextTier        = NEXT_TIER[currentTier];
  const ptsToNext       = nextTier ? Math.max(0, nextTier.threshold - approxScore) : 0;

  // Build real credit events from actual loan history
  const realEvents = loans.length > 0
    ? loans.map((loan) => ({
        id:           loan.id,
        date:         loan.openedAt,
        type:         loan.status === "repaid"    ? "repayment" as const
                    : loan.status === "liquidated" ? "default"   as const
                    : "loan" as const,
        title:        loan.status === "repaid"    ? `Loan Repaid — ${loan.id}`
                    : loan.status === "liquidated" ? `Loan Defaulted — ${loan.id}`
                    : `Loan Opened — ${loan.id}`,
        description:  `${loan.borrowedAmount.toLocaleString()} USDC · ${(loan.aprRate * 100).toFixed(1)}% APR · Due ${new Date(loan.dueDate).toLocaleDateString()}`,
        creditImpact: loan.status === "repaid"    ?  +12.0
                    : loan.status === "liquidated" ?  -50.0
                    : +5.0,
        tier:         currentTier,
        txHash:       loan.txHash || ("0x" + loan.id.replace(/[^a-f0-9]/gi, "").padEnd(64, "0")),
      }))
    : [];

  // Chart Y-axis domain based on real data
  const scores      = chartData.map((p) => p.score);
  const minScore    = Math.max(0,    Math.min(...scores) - 50);
  const maxScore    = Math.min(1000, Math.max(...scores) + 80);

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
          <p className="font-mono text-sm text-[#999] mt-2">
            FHE-Encrypted · ZK-Verified · {walletAddress ? `${walletAddress.slice(0,10)}...` : "—"}
          </p>
        </div>
        <StatusPill label="Decryption Ready" />
      </div>

      {/* ── Top row: score card + signals ─────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Score reveal card */}
        <div className="card p-6 relative overflow-hidden">
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
                      {currentTier.toUpperCase()} TIER
                    </p>
                  </div>
                ) : (
                  <div>
                    <p className="font-display text-4xl text-white">ENCRYPTED</p>
                    <div className="flex items-center gap-2 mt-2">
                      <p className="font-mono text-sm text-[#777]">
                        Tier: <span className="text-white">{currentTier}</span>
                      </p>
                      {score?.hash && (
                        <button onClick={copyHash} className="font-mono text-xs text-[#777] border border-white/[0.1] px-2 py-0.5 hover:text-white hover:border-white/30 transition-colors">
                          {copied ? "✓" : "copy hash"}
                        </button>
                      )}
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
                {isRevealing
                  ? <><span className="w-4 h-4 border-2 border-[#777] border-t-white rounded-full animate-spin" />Decrypting...</>
                  : "👁 Reveal My Score"}
              </button>
            )}

            {score && (
              <div className="grid grid-cols-3 gap-2 mt-4">
                {[
                  { label: "Max LTV",  value: `${(score.maxLTV * 100).toFixed(0)}%` },
                  { label: "Your APR", value: `${(score.aprRate * 100).toFixed(1)}%` },
                  { label: "Tier",     value: currentTier },
                ].map((s) => (
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
              {score.signals.map((s) => (
                <SignalRow key={s.label} label={s.label} value={s.value} dimBar={s.value < 20} />
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2 font-mono text-sm text-[#777] py-4">
              <span className="w-4 h-4 border border-[#555] border-t-white rounded-full animate-spin" />
              Loading signals from chain...
            </div>
          )}

          <div className="mt-5 pt-5 border-t border-white/[0.07] flex items-center gap-4">
            <div className="w-12 h-12 bg-[#0a0a0a] border border-white/[0.1] flex items-center justify-center text-2xl" style={{ filter:"grayscale(1)" }}>🏆</div>
            <div>
              <p className="font-mono text-sm text-white">Soulbound Credit NFT</p>
              <p className="font-mono text-xs text-[#777]">Non-Transferable · {currentTier}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Score chart ────────────────────────────────────────── */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-1">
          <SectionLabel>Score Trajectory</SectionLabel>
          {!isReal && (
            <span className="font-mono text-xs text-[#777] border border-white/[0.08] px-2 py-0.5">
              Based on current tier · Take a loan to build history
            </span>
          )}
        </div>
        <ChartWrapper height={210}>
          <ResponsiveContainer width="100%" height={210}>
            <LineChart data={chartData} margin={{ left:-10, right:16 }}>
              <XAxis
                dataKey="date"
                tick={{ fill:"#888", fontSize:12, fontFamily:"DM Mono" }}
                axisLine={false} tickLine={false}
                tickFormatter={(v) => v.slice(2)}
              />
              <YAxis
                domain={[minScore, maxScore]}
                tick={{ fill:"#888", fontSize:12, fontFamily:"DM Mono" }}
                axisLine={false} tickLine={false}
              />
              <Tooltip {...TOOLTIP_STYLE} formatter={(v: unknown) => [Number(v), "Score"]} />
              {[
                { y:400, label:"Bronze" },
                { y:550, label:"Silver" },
                { y:700, label:"Gold" },
                { y:820, label:"Platinum" },
              ].filter((t) => t.y >= minScore && t.y <= maxScore).map((t) => (
                <ReferenceLine key={t.label} y={t.y}
                  stroke="rgba(255,255,255,.08)" strokeDasharray="4 4"
                  label={{ value:t.label, position:"right", fill:"#666", fontSize:11, fontFamily:"DM Mono" }}
                />
              ))}
              <Line
                type="monotone" dataKey="score"
                stroke="rgba(255,255,255,0.85)" strokeWidth={2}
                dot={{ r:4, fill:"#fff", stroke:"#000", strokeWidth:2 }}
                activeDot={{ r:6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartWrapper>
      </div>

      {/* ── Bottom row: tiers + timeline ─────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Tier thresholds — real data */}
        <div className="card p-6">
          <SectionLabel>Tier Thresholds</SectionLabel>
          <div className="space-y-4">
            {TIER_THRESHOLDS.map((t) => (
              <div key={t.name}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className={clsx(
                    "font-mono text-sm font-medium",
                    t.name === currentTier && "text-white"
                  )} style={{ color: t.name === currentTier ? "#fff" : t.col }}>
                    {t.name} {t.name === currentTier && "← You"}
                  </span>
                  <span className="font-mono text-xs text-[#777]">{t.min}–{t.max} pts</span>
                </div>
                <div className="h-1.5 bg-[#1e1e1e] rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ background: t.col, width:"100%" }} />
                </div>
              </div>
            ))}
          </div>

          {/* Real tier status */}
          <div className="mt-5 bg-[#0a0a0a] border border-white/[0.08] px-4 py-3 border-l-2 border-l-white/20">
            <p className="font-mono text-sm text-white">Current: {currentTier} Tier</p>
            {ptsToNext > 0 && nextTier.name !== currentTier && (
              <p className="font-mono text-sm text-[#999] mt-1">
                ~{ptsToNext} pts from {nextTier.name}
              </p>
            )}
            {currentTier === "Platinum" && (
              <p className="font-mono text-sm text-[#999] mt-1">Maximum tier reached</p>
            )}
          </div>
        </div>

        {/* Credit event timeline — real loans */}
        <div className="col-span-1 lg:col-span-2 card p-6">
          <div className="flex items-center justify-between mb-5">
            <SectionLabel>Credit History</SectionLabel>
            <div className="flex flex-wrap gap-3">
              <div className="flex items-center gap-2 font-mono text-xs text-[#999]">
                <div className="w-2 h-2 rounded-full bg-white" />Positive
              </div>
              <div className="flex items-center gap-2 font-mono text-xs text-[#999]">
                <div className="w-2 h-2 rounded-full bg-[#777]" />Negative
              </div>
            </div>
          </div>

          {realEvents.length === 0 ? (
            <div className="py-10 text-center">
              <p className="font-mono text-sm text-[#777] mb-2">No credit history yet</p>
              <p className="font-mono text-xs text-[#555]">
                Take your first loan to start building your on-chain credit history
              </p>
            </div>
          ) : (
            <div className="relative ml-3">
              <div className="absolute left-0 top-0 w-px h-full bg-white/[0.08]" />
              <div className="space-y-5">
                {realEvents.map((ev) => (
                  <div key={ev.id} className="relative pl-7">
                    <div className={clsx(
                      "absolute left-[-5px] top-1.5 w-2.5 h-2.5 rounded-full",
                      ev.creditImpact > 0
                        ? "bg-white shadow-[0_0_8px_rgba(255,255,255,.3)]"
                        : "bg-[#888]"
                    )} />
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 sm:gap-3 items-start">
                      <div className="col-span-1 sm:col-span-2">
                        <p className="font-mono text-xs text-[#777]">
                          {new Date(ev.date).toLocaleDateString("en", { month:"short", day:"numeric", year:"numeric" })}
                        </p>
                      </div>
                      <div className="col-span-1 sm:col-span-7">
                        <p className="font-mono text-sm text-white uppercase tracking-wide mb-1">{ev.title}</p>
                        <p className="text-sm text-[#999] leading-relaxed">{ev.description}</p>
                      </div>
                      <div className="col-span-1 sm:col-span-3 sm:text-right text-left space-y-1.5">
                        <span className={clsx(
                          "font-mono text-sm font-medium block",
                          ev.creditImpact > 0 ? "text-white" : "text-[#777]"
                        )}>
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
