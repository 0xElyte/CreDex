"use client";
import { useState, useEffect, useRef } from "react";
import { usePoolStats, useActivityFeed, useCreditScore } from "@/hooks/useQueries";
import { useDeposit } from "@/hooks/useDeposit";
import { useWalletGuard } from "@/hooks/useWalletGuard";
import { useAppSelector } from "@/store/hooks";
import { DepositModal } from "@/components/lend/DepositModal";
import { StatCard, SectionLabel, ProgressBar, StatusPill } from "@/components/ui";
import { gsap } from "gsap";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import { ChartWrapper } from "@/components/ui/ChartWrapper";

const APY_DATA = [
  { month:"Jan", apy:11.2 },{ month:"Feb", apy:12.1 },
  { month:"Mar", apy:11.8 },{ month:"Apr", apy:13.4 },
  { month:"May", apy:14.0 },{ month:"Jun", apy:13.7 },
  { month:"Jul", apy:14.2 },{ month:"Aug", apy:14.5 },
  { month:"Sep", apy:14.7 },{ month:"Oct", apy:14.82 },
];

// ─── Pool Stats ────────────────────────────────────────────────────────────────
function PoolStatsBar() {
  const { data, isLoading } = usePoolStats();
  const fmt = (n: number) =>
    n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : `$${(n / 1e6).toFixed(1)}M`;

  return (
    <div className="grid grid-cols-4 gap-px bg-white/[0.05]">
      <StatCard
        label="Total Value Locked"
        value={isLoading ? "—" : fmt(data!.tvl)}
        trend="↑ +12.4% 24h"
      />
      <StatCard
        label="Estimated APY"
        value={isLoading ? "—" : `${data!.apy.toFixed(2)}%`}
        sub="Variable · Platinum Tier"
      />
      <div className="card p-6">
        <p className="font-mono text-xs text-[#999] tracking-widest uppercase mb-2">Active Loans</p>
        <p className="font-mono text-2xl font-medium text-white leading-none">
          {isLoading ? "—" : data!.activeLoans.toLocaleString()}
        </p>
        <ProgressBar value={isLoading ? 0 : data!.utilizationRate * 100} className="mt-3" />
        <p className="font-mono text-xs text-[#888] mt-1">
          {isLoading ? "" : `${Math.round(data!.utilizationRate * 100)}% Capacity`}
        </p>
      </div>
      <StatCard
        label="Protocol Default Rate"
        value={isLoading ? "—" : `${data!.defaultRate}%`}
        sub="Ultra Low Risk"
      />
    </div>
  );
}

// ─── Deposit Form ──────────────────────────────────────────────────────────────
function DepositForm({ onDeposit, isPending }: { onDeposit: (amount: number) => void; isPending: boolean }) {
  const wallet = useAppSelector((s) => s.wallet);
  const { data: pool } = usePoolStats();
  const [amount, setAmount] = useState(10000);

  const apy = pool?.apy ?? 14.82;
  const tvl = pool?.tvl ?? 142509211;
  const monthlyYield = (amount * apy / 100) / 12;
  const yearlyYield = amount * apy / 100;
  const sharePercent = (amount / tvl) * 100;

  return (
    <div className="card p-6 space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="font-display text-xl text-white tracking-wide">Liquidity Injection</p>
          <p className="text-sm text-[#888] font-light mt-1 font-body">
            Deposit USDC to earn cryptographic yield secured by ZK-verified borrowers.
          </p>
        </div>
        <span className="font-mono text-xs text-[#888] border border-white/[0.08] px-2 py-1 shrink-0">
          Wallet: {wallet.balance.toLocaleString()} USDC
        </span>
      </div>

      {/* Input */}
      <div className="bg-[#111] border-l-2 border-white/20 px-4 py-3 flex items-center gap-3 focus-within:border-l-white transition-colors">
        <input
          type="number"
          value={amount}
          min={0}
          max={wallet.balance}
          onChange={(e) => setAmount(Math.max(0, Number(e.target.value)))}
          className="flex-1 bg-transparent font-mono text-2xl text-white focus:outline-none"
        />
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-3 h-3 rounded-full bg-blue-500" />
          <span className="font-mono text-sm text-[#aaa]">USDC</span>
          <button
            onClick={() => setAmount(wallet.balance)}
            className="font-mono text-xs text-[#888] border border-white/[0.1] px-2 py-1 hover:text-white hover:border-white/25 transition-colors ml-1"
          >
            Max
          </button>
        </div>
      </div>

      {/* Validation warning */}
      {amount > wallet.balance && (
        <p className="font-mono text-xs text-[#888] tracking-wide">⚠ Amount exceeds wallet balance</p>
      )}

      {/* Projections */}
      <div className="grid grid-cols-3 gap-px bg-[#1a1a1a]">
        {[
          { label: "30D Projection", value: `+$${monthlyYield.toFixed(2)}` },
          { label: "Yearly Yield", value: `+$${yearlyYield.toLocaleString("en", { maximumFractionDigits: 0 })}` },
          { label: "Pool Share", value: `${sharePercent.toFixed(4)}%` },
        ].map((item) => (
          <div key={item.label} className="bg-[#0c0c0c] p-3 text-center">
            <p className="font-mono text-sm text-white">{item.value}</p>
            <p className="font-mono text-sm text-[#888] tracking-wide uppercase mt-1">{item.label}</p>
          </div>
        ))}
      </div>

      {/* APY chart */}
      <div>
        <SectionLabel>APY History</SectionLabel>
        <ChartWrapper height={120}>
        <ResponsiveContainer width="100%" height={120}>
          <AreaChart data={APY_DATA}>
            <defs>
              <linearGradient id="apyGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#fff" stopOpacity={0.06} />
                <stop offset="95%" stopColor="#fff" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="month" tick={{ fill: "#888", fontSize: 12, fontFamily: "DM Mono" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: "#888", fontSize: 12, fontFamily: "DM Mono" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
            <Tooltip
              contentStyle={{ background: "#111", border: "1px solid rgba(255,255,255,.07)", borderRadius: 0, fontFamily: "DM Mono", fontSize: 12 }}
              labelStyle={{ color: "#555" }} itemStyle={{ color: "#fff" }} />
            <Area type="monotone" dataKey="apy" stroke="rgba(255,255,255,0.5)" strokeWidth={1.5} fill="url(#apyGrad)" />
          </AreaChart>
        </ResponsiveContainer>
        </ChartWrapper>
      </div>

      <button
        disabled={amount <= 0 || amount > wallet.balance || isPending}
        onClick={() => onDeposit(amount)}
        className="w-full bg-white text-black font-mono text-sm tracking-wide uppercase py-4 hover:bg-[#e8e8e8] active:scale-[.98] transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {isPending ? (
          <><span className="w-3 h-3 border border-black border-t-transparent rounded-full animate-spin" /> Processing...</>
        ) : "⚡ Deposit USDC"}
      </button>
      <p className="font-mono text-sm text-[#777] text-center tracking-wide">
        By depositing, you agree to Lendr Sovereign Liquidity Terms.
      </p>
    </div>
  );
}

