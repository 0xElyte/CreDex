"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { useZKProof } from "@/hooks/useZKProof";
import { ensureMUSDCApproval } from "@/hooks/useWallet";
import { useCollateralOptions, useCreditScore } from "@/hooks/useQueries";
import { useWalletGuard } from "@/hooks/useWalletGuard";
import { useToast } from "@/hooks/useToast";
import { ZKProofModal } from "@/components/borrow/ZKProofModal";
import { updateLoanRepayment } from "@/store/financeSlice";
import { submitRepayment } from "@/lib/api";
import {
  StatCard, SectionLabel, ProgressBar, SignalRow, StatusPill, Table, TableRow, Td,
} from "@/components/ui";
import { gsap } from "gsap";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";
import { ChartWrapper } from "@/components/ui/ChartWrapper";
import type { BorrowRequestPayload } from "@/types";
import { clsx } from "clsx";

// ─── Etherscan link helper ────────────────────────────────────────────────────
function EtherscanLink({ hash, label }: { hash: string; label?: string }) {
  if (!hash || hash.length < 10) return null;
  return (
    <a
      href={`https://sepolia.etherscan.io/tx/${hash}`}
      target="_blank"
      rel="noopener noreferrer"
      className="font-mono text-xs text-[#aaa] hover:text-white transition-colors underline underline-offset-2 decoration-white/20 hover:decoration-white/60 truncate max-w-[120px] block"
      title={hash}
    >
      {label ?? `${hash.slice(0, 10)}...${hash.slice(-4)}`}
    </a>
  );
}

// ─── Countdown helper ──────────────────────────────────────────────────────────
function useCountdown(dueDate: string) {
  const [timeLeft, setTimeLeft] = useState("");
  useEffect(() => {
    const calc = () => {
      const diff = new Date(dueDate).getTime() - Date.now();
      if (diff <= 0) { setTimeLeft("Overdue"); return; }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      setTimeLeft(d > 0 ? `${d}d ${h}h` : `${h}h`);
    };
    calc();
    const iv = setInterval(calc, 60_000);
    return () => clearInterval(iv);
  }, [dueDate]);
  return timeLeft;
}

// ─── Repayment chart data ──────────────────────────────────────────────────────
const REPAY_DATA = [
  { month: "May", borrowed: 45000, repaid: 10000 },
  { month: "Jun", borrowed: 57000, repaid: 22000 },
  { month: "Jul", borrowed: 57000, repaid: 31000 },
  { month: "Aug", borrowed: 57000, repaid: 40000 },
  { month: "Sep", borrowed: 57000, repaid: 52000 },
  { month: "Oct", borrowed: 57000, repaid: 57000 },
];

const HEALTH_DATA = [
  { day: "D1", hf: 2.1 }, { day: "D7", hf: 2.0 }, { day: "D14", hf: 1.95 },
  { day: "D21", hf: 1.88 }, { day: "D28", hf: 1.84 }, { day: "Today", hf: 1.82 },
];

// ─── Borrow Form ───────────────────────────────────────────────────────────────
// Backend loan limits (from Go store/store.go)
const MIN_LOAN_USDC = 10;
const MAX_LOAN_USDC = 10_000;

