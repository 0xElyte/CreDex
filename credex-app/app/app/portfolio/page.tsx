"use client";
import { useState, useCallback, useMemo } from "react";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useWalletGuard } from "@/hooks/useWalletGuard";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { updateLoanRepayment } from "@/store/financeSlice";
import { addToast, dismissLoading } from "@/store/toastSlice";
import { submitRepayment } from "@/lib/api";
import { useCreditScore } from "@/hooks/useQueries";
import { StatCard, SectionLabel, ProgressBar, Table, TableRow, Td } from "@/components/ui";
import { ChartWrapper } from "@/components/ui/ChartWrapper";
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";
import { useWallet } from "@/hooks/useWallet";

const TOOLTIP_STYLE = {
  contentStyle: { background:"#111", border:"1px solid rgba(255,255,255,.1)", borderRadius:0, fontFamily:"DM Mono", fontSize:12 },
  labelStyle:   { color:"#999" },
  itemStyle:    { color:"#fff" },
};

function useRepay() {
  const wallet = useAppSelector(s => s.wallet.address);
  const dispatch = useAppDispatch();
  const [repayingId, setRepayingId] = useState<string|null>(null);

  const repayLoan = useCallback(async (id: string, amount: number, solidityLoanId: number | undefined) => {
    if (!wallet) return;
    if (!solidityLoanId) {
      dispatch(addToast({ type:"error", title:"Repayment Failed", message:"On-chain loan ID not found. Try reconnecting your wallet." }));
      return;
    }
    setRepayingId(id);
    const loadingToast = dispatch(addToast({ type:"loading", title:"Processing Repayment", message:"Starting repayment...", duration:0 }));
    void loadingToast;
    try {
      await submitRepayment(wallet, id, solidityLoanId, (msg) => {
        dispatch(addToast({ type:"loading", title:"Processing Repayment", message:msg, duration:0 }));
      });
      await refreshBalance();
      dispatch(dismissLoading());
      dispatch(updateLoanRepayment({ id, repaidPercent:100 }));
      dispatch(addToast({ type:"success", title:"Repayment Confirmed", message:`${amount.toLocaleString()} USDC · ${id} closed` }));
    } catch (err) {
      dispatch(dismissLoading());
      const message = err instanceof Error ? err.message : "Repayment failed.";
      dispatch(addToast({ type:"error", title:"Repayment Failed", message }));
      console.error("[repay]", err);
    } finally {
      setRepayingId(null);
    }
  }, [dispatch, wallet]);

  return { repayLoan, repayingId };
}