// ─── Utilization Donut ─────────────────────────────────────────────────────────
function UtilizationDonut() {
  const { data } = usePoolStats();
  const utilized = data ? Math.round(data.utilizationRate * 100) : 75;
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  return (
    <div className="card p-6">
      <p className="font-display text-lg text-white tracking-wide mb-5">Utilization Vector</p>
      <div className="relative w-36 h-36 mx-auto">
        {mounted && (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={[{ value: utilized }, { value: 100 - utilized }]}
                cx="50%" cy="50%"
                innerRadius={46} outerRadius={60}
                startAngle={90} endAngle={-270}
                dataKey="value" strokeWidth={0}
                animationBegin={0} animationDuration={1200}
              >
                <Cell fill="rgba(255,255,255,0.82)" />
                <Cell fill="rgba(255,255,255,0.05)" />
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        )}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-xl text-white font-medium">{utilized}%</span>
          <span className="font-mono text-sm text-[#888] uppercase tracking-widest">Utilized</span>
        </div>
      </div>
      <div className="mt-5 space-y-2">
        {[
          { label: "Active Loans", col: "bg-white", value: `$${data ? (data.activeLoanValue / 1e6).toFixed(1) : "106.8"}M` },
          { label: "Available Cash", col: "bg-[#1e1e1e]", value: `$${data ? (data.availableCash / 1e6).toFixed(1) : "35.7"}M` },
        ].map((r) => (
          <div key={r.label} className="flex items-center justify-between font-mono text-xs">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${r.col}`} />
              <span className="text-[#888]">{r.label}</span>
            </div>
            <span className="text-white">{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Activity Feed ─────────────────────────────────────────────────────────────
function ActivityFeed() {
  const { data: items = [], dataUpdatedAt } = useActivityFeed();
  const [lastUpdate, setLastUpdate] = useState("just now");

  useEffect(() => {
    setLastUpdate("just now");
    const t = setTimeout(() => setLastUpdate("a moment ago"), 5000);
    return () => clearTimeout(t);
  }, [dataUpdatedAt]);

  const TYPE_ICON: Record<string, string> = {
    loan_funded: "+", interest_distribution: "⟳",
    borrower_verified: "✓", repayment: "↓",
    deposit: "↑", withdrawal: "↗",
  };

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-4">
        <p className="font-display text-lg text-white tracking-wide">Recent Activity</p>
        <div className="flex items-center gap-2 font-mono text-xs text-[#888]">
          <span className="w-1 h-1 bg-white rounded-full pulse-dot" />
          Updated {lastUpdate}
        </div>
      </div>
      <div className="divide-y divide-white/[0.04]">
        {items.slice(0, 7).map((item) => (
          <div key={item.id} className="flex items-center justify-between py-3 hover:bg-white/[0.01] transition-colors">
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 bg-[#111] flex items-center justify-center font-mono text-sm text-[#888] shrink-0">
                {TYPE_ICON[item.type] || "·"}
              </div>
              <div>
                <p className="text-sm text-[#ccc] font-body">
                  {item.label}{" "}
                  <span className="text-[#777] text-sm">{item.address}</span>
                </p>
                <p className="font-mono text-xs text-[#aaa]">
                  {new Date(item.timestamp).toLocaleTimeString()}
                </p>
              </div>
            </div>
            <div className="text-right shrink-0 ml-3">
              {item.tier && (
                <span className="font-mono text-sm text-[#777] border border-white/[0.06] px-1.5 py-0.5 block mb-1">
                  {item.tier}
                </span>
              )}
              {item.amount && (
                <span className="font-mono text-sm text-white">
                  {item.amount.toLocaleString()} {item.asset}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Security Panel ────────────────────────────────────────────────────────────
function SecurityPanel() {
  return (
    <div className="card p-6">
      <p className="font-display text-lg text-white tracking-wide mb-4">Vault Security</p>
      <div className="divide-y divide-white/[0.04]">
        {[
          { t: "Audit Status", d: "Certified by Trail of Bits (May 2024)" },
          { t: "Collateralization", d: "Over-collateralized 140% avg." },
          { t: "Liquidation Engine", d: "Atomic flash-loan resolution." },
          { t: "Multi-Sig Hardware", d: "5-of-7 hardware wallet governance." },
        ].map((item) => (
          <div key={item.t} className="flex gap-3 py-3">
            <div className="w-5 h-5 border border-white/[0.1] flex items-center justify-center font-mono text-xs text-[#888] shrink-0 mt-0.5">✓</div>
            <div>
              <p className="font-mono text-xs text-white tracking-wide uppercase">{item.t}</p>
              <p className="text-sm text-[#888] font-light mt-0.5 font-body">{item.d}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── My Deposits ───────────────────────────────────────────────────────────────
function MyDeposits() {
  const { deposits } = useDeposit();
  if (deposits.length === 0) return null;

  return (
    <div className="card p-6">
      <SectionLabel>My Deposit Positions</SectionLabel>
      <div className="divide-y divide-white/[0.04]">
        {deposits.map((d) => (
          <div key={d.id} className="py-3 grid grid-cols-5 gap-4 items-center font-mono text-sm">
            <span className="text-white">{d.id}</span>
            <span className="text-[#888]">{d.amount.toLocaleString()} USDC</span>
            <span className="text-[#999]">{(d.sharePercent * 100).toFixed(4)}% share</span>
            <span className="text-white">+${d.earnedYield.toFixed(2)} yield</span>
            <span className="text-[#777]">{new Date(d.depositedAt).toLocaleDateString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Lend Page ────────────────────────────────────────────────────────────
export default function LendPage() {
  useWalletGuard();

  const { deposit, isPending, success, reset } = useDeposit();
  const [pendingAmount, setPendingAmount] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // GSAP entrance
  useEffect(() => {
    if (!containerRef.current) return;
    const ctx = gsap.context(() => {
      gsap.from(".lend-animate", {
        y: 14, duration: 0.5, stagger: 0.06, ease: "power3.out", clearProps: "transform",
      });
    }, containerRef);
    return () => ctx.revert();
  }, []);

  const handleDeposit = async (amount: number) => {
    setPendingAmount(amount);
    await deposit(amount);
  };

  return (
    <div ref={containerRef} className="space-y-5">
      {/* Header */}
      <div className="lend-animate flex items-start justify-between">
        <div>
          <h1 className="font-display text-4xl text-white tracking-wide">Lending Portal</h1>
          <p className="font-mono text-xs text-[#777] tracking-widest uppercase mt-1">
            Institutional Liquidity · Sovereign Pools · Cryptographic Yield
          </p>
        </div>
        <div className="flex gap-2">
          <StatusPill label="Protocol Optimal" />
          <StatusPill label="Multi-Sig Active" />
        </div>
      </div>

      {/* Pool stats */}
      <div className="lend-animate"><PoolStatsBar /></div>

      {/* Main layout */}
      <div className="lend-animate grid grid-cols-3 gap-px bg-white/[0.05]">
        <div className="col-span-2 space-y-px bg-white/[0.05]">
          <div className="bg-[#0c0c0c]"><DepositForm onDeposit={handleDeposit} isPending={isPending} /></div>
          <div className="bg-[#0c0c0c]"><ActivityFeed /></div>
        </div>
        <div className="space-y-px bg-white/[0.05]">
          <div className="bg-[#0c0c0c]"><UtilizationDonut /></div>
          <div className="bg-[#0c0c0c]"><SecurityPanel /></div>
        </div>
      </div>

      {/* My deposit positions */}
      <div className="lend-animate"><MyDeposits /></div>

      {/* Deposit modal - shown during and immediately after transaction */}
      {pendingAmount && (isPending || success) && (
        <DepositModal amount={pendingAmount} onClose={() => { reset(); setPendingAmount(null); }} />
      )}
    </div>
  );
}