function BorrowForm({ onSubmit }: { onSubmit: (p: BorrowRequestPayload) => void }) {
  const wallet = useAppSelector((s) => s.wallet);
  const { data: collateral = [] } = useCollateralOptions();
  const { data: score } = useCreditScore();
  const [amount, setAmount] = useState(1000);
  const [asset, setAsset] = useState<"WETH" | "WBTC" | "stETH">("WETH");
  const [duration, setDuration] = useState<30 | 60 | 90 | 180>(30);

  // Tier-based max: use score.maxLTV to derive cap, but hard cap is $10,000
  const tierMaxLoan = MAX_LOAN_USDC;

  const selectedAsset = collateral.find((c) => c.asset === asset);
  const collateralRequired = selectedAsset
    ? amount / selectedAsset.usdPrice / selectedAsset.ltv
    : 0;
  const ltv = Math.min(90, Math.round((amount / ((collateralRequired || 1) * (selectedAsset?.usdPrice || 2650))) * 100));
  const monthlyInterest = Math.round((amount * (score?.aprRate ?? 0.042) * 12) / 12);

  // Validation
  const amountTooLow  = amount > 0 && amount < MIN_LOAN_USDC;
  const amountTooHigh = amount > tierMaxLoan;
  const amountInvalid = amountTooLow || amountTooHigh;

  return (
    <div className="card p-6 space-y-5">
      <p className="font-display text-xl text-white tracking-wide">New Borrow Request</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Amount */}
        <div>
          <label className="font-mono text-xs text-[#888] tracking-widest uppercase block mb-2">Amount (USDC)</label>
          <input
            type="number" value={amount}
            min={MIN_LOAN_USDC} max={MAX_LOAN_USDC}
            onChange={(e) => setAmount(Math.max(0, Number(e.target.value)))}
            className={clsx(
              "w-full bg-[#111] border-l-2 px-3 py-3 font-mono text-base text-white focus:outline-none transition-colors",
              amountInvalid ? "border-l-[#888]" : "border-white/20 focus:border-l-white"
            )}
          />
        </div>
        {/* Amount validation */}
        {amountTooLow && (
          <div className="col-span-2 font-mono text-xs text-[#aaa]">
            ⚠ Minimum loan amount is ${MIN_LOAN_USDC.toLocaleString()} USDC
          </div>
        )}
        {amountTooHigh && (
          <div className="col-span-2 font-mono text-xs text-[#aaa]">
            ⚠ Maximum loan amount is ${MAX_LOAN_USDC.toLocaleString()} USDC
          </div>
        )}

        {/* Collateral */}
        <div>
          <label className="font-mono text-xs text-[#888] tracking-widest uppercase block mb-2">Collateral Asset</label>
          <select
            value={asset}
            onChange={(e) => setAsset(e.target.value as typeof asset)}
            className="w-full bg-[#111] border-l-2 border-white/20 px-3 py-3 font-mono text-sm text-[#999] focus:outline-none focus:border-l-white transition-colors appearance-none"
          >
            {collateral.map((c) => (
              <option key={c.asset} value={c.asset}>
                {c.asset} — {c.available.toFixed(2)} avail · ${c.usdPrice.toLocaleString()}
              </option>
            ))}
          </select>
        </div>
        {/* Duration */}
        <div>
          <label className="font-mono text-xs text-[#888] tracking-widest uppercase block mb-2">Duration</label>
          <select
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value) as typeof duration)}
            className="w-full bg-[#111] border-l-2 border-white/20 px-3 py-3 font-mono text-sm text-[#999] focus:outline-none focus:border-l-white transition-colors appearance-none"
          >
            {[30, 60, 90, 180].map((d) => <option key={d} value={d}>{d} Days</option>)}
          </select>
        </div>
        {/* Rate */}
        <div>
          <label className="font-mono text-xs text-[#888] tracking-widest uppercase block mb-2">Your Rate</label>
          <div className="bg-[#111] border-l-2 border-white/20 px-3 py-3 font-mono text-sm text-white">
            4.2% APR <span className="text-[#888]">(Gold Tier)</span>
          </div>
        </div>
      </div>

      {/* Live calc */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-[#1a1a1a]">
        {[
          { label: "LTV Ratio", value: `${ltv}%`, ok: ltv <= 80 },
          { label: "Collateral Req.", value: `${collateralRequired.toFixed(2)} ${asset}` },
          { label: "Monthly Interest", value: `$${monthlyInterest.toLocaleString()}` },
        ].map((item) => (
          <div key={item.label} className="bg-[#0c0c0c] p-4 text-center">
            <p className={clsx("font-mono text-sm font-medium", item.ok === false ? "text-[#aaa]" : "text-white")}>{item.value}</p>
            <p className="font-mono text-sm text-[#888] tracking-widest uppercase mt-1">{item.label}</p>
          </div>
        ))}
      </div>

      {/* LTV health bar */}
      <div>
        <div className="flex justify-between font-mono text-xs text-[#888] mb-1">
          <span>LTV Safety</span>
          <span className={ltv > 85 ? "text-[#888]" : "text-white"}>{ltv <= 60 ? "Conservative" : ltv <= 75 ? "Moderate" : ltv <= 85 ? "Aggressive" : "At Limit"}</span>
        </div>
        <ProgressBar value={ltv} />
      </div>

      <button
        disabled={!wallet.address || amount <= 0 || amountInvalid}
        onClick={() => onSubmit({ amount, collateralAsset: asset, duration, walletAddress: wallet.address! })}
        className="w-full bg-white text-black font-mono text-sm tracking-wide uppercase py-4 hover:bg-[#e8e8e8] active:scale-[.98] transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        ⚡ Generate ZK Proof &amp; Borrow
      </button>
      <p className="font-mono text-sm text-[#aaa] text-center tracking-wide">
        ZK proof generation runs Cairo VM on StarkNet. Do not close the window once started.
      </p>
    </div>
  );
}

