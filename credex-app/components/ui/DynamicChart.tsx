"use client";
/**
 * Re-exports Recharts components wrapped in a client-only boundary.
 * Import from here instead of directly from "recharts" in page files
 * to eliminate the SSR width/height=-1 warning at build time.
 */
export {
  AreaChart, Area,
  BarChart, Bar,
  LineChart, Line,
  PieChart, Pie, Cell,
  XAxis, YAxis,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