export default function PortfolioPage() {
  useWalletGuard();
  const { data: stats, isLoading } = usePortfolio();
  const { data: score } = useCreditScore();
  const loans    = useAppSelector(s => s.finance.loans);
  const deposits = useAppSelector(s => s.finance.deposits);
  const { repayLoan, repayingId } = useRepay();
  const wallet = useWallet();
  const { refreshBalance } = useWallet();

  const active = loans.filter(l => l.status === "active");
  const closed = loans.filter(l => l.status !== "active");

  // Real chart data derived from Redux state
  const loanChartData = useMemo(() => {
    if (loans.length === 0) return [];
    const byMonth = new Map<string, { borrowed: number; repaid: number }>();
    for (const loan of loans) {
      const key = loan.openedAt.slice(0, 7);
      if (!byMonth.has(key)) byMonth.set(key, { borrowed: 0, repaid: 0 });
      const entry = byMonth.get(key)!;
      entry.borrowed += loan.borrowedAmount;
      if (loan.status === "repaid") entry.repaid += loan.borrowedAmount;
    }
    return Array.from(byMonth.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, d]) => ({
        month: new Date(month + "-01").toLocaleString("en", { month: "short" }),
        borrowed: d.borrowed, repaid: d.repaid,
      }));
  }, [loans]);

  const yieldChartData = useMemo(() =>
    deposits.slice()
      .sort((a, b) => new Date(a.depositedAt).getTime() - new Date(b.depositedAt).getTime())
      .map(d => ({
        month: new Date(d.depositedAt).toLocaleString("en", { month: "short", year: "2-digit" }),
        yield: parseFloat(d.earnedYield.toFixed(4)),
      })),
  [deposits]);

  const fmt = (n:number) => isLoading ? "—" : n.toLocaleString("en",{maximumFractionDigits:0});

  return (
    <div className="space-y-6">
      {/* ── Header ────────────────────────────────────────────── */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-5xl text-white tracking-wide leading-none">Portfolio</h1>
          <p className="font-mono text-sm text-[#999] mt-2">All positions · Real-time yield</p>
        </div>
        <div className="flex gap-8">
          <div className="text-right">
            <p className="font-mono text-xs text-[#777] uppercase tracking-widest">Reliability</p>
            <p className="font-mono text-2xl text-white mt-1">{isLoading ? "—" : `${stats!.reliabilityPercent}%`}</p>
          </div>
          <div className="text-right">
            <p className="font-mono text-xs text-[#777] uppercase tracking-widest">Active Loans</p>
            <p className="font-mono text-2xl text-white mt-1">{active.length}</p>
          </div>
        </div>
      </div>

      {/* ── Top stats ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-white/[0.07]">
        <StatCard label="Total Borrowed"  value={`$${fmt(stats?.totalBorrowed  ?? 0)}`} />
        <StatCard label="Total Repaid"    value={`$${fmt(stats?.totalRepaid    ?? 0)}`} />
        <StatCard label="Yield Earned"    value={`$${isLoading ? "—" : (stats!.earnedYield).toFixed(2)}`} />
        <StatCard label="Global Rank"     value={isLoading ? "—" : `#${stats!.globalRank.toLocaleString()}`} />
      </div>

      {/* ── Two-column main layout ─────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

        {/* LEFT — 2/3 width */}
        <div className="col-span-1 lg:col-span-2 space-y-4">

          {/* Active loans table */}
          <div className="card p-6">
            <div className="flex items-center justify-between mb-4">
              <SectionLabel>Active Loans</SectionLabel>
              <span className="font-mono text-xs text-[#999]">Streak: <span className="text-white">{stats?.streakCount ?? 0} days {stats?.streakCount ? "🔥" : ""}</span></span>
            </div>
            {active.length === 0 ? (
              <p className="font-mono text-sm text-[#777] py-4">No active loans.</p>
            ) : (
              <Table headers={["Vault","Borrowed","APR","Health","Due","Progress",""]}>
                {active.map(loan => (
                  <TableRow key={loan.id}>
                    <Td bright>{loan.id}</Td>
                    <Td>{loan.borrowedAmount.toLocaleString()} USDC</Td>
                    <Td bright>{(loan.aprRate*100).toFixed(1)}%</Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <ProgressBar value={Math.min(100,(loan.healthFactor/2.5)*100)} className="w-16" />
                        <span className="text-white text-sm">{loan.healthFactor.toFixed(2)}</span>
                      </div>
                    </Td>
                    <Td dim>{new Date(loan.dueDate).toLocaleDateString("en",{month:"short",day:"numeric"})}</Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <ProgressBar value={loan.repaidPercent} className="w-16" />
                        <span className="text-sm text-[#aaa]">{loan.repaidPercent}%</span>
                      </div>
                    </Td>
                    <Td>
                      <button
                        onClick={() => repayLoan(loan.id, loan.borrowedAmount, loan.solidityLoanId)}
                        disabled={repayingId === loan.id}
                        className="font-mono text-xs uppercase tracking-wide text-[#999] border border-white/[0.14] px-3 py-1.5 hover:text-white hover:border-white/30 transition-all disabled:opacity-30 flex items-center gap-1.5"
                      >
                        {repayingId === loan.id
                          ? <><span className="w-3 h-3 border border-[#999] border-t-white rounded-full animate-spin"/>...</>
                          : "Repay"}
                      </button>
                    </Td>
                  </TableRow>
                ))}
              </Table>
            )}
            {closed.length > 0 && (
              <div className="mt-4 pt-4 border-t border-white/[0.06]">
                <p className="font-mono text-xs text-[#777] uppercase tracking-widest mb-3">Closed Positions</p>
                <Table headers={["Vault","Borrowed","Status","Opened"]}>
                  {closed.map(loan => (
                    <TableRow key={loan.id}>
                      <Td dim>{loan.id}</Td>
                      <Td dim>{loan.borrowedAmount.toLocaleString()} USDC</Td>
                      <Td><span className="font-mono text-xs text-[#777] border border-white/[0.08] px-2 py-0.5 uppercase">{loan.status}</span></Td>
                      <Td dim>{new Date(loan.openedAt).toLocaleDateString()}</Td>
                    </TableRow>
                  ))}
                </Table>
              </div>
            )}
          </div>

          {/* Lend positions */}
          {deposits.length > 0 && (
            <div className="card p-6">
              <SectionLabel>Lend Positions</SectionLabel>
              <div className="divide-y divide-white/[0.06]">
                {deposits.map(d => (
                  <div key={d.id} className="py-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <p className="font-mono text-xs text-[#777]">Position</p>
                      <p className="font-mono text-sm text-white mt-1">{d.id}</p>
                    </div>
                    <div>
                      <p className="font-mono text-xs text-[#777]">Deposited</p>
                      <p className="font-mono text-sm text-white mt-1">{d.amount.toLocaleString()} USDC</p>
                    </div>
                    <div>
                      <p className="font-mono text-xs text-[#777]">Yield Earned</p>
                      <p className="font-mono text-sm text-white mt-1">+${d.earnedYield.toFixed(4)}</p>
                    </div>
                    <div>
                      <p className="font-mono text-xs text-[#777]">Pool Share</p>
                      <p className="font-mono text-sm text-white mt-1">{(d.sharePercent*100).toFixed(4)}%</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Volume chart */}
          <div className="card p-6">
            <SectionLabel>Borrow vs Repayment History</SectionLabel>
            <ChartWrapper height={180}>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={loanChartData} barGap={2}>
                  <XAxis dataKey="month" tick={{ fill:"#888", fontSize:13, fontFamily:"DM Mono" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill:"#888", fontSize:13, fontFamily:"DM Mono" }} axisLine={false} tickLine={false} tickFormatter={v=>`$${(v/1000).toFixed(0)}K`} />
                  <Tooltip {...TOOLTIP_STYLE} formatter={(v:unknown)=>[`$${Number(v).toLocaleString()}`, undefined as never]} />
                  <Bar dataKey="borrowed" name="Borrowed" fill="rgba(255,255,255,0.18)" radius={[2,2,0,0]} />
                  <Bar dataKey="repaid"   name="Repaid"   fill="rgba(255,255,255,0.07)" radius={[2,2,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartWrapper>
          </div>
        </div>

        {/* RIGHT — 1/3 width */}
        <div className="space-y-4">

          {/* Repayment streak */}
          <div className="card p-6">
            <SectionLabel>Repayment Streak</SectionLabel>
            <div className="flex items-baseline gap-2 mb-4">
              <span className="font-mono text-5xl text-white font-medium">{stats?.streakCount ?? 0}</span>
              <span className="font-mono text-sm text-[#999]">days</span>
            </div>
            <div className="grid grid-cols-5 sm:grid-cols-10 gap-1 mb-4">
              {Array.from({length:30},(_,i)=>i<Math.min(30,stats?.streakCount??0)).map((paid,i) => (
                <div key={i} className="h-2.5 rounded-sm" style={{ background: paid ? "#fff" : "#1e1e1e" }} />
              ))}
            </div>
            <div className="bg-[#0a0a0a] border border-white/[0.07] p-3">
              <p className="font-mono text-sm text-[#aaa] leading-relaxed">
                <span className="text-white">Bonus:</span> 8 more payments → <span className="text-white">Platinum</span>
              </p>
              <ProgressBar value={Math.round(((stats?.streakCount ?? 0) % 30) / 30 * 100)} className="mt-3" />
              <div className="flex justify-between font-mono text-xs text-[#777] mt-1.5">
                <span>Gold</span><span>Platinum</span>
              </div>
            </div>
          </div>

          {/* XP progress */}
          <div className="card p-6">
            <SectionLabel>Tier Upgrade</SectionLabel>
            <div className="flex justify-between font-mono text-sm mb-2">
              <span className="text-[#999]">XP Progress</span>
              <span className="text-white font-medium">{score?.xp ?? 0} / {score?.nextTierXP ?? 1000}</span>
            </div>
            <ProgressBar value={Math.round(((score?.xp ?? 0) / (score?.nextTierXP ?? 1000)) * 100)} />
            <p className="font-mono text-sm text-[#999] mt-3 leading-relaxed">
              Maintain 100% repayment for 14 more days to unlock Platinum Tier.
            </p>
          </div>

          {/* Yield chart */}
          <div className="card p-6">
            <SectionLabel>Yield Over Time</SectionLabel>
            <ChartWrapper height={130}>
              <ResponsiveContainer width="100%" height={130}>
                <AreaChart data={yieldChartData}>
                  <defs>
                    <linearGradient id="yg" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#fff" stopOpacity={0.08} />
                      <stop offset="95%" stopColor="#fff" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="month" tick={{ fill:"#888", fontSize:13, fontFamily:"DM Mono" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill:"#888", fontSize:13, fontFamily:"DM Mono" }} axisLine={false} tickLine={false} tickFormatter={v=>`$${v}`} />
                  <Tooltip {...TOOLTIP_STYLE} />
                  <Area type="monotone" dataKey="yield" stroke="rgba(255,255,255,0.6)" strokeWidth={1.5} fill="url(#yg)" />
                </AreaChart>
              </ResponsiveContainer>
            </ChartWrapper>
          </div>

          {/* Quick stats */}
          <div className="card p-6 space-y-4">
            {[
              { l:"Total Lent",    v:`$${deposits.reduce((a,d)=>a+d.amount,0).toLocaleString()} USDC` },
              { l:"Net Position",  v:isLoading?"—":`$${(stats!.totalRepaid-stats!.totalBorrowed+stats!.earnedYield).toLocaleString("en",{maximumFractionDigits:0})}` },
              { l:"Protocol Revenue", v:isLoading?"—":`$${stats!.protocolRevenue.toFixed(2)}` },
            ].map(({l,v}) => (
              <div key={l} className="flex justify-between items-center">
                <p className="font-mono text-sm text-[#999]">{l}</p>
                <p className="font-mono text-sm text-white">{v}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