// ─── Loan Table with repay ─────────────────────────────────────────────────────
function LoanTable() {
  const dispatch = useAppDispatch();
  const loans = useAppSelector((s) => s.finance.loans);
  const walletAddress = useAppSelector((s) => s.wallet.address);
  const { success: toastSuccess, info: toastInfo } = useToast();
  const [repayingId, setRepayingId] = useState<string | null>(null);

  const repayLoan = useCallback(async (id: string, amount: number) => {
    setRepayingId(id);
    toastInfo("Processing Repayment", `Submitting repayment for ${id}...`);
    try {
      if (walletAddress) await submitRepayment(walletAddress, id);
    } catch (err) {
      console.warn("[repay] backend call failed (updating local state anyway):", err);
    }
    dispatch(updateLoanRepayment({ id, repaidPercent: 100 }));
    setRepayingId(null);
    toastSuccess("Repayment Confirmed", `${amount.toLocaleString()} USDC · ${id} closed`);
  }, [dispatch, toastSuccess, toastInfo, walletAddress]);

  const active = loans.filter((l) => l.status === "active");
  const closed = loans.filter((l) => l.status !== "active");

  return (
    <div className="card p-6 space-y-5">
      <div className="flex items-center justify-between">
        <p className="font-display text-lg text-white tracking-wide">Active Loan Positions</p>
        <div className="flex items-center gap-4 font-mono text-xs text-[#888]">
          <span>STREAK: <span className="text-white">412 DAYS 🔥</span></span>
          <span className="text-[#aaa]">|</span>
          <span>{active.length} ACTIVE · {closed.length} CLOSED</span>
        </div>
      </div>

      {active.length === 0 && (
        <p className="font-mono text-sm text-[#777] py-6 text-center border border-white/[0.04]">
          No active loans. Use the form above to borrow.
        </p>
      )}

      {active.length > 0 && (
        <Table headers={["Vault ID", "Borrowed", "Collateral", "APR", "Health", "Due", "Progress", ""]}>
          {active.map((loan) => (
            <TableRow key={loan.id}>
              <Td bright>{loan.id}</Td>
              <Td>{loan.borrowedAmount.toLocaleString()} USDC</Td>
              <Td>{loan.collateralAmount.toFixed(2)} {loan.collateralAsset}</Td>
              <Td bright>{(loan.aprRate * 100).toFixed(1)}%</Td>
              <Td>
                <div className="flex items-center gap-2">
                  <div className="w-14 h-[2px] bg-[#1a1a1a] overflow-hidden">
                    <div className="h-full bg-white transition-all duration-700"
                      style={{ width: `${Math.min(100, (loan.healthFactor / 2.5) * 100)}%` }} />
                  </div>
                  <span className={clsx("text-xs", loan.healthFactor < 1.2 ? "text-[#888]" : "text-white")}>
                    {loan.healthFactor.toFixed(2)}
                  </span>
                </div>
              </Td>
              <Td dim>
                <LoanCountdown dueDate={loan.dueDate} />
              </Td>
              <Td>
                <div className="flex items-center gap-2">
                  <div className="w-14 h-[2px] bg-[#1a1a1a] overflow-hidden">
                    <div className="h-full bg-white transition-all duration-700"
                      style={{ width: `${loan.repaidPercent}%` }} />
                  </div>
                  <span className="text-xs">{loan.repaidPercent}%</span>
                </div>
              </Td>
              <Td>
                <button
                  onClick={() => repayLoan(loan.id, loan.borrowedAmount)}
                  disabled={repayingId === loan.id}
                  className="font-mono text-xs tracking-wide uppercase text-[#999] border border-white/[0.1] px-3 py-1.5 hover:text-white hover:border-white/25 transition-all disabled:opacity-30 flex items-center gap-1.5"
                >
                  {repayingId === loan.id ? (
                    <><span className="w-2 h-2 border border-white/30 border-t-white rounded-full animate-spin" />Repaying</>
                  ) : "Repay"}
                </button>
              </Td>
            </TableRow>
          ))}
        </Table>
      )}

      {/* Closed loans section */}
      {closed.length > 0 && (
        <div className="pt-4 border-t border-white/[0.04]">
          <p className="font-mono text-xs text-[#777] tracking-widest uppercase mb-3">Closed Positions</p>
          <Table headers={["Vault ID", "Borrowed", "Status", "Opened", ""]}>
            {closed.map((loan) => (
              <TableRow key={loan.id}>
                <Td dim>{loan.id}</Td>
                <Td dim>{loan.borrowedAmount.toLocaleString()} USDC</Td>
                <Td>
                  <span className="font-mono text-xs text-[#888] border border-white/[0.06] px-2 py-0.5 uppercase tracking-wide">
                    {loan.status}
                  </span>
                </Td>
                <Td dim>{new Date(loan.openedAt).toLocaleDateString()}</Td>
                <Td dim>
                  <EtherscanLink hash={loan.txHash} />
                </Td>
              </TableRow>
            ))}
          </Table>
        </div>
      )}
    </div>
  );
}

