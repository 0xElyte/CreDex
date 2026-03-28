"use client";
import { useEffect, useState } from "react";

interface Props {
  height?: number;
  children: React.ReactNode;
  className?: string;
}

/**
 * SSR-safe Recharts wrapper.
 * Reserves layout space before JS hydrates — no layout shift, no spinner.
 * Recharts throws "width=-1" warnings during SSR; this gate suppresses them.
 */
export function ChartWrapper({ height = 200, children, className }: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  return (
    <div className={className} style={{ height, minHeight: height }}>
      {mounted ? children : null}
    </div>
  );
}
