"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { usePoolStats, useActivityFeed, useProtocolBalances } from "@/hooks/useQueries";
import { useDeposit } from "@/hooks/useDeposit";
import { useWalletGuard } from "@/hooks/useWalletGuard";
import { useWallet } from "@/hooks/useWallet";
import { mintUSDC, mintCOLL } from "@/lib/api";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { resetDepositFlow } from "@/store/financeSlice";
import { DepositModal } from "@/components/lend/DepositModal";
import { StatCard, SectionLabel, ProgressBar, StatusPill } from "@/components/ui";
import { gsap } from "gsap";
import {
  ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";


// ─── Get Test Tokens Banner ─────────────────────────────────────────────────────────
function GetTestTokensBanner() {
  const { refreshBalance }                    = useWallet();
  const walletAddress                         = useAppSelector((s) => s.wallet.address);
  const [mintingUsdc,  setMintingUsdc]        = useState(false);
  const [mintingColl,  setMintingColl]        = useState(false);
  const [stepMsg,      setStepMsg]            = useState("");
  const [usdcDone,     setUsdcDone]           = useState(false);
  const [collDone,     setCollDone]           = useState(false);
  const [mintError,    setMintError]          = useState<string | null>(null);

  const isMinting = mintingUsdc || mintingColl;

  // Sepolia RPCs can lag 1-3 blocks behind the latest mined tx.
  // Refresh immediately then again after 3 s and 7 s to catch the propagated state.
  const refreshWithRetry = useCallback(async () => {
    await refreshBalance();
    setTimeout(() => { refreshBalance().catch(() => {}); }, 3_000);
    setTimeout(() => { refreshBalance().catch(() => {}); }, 7_000);
  }, [refreshBalance]);

  const handleMintUsdc = async () => {
    if (!walletAddress || isMinting) return;
    setMintingUsdc(true);
    setMintError(null);
    setUsdcDone(false);
    try {
      await mintUSDC(walletAddress, setStepMsg);
      setUsdcDone(true);
      await refreshWithRetry();
    } catch (err: unknown) {
      setMintError(err instanceof Error ? err.message : "Mint failed");
    } finally {
      setMintingUsdc(false);
      setStepMsg("");
    }
  };

  const handleMintColl = async () => {
    if (!walletAddress || isMinting) return;
    setMintingColl(true);
    setMintError(null);
    setCollDone(false);
    try {
      await mintCOLL(walletAddress, setStepMsg);
      setCollDone(true);
      await refreshWithRetry();
    } catch (err: unknown) {
      setMintError(err instanceof Error ? err.message : "Mint failed");
    } finally {
      setMintingColl(false);
      setStepMsg("");
    }
  };

  return (
    <div className="bg-[#0c0c0c] border border-[#1a1a1a] px-5 py-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs text-[#777] uppercase tracking-widest">Sepolia Testnet</p>
          <p className="font-mono text-sm text-[#aaa] mt-0.5">
            {isMinting ? stepMsg : "Need test tokens? Mint free mUSDC or mCOLL to try the protocol."}
          </p>
          {mintError && <p className="font-mono text-xs text-red-400 mt-1">{mintError}</p>}
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={handleMintUsdc}
            disabled={isMinting || !walletAddress}
            className="font-mono text-xs px-4 py-2 border border-[#333] text-[#ccc] hover:border-[#555] hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {mintingUsdc ? "Minting..." : usdcDone ? "Mint Again" : "Get mUSDC"}
          </button>
          <button
            onClick={handleMintColl}
            disabled={isMinting || !walletAddress}
            className="font-mono text-xs px-4 py-2 border border-[#333] text-[#ccc] hover:border-[#555] hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {mintingColl ? "Minting..." : collDone ? "Mint Again" : "Get mCOLL"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Protocol + Wallet Balances Bar ──────────────────────────────────────────────────
function ProtocolBalancesBar() {
  const wallet = useAppSelector((s) => s.wallet);
  const { data: proto } = useProtocolBalances();

  const fmt = (n: number) => n.toLocaleString("en", { maximumFractionDigits: 2 });

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-white/[0.05]">
      <div className="bg-[#0c0c0c] p-4">
        <p className="font-mono text-xs text-[#777] uppercase tracking-widest mb-1">Your mUSDC</p>
        <p className="font-mono text-xl text-white">{fmt(wallet.balance)}</p>
        <p className="font-mono text-xs text-[#555] mt-1">Available to deposit</p>
      </div>
      <div className="bg-[#0c0c0c] p-4">
        <p className="font-mono text-xs text-[#777] uppercase tracking-widest mb-1">Your mCOLL</p>
        <p className="font-mono text-xl text-white">{fmt(wallet.collateralBalance)}</p>
        <p className="font-mono text-xs text-[#555] mt-1">Collateral asset</p>
      </div>
      <div className="bg-[#0c0c0c] p-4">
        <p className="font-mono text-xs text-[#777] uppercase tracking-widest mb-1">Protocol mUSDC</p>
        <p className="font-mono text-xl text-white">{proto ? fmt(proto.lendingAsset) : "—"}</p>
        <p className="font-mono text-xs text-[#555] mt-1">Total deposited</p>
      </div>
      <div className="bg-[#0c0c0c] p-4">
        <p className="font-mono text-xs text-[#777] uppercase tracking-widest mb-1">Protocol mCOLL</p>
        <p className="font-mono text-xl text-white">{proto ? fmt(proto.collateralAsset) : "—"}</p>
        <p className="font-mono text-xs text-[#555] mt-1">Collateral locked</p>
      </div>
    </div>
  );
}

// ─── Pool Stats ───────────────────────────────────────────────────────────────
function PoolStatsBar() {
  const { data, isLoading } = usePoolStats();
  const fmt = (n: number) =>
    n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : `$${(n / 1e6).toFixed(1)}M`;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-white/[0.05]">
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

  const apy = pool?.apy ?? 0;
  const tvl = pool?.tvl ?? 0;
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
            {wallet.balance.toLocaleString()} mUSDC · {wallet.collateralBalance.toLocaleString()} mCOLL
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
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-[#1a1a1a]">
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

      {/* Current APY */}
      <div>
        <SectionLabel>Current APY</SectionLabel>
        <p className="font-mono text-4xl text-white mt-2">{pool ? `${pool.apy.toFixed(2)}%` : "—"}</p>
        <p className="font-mono text-xs text-[#777] mt-1">Variable rate · computed from live tier definitions</p>
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
  const utilized = data ? Math.round(data.utilizationRate * 100) : 0;
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
          { label: "Active Loans", col: "bg-white", value: data ? `$${(data.activeLoanValue / 1e6).toFixed(1)}M` : "—" },
          { label: "Available Cash", col: "bg-[#1e1e1e]", value: data ? `$${(data.availableCash / 1e6).toFixed(1)}M` : "—" },
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
  const deposits = useAppSelector((s) => s.finance.deposits);
  if (deposits.length === 0) return null;

  return (
    <div className="card p-6">
      <SectionLabel>My Deposit Positions</SectionLabel>
      <div className="divide-y divide-white/[0.04]">
        {deposits.map((d) => (
          <div key={d.id} className="py-3 grid grid-cols-2 sm:grid-cols-5 gap-2 sm:gap-4 items-start sm:items-center font-mono text-sm">
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

  const { executeDeposit, isPending, error: depositError, stepText } = useDeposit();
  const depositSuccess = useAppSelector((s) => s.finance.depositSuccess);
  const dispatch       = useAppDispatch();
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
    await executeDeposit(amount);
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

      {/* Testnet token faucet */}
      <div className="lend-animate"><GetTestTokensBanner /></div>

      {/* Balances bar */}
      <div className="lend-animate"><ProtocolBalancesBar /></div>

      {/* Pool stats */}
      <div className="lend-animate"><PoolStatsBar /></div>

      {/* Main layout */}
      <div className="lend-animate grid grid-cols-2 sm:grid-cols-3 gap-px bg-white/[0.05]">
        <div className="col-span-1 lg:col-span-2 space-y-px bg-white/[0.05]">
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
      {pendingAmount && (isPending || depositSuccess) && (
        <DepositModal
          amount={pendingAmount}
          isPending={isPending}
          error={depositError ?? null}
          stepText={stepText}
          onClose={() => { dispatch(resetDepositFlow()); setPendingAmount(null); }}
        />
      )}
    </div>
  );
}