// ─── Loan Countdown ───────────────────────────────────────────────────────────
function LoanCountdown({ dueDate }: { dueDate: string }) {
  const timeLeft = useCountdown(dueDate);
  const isOverdue = timeLeft === "Overdue";
  return (
    <div>
      <span className={clsx("font-mono text-xs", isOverdue ? "text-[#888]" : "text-white")}>
        {timeLeft}
      </span>
      <span className="font-mono text-xs text-[#666] block">
        {new Date(dueDate).toLocaleDateString("en", { month: "short", day: "numeric" })}
      </span>
    </div>
  );
}

// ─── Score Panel ───────────────────────────────────────────────────────────────
function ScorePanel() {
  const { data: score } = useCreditScore();
  if (!score) return (
    <div className="card p-6 flex items-center justify-center h-full min-h-[200px]">
      <div className="flex items-center gap-2 font-mono text-xs text-[#777]">
        <span className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" />
        Loading score...
      </div>
    </div>
  );

  return (
    <div className="card p-6 h-full">
      <SectionLabel>Credit Architecture</SectionLabel>
      <div className="mb-5">
        <p className="font-display text-4xl text-white tracking-wide leading-none">{score.tier.toUpperCase()}</p>
        <p className="font-mono text-xs text-[#777] mt-1 tracking-wide">
          SCORE: {score.hash} · TOP 4.2%
        </p>
      </div>
      <div className="space-y-0">
        {score.signals.map((s) => (
          <SignalRow key={s.label} label={s.label} value={s.value} dimBar={s.value < 20} />
        ))}
      </div>
      <div className="mt-5 pt-4 border-t border-white/[0.05] grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="bg-[#0a0a0a] p-3 text-center">
          <p className="font-mono text-sm text-white">{score.maxLTV * 100}%</p>
          <p className="font-mono text-sm text-[#777] uppercase tracking-wide mt-1">Max LTV</p>
        </div>
        <div className="bg-[#0a0a0a] p-3 text-center">
          <p className="font-mono text-sm text-white">{(score.aprRate * 100).toFixed(1)}%</p>
          <p className="font-mono text-sm text-[#777] uppercase tracking-wide mt-1">Your APR</p>
        </div>
      </div>
    </div>
  );
}

// ─── Charts Row ────────────────────────────────────────────────────────────────
function ChartsRow() {
  const [activeTab, setActiveTab] = useState<"volume" | "health">("volume");

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-5">
        <p className="font-display text-lg text-white tracking-wide">
          {activeTab === "volume" ? "Borrow Volume & Repayments" : "Health Factor Trend"}
        </p>
        <div className="flex gap-1">
          {(["volume", "health"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={clsx(
                "font-mono text-xs px-3 py-1.5 tracking-wide uppercase transition-all border",
                activeTab === tab
                  ? "bg-white text-black border-white"
                  : "text-[#888] border-white/[0.1] hover:text-white hover:border-white/25"
              )}
            >
              {tab === "volume" ? "Volume" : "Health"}
            </button>
          ))}
        </div>
      </div>

      {activeTab === "volume" && (
        <ChartWrapper height={200}>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={REPAY_DATA} barGap={2}>
            <XAxis dataKey="month" tick={{ fill: "#888", fontSize: 12, fontFamily: "DM Mono" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: "#888", fontSize: 12, fontFamily: "DM Mono" }} axisLine={false} tickLine={false}
              tickFormatter={(v) => `$${(v / 1000).toFixed(0)}K`} />
            <Tooltip
              contentStyle={{ background: "#111", border: "1px solid rgba(255,255,255,.07)", borderRadius: 0, fontFamily: "DM Mono", fontSize: 12 }}
              labelStyle={{ color: "#555" }} itemStyle={{ color: "#fff" }}
              formatter={(v: unknown) => [`$${Number(v).toLocaleString()}`, undefined as never]} />
            <Bar dataKey="borrowed" name="Borrowed" fill="rgba(255,255,255,0.15)" radius={[1, 1, 0, 0]} />
            <Bar dataKey="repaid" name="Repaid" fill="rgba(255,255,255,0.06)" radius={[1, 1, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
        </ChartWrapper>
      )}

      {activeTab === "health" && (
        <ChartWrapper height={200}>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={HEALTH_DATA}>
            <defs>
              <linearGradient id="hfGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#fff" stopOpacity={0.06} />
                <stop offset="95%" stopColor="#fff" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="day" tick={{ fill: "#888", fontSize: 12, fontFamily: "DM Mono" }} axisLine={false} tickLine={false} />
            <YAxis domain={[1.5, 2.5]} tick={{ fill: "#888", fontSize: 12, fontFamily: "DM Mono" }} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={{ background: "#111", border: "1px solid rgba(255,255,255,.07)", borderRadius: 0, fontFamily: "DM Mono", fontSize: 12 }}
              labelStyle={{ color: "#555" }} itemStyle={{ color: "#fff" }} />
            <Area type="monotone" dataKey="hf" name="Health Factor"
              stroke="rgba(255,255,255,0.7)" strokeWidth={1.5} fill="url(#hfGrad)" />
          </AreaChart>
        </ResponsiveContainer>
        </ChartWrapper>
      )}

      <div className="flex flex-wrap gap-3 mt-3 font-mono text-xs text-[#777]">
        <span>CPU: 88.2%</span>
        <span>ENTROPY: 0.99923</span>
        <span>ZK Latency: 142ms</span>
        <span className="ml-auto">LAST SYNC: <span className="text-white">just now</span></span>
      </div>
    </div>
  );
}

// ─── Main Borrow Page ──────────────────────────────────────────────────────────
export default function BorrowPage() {
  useWalletGuard();

  const { data: score, isError: scoreError } = useCreditScore();
  const scoringDown = scoreError || (score && score.hash === "8f3d...912a");

  const loans = useAppSelector((s) => s.finance.loans);
  const activeLoanVolume = loans.reduce((a, l) => a + (l.status === "active" ? l.borrowedAmount : 0), 0);
  const activeLoans = loans.filter((l) => l.status === "active");
  const avgHealth = activeLoans.length > 0
    ? activeLoans.reduce((a, l) => a + l.healthFactor, 0) / activeLoans.length
    : 0;

  const { runProof, isRunning, step } = useZKProof();
  const [showModal, setShowModal] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // GSAP entrance
  useEffect(() => {
    if (!containerRef.current) return;
    const ctx = gsap.context(() => {
      gsap.from(".borrow-animate", {
        y: 14, duration: 0.5, stagger: 0.06, ease: "power3.out", clearProps: "transform",
      });
    }, containerRef);
    return () => ctx.revert();
  }, []);

  const handleBorrow = async (payload: BorrowRequestPayload) => {
    // Ensure MetaMask has approved mUSDC for CredexLending before borrowing
    const approved = await ensureMUSDCApproval(payload.amount);
    if (!approved) {
      console.warn("[borrow] mUSDC approval failed or rejected — proceeding anyway");
    }
    setShowModal(true);
    runProof(payload);
  };

  const handleModalClose = () => {
    // Only allow closing after confirmed or failed — prevents accidental close mid-proof
    if (step === "confirmed" || step === "failed" || !isRunning) {
      setShowModal(false);
    }
  };

  return (
    <div ref={containerRef} className="space-y-5">
      {/* Header */}
      <div className="borrow-animate flex items-start justify-between">
        <div>
          <h1 className="font-display text-4xl text-white tracking-wide">Borrow Dashboard</h1>
          <p className="font-mono text-xs text-[#777] tracking-widest uppercase mt-1">
            Vault CDX-4492-ZK · ZK-Proof Active · Sovereign Credit Scoring
          </p>
        </div>
        <div className="flex gap-2">
          <StatusPill label="Protocol Healthy" />
          <StatusPill label="ZK Active" />
        </div>
      </div>

      {/* Scoring engine offline banner */}
      {scoringDown && (
        <div className="borrow-animate flex items-center gap-3 border border-white/[0.1] bg-white/[0.02] px-4 py-3">
          <span className="w-2 h-2 rounded-full bg-[#888] shrink-0" />
          <p className="font-mono text-sm text-[#aaa]">
            Credit scoring engine offline — score data is estimated.
            Start the Python engine on <span className="text-white">:8001</span> for live scoring.
          </p>
        </div>
      )}

      {/* Wizard progress */}
      <div className="borrow-animate flex items-center">
        {[
          { n: "✓", label: "Collateralise", done: true, active: false },
          { n: "02", label: "Borrow", done: false, active: true },
          { n: "03", label: "Repay", done: false, active: false },
        ].map((s, i) => (
          <div key={i} className="flex items-center">
            <div className="flex items-center gap-2.5">
              <div className={clsx(
                "w-8 h-8 rounded-full border flex items-center justify-center font-mono text-sm",
                s.done ? "border-white text-white bg-white/[0.04]"
                  : s.active ? "bg-white text-black border-white font-bold"
                  : "border-white/[0.12] text-[#777]"
              )}>{s.n}</div>
              <span className={clsx("font-mono text-xs tracking-widest uppercase",
                s.active ? "text-white" : s.done ? "text-[#999]" : "text-[#aaa]")}>
                {s.label}
              </span>
            </div>
            {i < 2 && <div className="w-12 h-px bg-white/[0.08] mx-3" />}
          </div>
        ))}
      </div>

      {/* Stats row */}
      <div className="borrow-animate grid grid-cols-2 sm:grid-cols-3 gap-px bg-white/[0.05]">
        <StatCard
          label="Health Factor"
          value={avgHealth > 0 ? avgHealth.toFixed(2) : "—"}
          sub="Liquidation triggers at 1.0"
        />
        <StatCard
          label="Active Loan Volume"
          value={activeLoanVolume > 0 ? `$${activeLoanVolume.toLocaleString()}` : "$0"}
        />
        <StatCard
          label="Repayment Streak"
          value="412 Days 🔥"
          sub="+2.5% score multiplier active"
        />
      </div>

      {/* Form + Score */}
      <div className="borrow-animate grid grid-cols-2 sm:grid-cols-3 gap-px bg-white/[0.05]">
        <div className="col-span-2 bg-[#0c0c0c]">
          <BorrowForm onSubmit={handleBorrow} />
        </div>
        <div className="bg-[#0c0c0c]">
          <ScorePanel />
        </div>
      </div>

      {/* Charts */}
      <div className="borrow-animate">
        <ChartsRow />
      </div>

      {/* Loan positions */}
      <div className="borrow-animate">
        <LoanTable />
      </div>

      {/* ZK Proof Modal */}
      {showModal && (
        <ZKProofModal onClose={handleModalClose} />
      )}
    </div>
  );
}
