import { clsx } from "clsx";

export function StatCard({ label, value, sub, trend }: {
  label: string; value: string; sub?: string; trend?: string;
}) {
  return (
    <div className="card p-5">
      <p className="font-mono text-xs text-[#aaa] tracking-widest uppercase mb-2">{label}</p>
      <p className="font-mono text-2xl font-medium text-white leading-none">{value}</p>
      {trend && <p className="font-mono text-sm text-white mt-2">{trend}</p>}
      {sub   && <p className="font-mono text-xs text-[#aaa] mt-1">{sub}</p>}
    </div>
  );
}

export function SectionLabel({ children }: { children: string }) {
  return (
    <p className="font-mono text-xs text-[#aaa] tracking-widest uppercase flex items-center gap-3 mb-4">
      <span className="w-4 h-px bg-white/30 inline-block" />
      {children}
    </p>
  );
}

export function ProgressBar({ value, className, pulse }: {
  value: number; className?: string; pulse?: boolean;
}) {
  return (
    <div className={clsx("h-[3px] bg-[#1c1c1c] overflow-hidden", className)}>
      <div
        className={clsx("h-full bg-white transition-all duration-700", pulse && "progress-pulse")}
        style={{ width:`${Math.min(100,value)}%` }}
      />
    </div>
  );
}

export function SignalRow({ label, value, dimBar }: {
  label: string; value: number; dimBar?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <span className="font-mono text-xs text-[#777] min-w-[110px]">{label}</span>
      <div className="flex-1 h-[3px] bg-[#1a1a1a] overflow-hidden">
        <div className="h-full transition-all duration-700"
          style={{ width:`${value}%`, background: dimBar ? "rgba(255,255,255,0.3)" : "#fff" }} />
      </div>
      <span className="font-mono text-sm min-w-[40px] text-right" style={{ color: dimBar ? "#555" : "#fff" }}>
        {value === 100 ? "MAX" : `${value}%`}
      </span>
    </div>
  );
}

export function StatusPill({ label, active=true }: { label: string; active?: boolean }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border border-white/[0.12] font-mono text-xs tracking-wide uppercase text-[#777]">
      <span className={clsx("w-1.5 h-1.5 rounded-full", active ? "bg-white animate-pulse" : "bg-[#333]")} />
      {label}
    </div>
  );
}

export function Table({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          {headers.map(h => (
            <th key={h} className="font-mono text-xs text-[#999] tracking-widest uppercase text-left px-3 py-2.5 border-b border-white/[0.07]">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

export function TableRow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <tr className={clsx("border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors", className)}>
      {children}
    </tr>
  );
}

export function Td({ children, bright, dim }: { children: React.ReactNode; bright?: boolean; dim?: boolean }) {
  return (
    <td className={clsx("font-mono text-sm px-3 py-3", bright ? "text-white" : dim ? "text-[#999]" : "text-[#999]")}>
      {children}
    </td>
  );
}

export { ChartWrapper } from "./ChartWrapper";
