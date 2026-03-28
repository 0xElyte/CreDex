"use client";
import { useEffect } from "react";
import Link from "next/link";
import { clsx } from "clsx";

export default function LandingPage() {

  useEffect(() => {
    // Nav scroll effect
    const nav = document.getElementById("main-nav");
    const onScroll = () => {
      if (!nav) return;
      if (window.scrollY > 60) {
        nav.classList.add("nav-scrolled");
      } else {
        nav.classList.remove("nav-scrolled");
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    // Vault text cycling
    const words = ["Encrypting...", "Computing...", "Verifying...", "Proven ✓"];
    let wi = 0;
    const interval = setInterval(() => {
      wi = (wi + 1) % words.length;
      const el = document.getElementById("vct");
      if (el) el.textContent = words[wi];
    }, 1800);

    return () => {
      window.removeEventListener("scroll", onScroll);
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="min-h-screen relative bg-black">
      {/* Subtle grid background */}
      <div className="fixed inset-0 pointer-events-none z-0" style={{
        backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.04) 1px, transparent 0)",
        backgroundSize: "40px 40px",
      }} />

      {/* NAV */}
      <nav id="main-nav" className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-10 h-16 transition-all duration-300 [&.nav-scrolled]:bg-black/95 [&.nav-scrolled]:border-b [&.nav-scrolled]:border-white/[0.08] [&.nav-scrolled]:backdrop-blur-md">
        <span className="font-display text-2xl text-white tracking-wider">LENDR
          <span className="font-mono text-xs text-[#999] ml-2 tracking-widest align-middle">Protocol</span>
        </span>
        <div className="flex items-center gap-8">
          <a href="#how" className="font-mono text-sm text-[#777] hover:text-white transition-colors tracking-wide uppercase">How It Works</a>
          <a href="#problems" className="font-mono text-sm text-[#777] hover:text-white transition-colors tracking-wide uppercase">Why Lendr</a>
          <Link href="/app" className="font-mono text-sm bg-white text-black px-5 py-2 hover:bg-[#e8e8e8] transition-colors tracking-wide uppercase font-medium">
            Launch App
          </Link>
        </div>
      </nav>

      {/* HERO */}
      <section className="relative z-10 min-h-screen flex flex-col justify-center px-10 pt-20">
        <div className="animate-fadeup">
          <div className="font-mono text-sm text-[#999] tracking-widest uppercase flex items-center gap-3 mb-10">
            <span className="w-8 h-px bg-white/30 inline-block" />
            <span className="w-2 h-2 bg-white rounded-full inline-block animate-pulse" />
            Network Live · Block #21,482,110 · 99.98% Uptime
          </div>

          <h1 className="font-display leading-none tracking-wide max-w-5xl mb-8 text-white" style={{ fontSize: "clamp(72px,11vw,148px)" }}>
            BORROW WITHOUT<br />
            <span className="italic" style={{ fontFamily: "Georgia,'Times New Roman',serif" }}>Exposing</span><br />
            <span style={{ WebkitTextStroke: "1px rgba(255,255,255,0.2)", color: "transparent" }}>YOURSELF.</span>
          </h1>

          <p className="text-lg text-[#888] max-w-lg leading-relaxed font-light mb-12">
            FHE-encrypted credit scores. ZK-proven eligibility.{" "}
            <code className="font-mono text-sm text-[#aaa] bg-white/[0.06] px-2 py-0.5">// No KYC. Just math.</code>
          </p>

          <div className="flex gap-4">
            <Link href="/app" className="font-mono text-sm bg-white text-black px-10 py-4 hover:bg-[#e8e8e8] transition-colors tracking-wide uppercase font-medium">
              Enter the Vault
            </Link>
            <a href="#how" className="font-mono text-sm text-[#777] border border-white/[0.15] px-10 py-4 hover:text-white hover:border-white/30 transition-colors tracking-wide uppercase">
              How It Works
            </a>
          </div>
        </div>

        {/* Floating stats */}
        <div className="absolute right-10 bottom-20 flex flex-col gap-5 animate-fadeup">
          {[
            { val: "$1.24B", label: "Protocol TVL" },
            { val: "48,209", label: "Active Vaults" },
            { val: "0.021%", label: "Default Rate" },
          ].map((s) => (
            <div key={s.label} className="text-right pr-5 border-r border-white/[0.15]">
              <span className="font-mono text-2xl font-medium text-white block leading-none">{s.val}</span>
              <span className="font-mono text-xs text-[#999] tracking-widest uppercase mt-1 block">{s.label}</span>
            </div>
          ))}
        </div>

        <div className="absolute bottom-10 left-10 flex items-center gap-3 font-mono text-xs text-[#888] tracking-widest uppercase">
          <div className="w-px h-12 bg-gradient-to-b from-white to-transparent" />
          Scroll
        </div>
      </section>

      {/* TICKER */}
      <div className="relative z-10 overflow-hidden border-t border-white/[0.07] border-b border-white/[0.07] bg-[#080808] py-4">
        <div className="flex ticker-track whitespace-nowrap">
          {Array(2).fill(null).map((_, ri) => (
            <span key={ri} className="flex">
              {["FHE Encryption","ZK-Proof Generation","Soulbound NFT Identity","90% LTV Ratio","Zero KYC","Multi-Chain Scoring","StarkNet Settlement","Trail of Bits Audited"].map((t) => (
                <span key={t} className="inline-flex items-center gap-3 font-mono text-sm text-[#999] tracking-wide uppercase px-10">
                  <span className="text-white text-xs">◆</span>{t}
                </span>
              ))}
            </span>
          ))}
        </div>
      </div>

      {/* METRICS */}
      <div className="relative z-10 bg-[#080808] border-b border-white/[0.07] px-10 py-5 flex gap-12 overflow-x-auto">
        {[["$1.24B","TVL"],["4.2%","Borrow APR"],["14.82%","Lend APY"],["0.021%","Default Rate"],["48,209","Borrowers"],["142ms","ZK Latency"],["1,204","Active Loans"]].map(([v,l]) => (
          <div key={l} className="flex-shrink-0">
            <p className="font-mono text-xl text-white font-medium leading-none">{v}</p>
            <p className="font-mono text-xs text-[#999] tracking-widest uppercase mt-1">{l}</p>
          </div>
        ))}
      </div>

      {/* PROBLEMS */}
      <section id="problems" className="relative z-10 px-10 py-28 max-w-7xl mx-auto">
        <p className="font-mono text-sm text-[#999] tracking-widest uppercase flex items-center gap-3 mb-5">
          <span className="w-5 h-px bg-white inline-block" />Problems We Solve
        </p>
        <h2 className="font-display text-white leading-none tracking-wide mb-14" style={{ fontSize: "clamp(44px,6vw,80px)" }}>
          LEGACY DEFI<br />
          <span className="italic text-[#888]" style={{ fontFamily: "Georgia,'Times New Roman',serif" }}>Is Broken.</span>
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-white/[0.07]">
          {[
            { n:"01", t:"150% Collateral Trap", d:"Legacy protocols over-collateralize because they can't verify your history. FHE proves creditworthiness without seeing your data.", tag:"Solved via ZK-Proofs" },
            { n:"02", t:"Your Wallet Is Public", d:"On-chain activity is a transparency nightmare. Lendr creates a Sovereign Vault where your identity stays encrypted — even from us.", tag:"FHE Encryption Active" },
            { n:"03", t:"Sybil Attacks", d:"Lending protocols are drained by botnets. Our cryptographic identity layer ensures unique humans without a passport.", tag:"Humanity Verified" },
          ].map((c) => (
            <div key={c.n} className="bg-[#0c0c0c] p-10 relative overflow-hidden group hover:bg-[#111] transition-colors">
              <div className="absolute top-0 left-0 right-0 h-px bg-white transform scale-x-0 group-hover:scale-x-100 transition-transform duration-500 origin-left" />
              <p className="font-mono text-xs text-[#888] tracking-widest uppercase mb-8">{c.n}</p>
              <h3 className="font-display text-3xl text-white tracking-wide mb-4">{c.t}</h3>
              <p className="text-base text-[#888] leading-relaxed font-light mb-8">{c.d}</p>
              <span className="font-mono text-xs text-[#999] border border-white/[0.12] px-3 py-1.5 tracking-wide uppercase group-hover:text-white group-hover:border-white/25 transition-all">
                ◆ {c.tag}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" className="relative z-10 px-10 py-20 max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-20 items-center">
        <div>
          <p className="font-mono text-sm text-[#999] tracking-widest uppercase flex items-center gap-3 mb-5">
            <span className="w-5 h-px bg-white inline-block" />Process
          </p>
          <h2 className="font-display text-white leading-none tracking-wide mb-12" style={{ fontSize: "clamp(40px,5vw,68px)" }}>
            THREE STEPS<br />
            <span className="italic text-[#888]" style={{ fontFamily: "Georgia,'Times New Roman',serif" }}>To Sovereignty.</span>
          </h2>
          {[
            { n:"— 01", t:"Identity Hash", d:"Connect your wallet. A cryptographic fingerprint is generated without capturing any PII. You remain anonymous." },
            { n:"— 02", t:"FHE Aggregate Score", d:"Fully Homomorphic Encryption computes your credit score across 4 chains simultaneously, without decrypting a single data point." },
            { n:"— 03", t:"Vault Access Unlocked", d:"Your ZK proof grants borrowing power up to 90% LTV based purely on your cryptographic credit tier. No paperwork. No KYC." },
          ].map((s) => (
            <div key={s.n} className="flex gap-6 py-6 border-b border-white/[0.07] group hover:pl-4 transition-all duration-300 relative overflow-hidden">
              <div className="absolute inset-0 bg-white/[0.02] opacity-0 group-hover:opacity-100 transition-opacity" />
              <span className="font-mono text-sm text-[#888] min-w-[48px] pt-0.5 shrink-0">{s.n}</span>
              <div>
                <h3 className="font-display text-2xl text-white tracking-wide mb-2">{s.t}</h3>
                <p className="text-base text-[#888] leading-relaxed font-light">{s.d}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Vault visual */}
        <div className="hidden md:flex aspect-square bg-[#0c0c0c] border border-white/[0.07] relative overflow-hidden items-center justify-center">
          <div className="absolute top-0 bottom-0 left-1/2 w-px bg-white/[0.04]" />
          <div className="absolute left-0 right-0 top-1/2 h-px bg-white/[0.04]" />
          {[82,60,36].map((s,i) => (
            <div key={s} className="absolute border border-white/[0.06] rounded-full ring-spin"
              style={{ width:`${s}%`, height:`${s}%`, top:"50%", left:"50%",
                animationDuration:`${[14,9,6][i]}s`,
                animationDirection: i===1 ? "reverse" : "normal",
                borderColor: i===2 ? "rgba(255,255,255,0.12)" : undefined }} />
          ))}
          <div className="absolute w-2.5 h-2.5 bg-white rounded-full" style={{ top:"9%", left:"50%", transform:"translateX(-50%)" }} />
          <div className="absolute w-1.5 h-1.5 bg-white/40 rounded-full" style={{ bottom:"24%", right:"18%" }} />
          <div className="relative z-10 w-28 h-28 bg-white/[0.04] border border-white/[0.12] flex flex-col items-center justify-center gap-2">
            <span className="text-4xl" style={{ filter:"grayscale(1)" }}>🔐</span>
            <span id="vct" className="font-mono text-xs text-[#999] tracking-widest uppercase">Encrypting</span>
          </div>
          <div className="absolute top-5 left-5 w-5 h-5 border-t border-l border-white/[0.1]" />
          <div className="absolute bottom-5 right-5 w-5 h-5 border-b border-r border-white/[0.1]" />
        </div>
      </section>

      {/* TECH */}
      <section className="relative z-10 px-10 py-20 max-w-7xl mx-auto">
        <p className="font-mono text-sm text-[#999] tracking-widest uppercase flex items-center gap-3 mb-4">
          <span className="w-5 h-px bg-white inline-block" />Infrastructure
        </p>
        <h2 className="font-display text-white leading-none tracking-wide mb-12" style={{ fontSize: "clamp(40px,5vw,68px)" }}>
          CRYPTOGRAPHIC<br />
          <span className="italic text-[#888]" style={{ fontFamily: "Georgia,'Times New Roman',serif" }}>Bedrock.</span>
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-white/[0.07]">
          {[
            { name:"Zama FHE", sub:"Homomorphic Encryption", src:"https://lh3.googleusercontent.com/aida-public/AB6AXuA1y3U4nD-GCmoA4WzqAqXszkjGbX8BNQ9PQ7XwKUGtJpRpvmdMKy9V848a-hFQ90fO6VbL6r_Lwwt-5sh0F_bwjSzDkKSK8SOwWF8WGr8wNAkgumAf_b7CWsL4-JenNRBIvwXNpd8-DEj58locCkGrVMY-HMXLsEF53PLYulGel8HDJ_uQuGAhQfVcOolIdsY4kQSTVGjBI1kETkaDsoBeyodCiaFflp8BBzx_uf41P_pvB583FL-7WLDGJX5isMEekN5FvcUfjrg" },
            { name:"StarkNet", sub:"ZK Settlement", src:"https://lh3.googleusercontent.com/aida-public/AB6AXuAJd_LP_rJbhkXCFKnVyaTQ56-XQtKIomeQdSN2uKEzUfwErx8IsQG0P4xk1uMH9JwFSBo8kM1UBlPsDo9PW2zKIoHU9YJ35QXwAyLkoxZqzEPnvuElQU91vFH5GaaJo_ght4fhHVDJ6n_YpldecHKfXjDjRdPM1sb-e2B-xM-99r0AzDeZRpAGpPObd9thCUWXR6VGBIw0DS6V5GOG--Tj8StmvUqYEtVS4MG-0XkASCI1Jx-GsaUMRtuQ14Yj2Pm9RWp4mxhCjWA" },
            { name:"Filecoin", sub:"Decentralised Storage", src:"https://lh3.googleusercontent.com/aida-public/AB6AXuDKlaFndkLd6C71Ry5bjlo7_nnJuuGodQz1k8GpcsTkU_2QkMpa9JJLXoVyVa7k7dF_P_6NTiCPXL04EHBNn_EKlFugcUn6XSj549SgoOQbB1QSsYzZPHNu-kFZ0ksm8maVc3oJ_gdJKkDDVYYdxCKN61IE0dy3Ib-yBe4P51X8L9uUv3Pc2EtLgjRIeXdAIaBig7EiDKk1g3xh3jslyYuw8eXJ_eZznvPYt7OQjb_0azO0VYXkY-XIlCNZpnZ21_syuU8touk53nw" },
            { name:"Ethereum", sub:"Base Layer", src:"https://lh3.googleusercontent.com/aida-public/AB6AXuBAYlXzWpcOOzOh6-sQOHtZRQi8_BXUoMzfSGkdeLnFRUJTiK2he778rZXMLllNHg9oUrbOdUVvu7wMiIn2U2rXXCFFQrm4_oNIzByZYzNkralQuIpBdZ8OB-V8mQ6fqzzqL7Unmu6FaisbbVDmkClKeV-ncJZ5ggqgwsIGtiGYbv1qXc5lSVKzqNy9hg-h-XmFq8uxRlnIi3eY7v0z_CyGdKXT90dyXc3x25BsHeAiWG0YY5xNb4j64F7O37XyqOnrPiWzVDsfSUc" },
          ].map((t) => (
            <div key={t.name} className="bg-[#0c0c0c] p-10 flex flex-col items-center text-center gap-4 group hover:bg-[#111] transition-colors">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={t.src} alt={t.name} className="w-14 h-14 object-contain" style={{ filter:"grayscale(1) brightness(0.28)", transition:"filter .4s" }}
                onMouseEnter={e=>(e.currentTarget.style.filter="grayscale(1) brightness(0.7)")}
                onMouseLeave={e=>(e.currentTarget.style.filter="grayscale(1) brightness(0.28)")} />
              <div>
                <p className="font-mono text-sm text-[#888] tracking-wide uppercase">{t.name}</p>
                <p className="font-mono text-xs text-[#888] mt-1">{t.sub}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section id="cta" className="relative z-10 px-10 py-36 text-center border-t border-white/[0.07] overflow-hidden">
        <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse at 50% 50%, rgba(255,255,255,0.02) 0%, transparent 70%)" }} />
        <h2 className="font-display text-white leading-none tracking-wide mb-6 relative z-10" style={{ fontSize: "clamp(56px,9vw,120px)" }}>
          READY TO<br />
          <span className="italic" style={{ fontFamily: "Georgia,'Times New Roman',serif" }}>Stay Invisible?</span>
        </h2>
        <p className="font-mono text-sm text-[#999] tracking-widest uppercase mb-10 relative z-10">
          // No passport. No history. Just cryptographic truth.
        </p>
        <div className="flex gap-4 justify-center relative z-10">
          <Link href="/app" className="font-mono text-sm bg-white text-black px-12 py-4 hover:bg-[#e8e8e8] transition-colors tracking-wide uppercase font-medium">
            Enter the Vault →
          </Link>
          <a href="#" className="font-mono text-sm text-[#777] border border-white/[0.15] px-12 py-4 hover:text-white hover:border-white/30 transition-colors tracking-wide uppercase">
            Read the Docs
          </a>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="relative z-10 border-t border-white/[0.07] bg-[#080808] px-10 py-10 grid grid-cols-4 gap-12">
        <div>
          <p className="font-display text-2xl text-white tracking-wide mb-3">LENDR</p>
          <p className="text-sm text-[#999] font-light leading-relaxed max-w-[200px]">
            Building the cryptographic infrastructure for sovereign DeFi.
          </p>
        </div>
        {[
          { h:"Protocol", links:["Governance","Security Audit","Documentation","Whitepaper"] },
          { h:"Technology", links:["FHE Modules","ZK-Aggregator","Sovereign Proofs","Cairo VM"] },
          { h:"Community", links:["X / Twitter","Discord","Github","Forum"] },
        ].map((col) => (
          <div key={col.h}>
            <p className="font-mono text-xs text-[#888] tracking-widest uppercase mb-4">{col.h}</p>
            <div className="space-y-3">
              {col.links.map((l) => (
                <a key={l} href="#" className="block text-sm text-[#999] hover:text-white transition-colors">{l}</a>
              ))}
            </div>
          </div>
        ))}
        <div className="col-span-4 border-t border-white/[0.06] pt-6 flex items-center justify-between">
          <span className="font-mono text-xs text-[#888]">© 2026 LENDR PROTOCOL. ALL RIGHTS RESERVED.</span>
          <div className="flex items-center gap-2 font-mono text-xs text-[#888]">
            <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
            MAINNET · BLOCK #21,482,110
          </div>
        </div>
      </footer>
    </div>
  );
}

