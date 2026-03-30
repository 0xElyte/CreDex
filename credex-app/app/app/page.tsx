"use client";
import React from "react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import { useLendingAsset } from "@/hooks/useQueries";
import { clsx } from "clsx";

export default function HubPage() {
  const { isConnected, tier, shortAddress } = useWallet();
  const { data: lendingAsset = "USDC" } = useLendingAsset();

  // Role state — persisted in sessionStorage so it survives navigation
  const [selectedRole, setSelectedRole] = useState<"borrow" | "lend" | null>(() => {
    if (typeof window !== "undefined") {
      return (sessionStorage.getItem("lendr-role") as "borrow" | "lend") || null;
    }
    return null;
  });

  const selectRole = (role: "borrow" | "lend") => {
    setSelectedRole(role);
    if (typeof window !== "undefined") sessionStorage.setItem("lendr-role", role);
  };

  // Clear role on disconnect
  useEffect(() => {
    if (!isConnected) {
      setSelectedRole(null);
      if (typeof window !== "undefined") sessionStorage.removeItem("lendr-role");
    }
  }, [isConnected]);

  return (
    <div
     
      className="min-h-[calc(100vh-56px)] flex flex-col items-center justify-center px-6 py-12"
    >
      {/* Title */}
      <div className="text-center mb-10">
        <p className="font-mono text-xs text-[#aaa] tracking-widest uppercase flex items-center justify-center gap-3 mb-4">
          <span className="w-5 h-px bg-white/20 inline-block" />
          Sovereign Vault Protocol
          <span className="w-5 h-px bg-white/20 inline-block" />
        </p>
        <h1 className="font-display text-5xl sm:text-7xl text-white tracking-wide leading-none mb-4">
          SELECT YOUR MODE
        </h1>
        <p className="font-mono text-sm text-[#888] tracking-wide">
          {isConnected
            ? `Connected as ${shortAddress} · ${tier} Tier · ZK Active`
            : "Connect your wallet to unlock protocol access"}
        </p>
      </div>

      {/* Cards */}
      <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 gap-px w-full max-w-2xl bg-white/[0.07]">
        <ModeCard
          num="01" title={<><span className="block">Borrow</span><span className="block text-3xl sm:text-4xl font-display text-[#aaa]">{lendingAsset}</span></>}
          desc="Access undercollateralised credit using your ZK-proven credit score. No KYC required."
          stats={[
            { label: "Starting APR", value: "4.2%" },
            { label: "Max LTV", value: "90%" },
            { label: "Asset", value: "USDC" },
          ]}
          href="/app/borrow"
          locked={!isConnected}
          selected={selectedRole === "borrow"}
          onSelect={() => selectRole("borrow")}
        />
        <ModeCard
          num="02" title={<><span className="block">Lend</span><span className="block text-3xl sm:text-4xl font-display text-[#aaa]">{lendingAsset}</span></>}
          desc="Deposit liquidity and earn institutional-grade yield on sovereign credit positions."
          stats={[
            { label: "APY (Platinum)", value: "14.82%" },
            { label: "TVL", value: "$142M" },
            { label: "Default Rate", value: "0.021%" },
          ]}
          href="/app/lend"
          locked={!isConnected}
          selected={selectedRole === "lend"}
          onSelect={() => selectRole("lend")}
        />
      </div>

      {/* Status */}
      <div className="mt-8">
        {!isConnected ? (
          <p className="font-mono text-sm text-[#999] tracking-wide text-center">
            Use the &ldquo;Connect Wallet&rdquo; button in the top-right corner
          </p>
        ) : selectedRole ? (
          <div className="flex items-center gap-4 font-mono text-sm text-[#888]">
            <span className="text-white">{selectedRole === "borrow" ? "Borrow" : "Lend"} mode active</span>
            <span className="w-px h-4 bg-white/10" />
            <Link href={`/app/${selectedRole}`} className="text-white border border-white/20 px-4 py-2 hover:bg-white hover:text-black transition-all text-xs tracking-widest uppercase">
              Enter Dashboard →
            </Link>
          </div>
        ) : (
          <p className="font-mono text-sm text-[#aaa] tracking-wide text-center">
            Select a mode above to continue
          </p>
        )}
      </div>
    </div>
  );
}

function ModeCard({
  num, title, desc, stats, href, locked, selected, onSelect,
}: {
  num: string; title: React.ReactNode; desc: string;
  stats: { label: string; value: string }[];
  href: string; locked: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const inner = (
    <div
      className={clsx(
        "bg-[#0c0c0c] p-8 sm:p-10 flex flex-col relative overflow-hidden group transition-all duration-300 min-h-[280px]",
        locked
          ? "opacity-40 cursor-not-allowed"
          : selected
          ? "bg-[#141414] ring-1 ring-white/30"
          : "hover:bg-[#111] cursor-pointer"
      )}
    >
      {!locked && (
        <div className={clsx(
          "absolute top-0 left-0 right-0 h-px bg-white transition-transform duration-500 origin-left",
          selected ? "scale-x-100" : "scale-x-0 group-hover:scale-x-100"
        )} />
      )}
      {selected && (
        <div className="absolute top-3 right-3 font-mono text-sm text-white border border-white/30 px-2 py-0.5 bg-white/5 tracking-widest">
          SELECTED
        </div>
      )}
      {locked && (
        <div className="absolute top-4 right-4 text-[#888] text-base">🔒</div>
      )}

      <p className="font-mono text-xs text-[#999] tracking-widest uppercase mb-6">{num}</p>
      <h2 className="font-display text-5xl sm:text-6xl text-white tracking-wide leading-none mb-3">{title}</h2>
      <p className="text-sm text-[#777] leading-relaxed mb-6 font-body">{desc}</p>

      <div className="space-y-2.5 mb-6">
        {stats.map((s) => (
          <div key={s.label} className="flex items-center gap-3 font-mono text-sm">
            <span className="text-white font-medium w-16">{s.value}</span>
            <span className="text-[#aaa]">{s.label}</span>
          </div>
        ))}
      </div>

      <div className={clsx(
        "font-mono text-sm tracking-widest uppercase flex items-center gap-2 mt-auto transition-colors",
        selected ? "text-white" : "text-[#999] group-hover:text-white"
      )}>
        {locked ? "Locked" : selected ? "Selected ✓" : "Select"}{" "}
        {!locked && <span className="inline-block transition-transform group-hover:translate-x-1">→</span>}
      </div>
    </div>
  );

  if (locked) return inner;
  // If selected, also make it a link to the dashboard
  if (selected) {
    return (
      <Link href={href} onClick={onSelect}>
        {inner}
      </Link>
    );
  }
  return <div onClick={onSelect}>{inner}</div>;
}
