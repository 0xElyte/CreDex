"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { WalletButton } from "@/components/wallet/WalletButton";
import { ToastContainer } from "@/components/ui/Toast";
import { useAppSelector } from "@/store/hooks";
import { useWallet } from "@/hooks/useWallet";
import { clsx } from "clsx";
import { backendApi } from "@/lib/backendApi";

const BORROW_NAV = [
  { href: "/app/borrow",        label: "Borrow",        icon: "↗" },
  { href: "/app/portfolio",     label: "Portfolio",     icon: "◎" },
  { href: "/app/score-history", label: "Score History", icon: "≋" },
];
const LEND_NAV = [
  { href: "/app/lend",      label: "Lend",      icon: "↙" },
  { href: "/app/portfolio", label: "Portfolio", icon: "◎" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const wallet   = useAppSelector((s) => s.wallet);
  const { chainName } = useWallet();
  const loans    = useAppSelector((s) => s.finance.loans);
  const activeLoanCount = loans.filter((l) => l.status === "active").length;

  // Read role — defaulting to "" so it never renders as blank
  // Read role synchronously to avoid flash of "Select a mode in Hub"
  const [role, setRole] = useState<string>(() =>
    typeof window !== "undefined" ? (sessionStorage.getItem("lendr-role") ?? "") : ""
  );
  // Re-sync on navigation (in case user changed role on Hub)
  useEffect(() => {
    const r = (typeof window !== "undefined" ? sessionStorage.getItem("lendr-role") : null) ?? "";
    setRole(r);
  }, [pathname]);

  // Clear role on disconnect
  useEffect(() => {
    if (wallet.status === "disconnected") {
      setRole("");
      if (typeof window !== "undefined") sessionStorage.removeItem("lendr-role");
    }
  }, [wallet.status]);

  // Backend health ping
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);
  const [sidebarOpen,  setSidebarOpen]  = useState(false);
  useEffect(() => {
    let mounted = true;
    const ping = async () => {
      try {
        await backendApi.health();
        if (mounted) setBackendOnline(true);
      } catch {
        if (mounted) setBackendOnline(false);
      }
    };
    ping();
    const iv = setInterval(ping, 30_000);
    return () => { mounted = false; clearInterval(iv); };
  }, []);

  // Role-specific nav items
  const roleNav = role === "borrow" ? BORROW_NAV : role === "lend" ? LEND_NAV : [];

  // Page-transition fade
  const mainRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    el.style.opacity = "0";
    el.style.transform = "translateY(6px)";
    const raf = requestAnimationFrame(() => {
      el.style.transition = "opacity .28s ease, transform .28s ease";
      el.style.opacity = "1";
      el.style.transform = "translateY(0)";
    });
    return () => cancelAnimationFrame(raf);
  }, [pathname]);

  return (
    <div className="flex min-h-screen noise">
      {/* ── SIDEBAR ─────────────────────────────────────────────── */}
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside className={clsx(
        "fixed left-0 top-0 h-full w-60 bg-[#070707] border-r border-white/[0.09] z-40 flex flex-col transition-transform duration-200",
        "lg:translate-x-0",
        sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
      )}>
        {/* Logo */}
        <div className="px-6 py-5 border-b border-white/[0.07]">
          <Link href="/" className="block">
            <span className="font-display text-3xl text-white tracking-wider">LENDR</span>
          </Link>
          <p className="font-mono text-xs text-[#777] tracking-widest uppercase mt-1">Sovereign Vault</p>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-3 flex flex-col gap-0.5">
          {/* Hub — always visible */}
          <NavItem
            href="/app"
            label="Hub"
            icon="⬡"
            isActive={pathname === "/app"}
            isLocked={false}
            onNav={() => setSidebarOpen(false)}
          />

          {/* Role-gated items */}
          {wallet.status === "connected" && roleNav.map((item) => (
            <NavItem
              key={item.href}
              href={item.href}
              label={item.label}
              icon={item.icon}
              isActive={pathname.startsWith(item.href)}
              isLocked={false}
              badge={item.href === "/app/borrow" && activeLoanCount > 0 ? activeLoanCount : undefined}
              onNav={() => setSidebarOpen(false)}
            />
          ))}

          {/* Placeholder when connected but no role yet */}
          {wallet.status === "connected" && !role && (
            <p className="px-6 py-3 font-mono text-xs text-[#999] italic">
              Select a mode in Hub
            </p>
          )}

          {/* Locked items hint when disconnected */}
          {wallet.status !== "connected" && (
            <div className="px-6 py-3 font-mono text-xs text-[#999] flex items-center gap-2">
              <span>🔒</span> Connect wallet to unlock
            </div>
          )}
        </nav>

        {/* Status */}
        <div className="px-4 py-4 border-t border-white/[0.07]">
          <div className="bg-[#0a0a0a] border border-white/[0.07] p-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-mono text-xs text-[#777] tracking-widest uppercase">Status</span>
              <span className={clsx("w-2 h-2 rounded-full", wallet.status === "connected" ? "bg-white pulse-dot" : "bg-[#333]")} />
            </div>
            <p className="font-mono text-sm text-[#aaa]">
              {wallet.status === "connected" ? "SYNCED" : "DISCONNECTED"}
            </p>
            {wallet.status === "connected" && role && (
              <p className="font-mono text-xs text-[#777] mt-1 uppercase">Mode: {role}</p>
            )}
            <div className="flex items-center gap-1.5 mt-2">
              <span className={clsx("w-1.5 h-1.5 rounded-full shrink-0",
                backendOnline === null ? "bg-[#555]" :
                backendOnline ? "bg-white pulse-dot" : "bg-[#888]"
              )} />
              <span className="font-mono text-xs text-[#777]">
                API: {backendOnline === null ? "..." : backendOnline ? "Online" : "Offline"}
              </span>
            </div>
          </div>
        </div>

        <div className="px-5 py-2.5 border-t border-white/[0.04]">
          <p className="font-mono text-xs text-[#999]">
            {chainName ?? (wallet.status === "connected" ? "UNKNOWN_CHAIN" : "NOT_CONNECTED")}
          </p>
        </div>
      </aside>

      {/* ── MAIN ────────────────────────────────────────────────── */}
      <div className="flex-1 lg:ml-60 flex flex-col min-h-screen">
        <header className="sticky top-0 z-30 flex items-center justify-between px-4 lg:px-8 h-16 bg-black/95 backdrop-blur-md border-b border-white/[0.08]">
          <div className="flex items-center gap-3">
            {/* Hamburger — mobile only */}
            <button
              className="lg:hidden flex flex-col gap-1.5 p-1.5 text-[#888] hover:text-white transition-colors"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open menu"
            >
              <span className="block w-5 h-px bg-current" />
              <span className="block w-5 h-px bg-current" />
              <span className="block w-5 h-px bg-current" />
            </button>

            <div className="flex items-center gap-2 font-mono text-sm text-[#777] tracking-wide uppercase">
              <Link href="/app" className="hover:text-white transition-colors">App</Link>
              {pathname !== "/app" && (
                <>
                  <span className="text-[#999]">/</span>
                  <span className="text-[#aaa] hidden sm:inline">
                    {[...BORROW_NAV, ...LEND_NAV].find(n => pathname.startsWith(n.href))?.label}
                  </span>
                </>
              )}
            </div>
            {wallet.status === "connected" && (
              <div className="hidden md:flex items-center gap-2 font-mono text-xs text-[#aaa]">
                <span className="w-1.5 h-1.5 bg-white rounded-full pulse-dot" />
                Sepolia Testnet
              </div>
            )}
          </div>
          <WalletButton />
        </header>

        {/* Testnet banner */}
        <div className="bg-white/[0.03] border-b border-white/[0.06] px-4 py-1.5 flex items-center justify-center gap-3">
          <span className="w-1.5 h-1.5 rounded-full bg-white pulse-dot shrink-0" />
          <p className="font-mono text-xs text-[#888] tracking-wide">
            Live on <span className="text-white">Ethereum Sepolia Testnet</span> — all transactions are real
          </p>
          <a
            href="https://sepolia.etherscan.io/address/0x7e9A18f269de75D0b4Cd497d9100eBE6C7Ef1c2E"
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-xs text-[#666] hover:text-white transition-colors"
          >
            Contract ↗
          </a>
        </div>

        <main ref={mainRef} className="flex-1 p-4 lg:p-8 max-w-[1440px] w-full mx-auto">
          {children}
        </main>
      </div>

      <ToastContainer />
    </div>
  );
}

function NavItem({
  href, label, icon, isActive, isLocked, badge, onNav,
}: {
  href: string; label: string; icon: string;
  isActive: boolean; isLocked: boolean; badge?: number;
  onNav?: () => void;
}) {
  return (
    <Link
      href={isLocked ? "/app" : href}
      onClick={onNav}
      className={clsx(
        "flex items-center gap-3 px-5 py-3.5 font-mono text-sm tracking-wide uppercase transition-all duration-150 border-l-2",
        isActive
          ? "text-white border-l-white bg-white/[0.07] font-medium"
          : isLocked
          ? "text-[#999] border-transparent cursor-not-allowed"
          : "text-[#888] border-transparent hover:text-white hover:bg-white/[0.04] hover:border-l-white/30"
      )}
    >
      <span className="text-lg w-5 text-center">{icon}</span>
      <span className="flex-1">{label}</span>
      {badge !== undefined && (
        <span className="bg-white text-black font-mono text-xs px-1.5 py-0.5 leading-none min-w-[20px] text-center">
          {badge}
        </span>
      )}
      {isLocked && <span className="text-[#999] text-sm">🔒</span>}
    </Link>
  );
}
