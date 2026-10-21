// Shared Recharts styling + formatters for the Options section.
// Preserve calls/positive and puts/negative colors across options and reports.

export const OPT_COLORS = {
  bg: "#0b131f",
  call: "#22c55e",   // green-500  (bullish / calls)
  put: "#f87171",    // red-400    (bearish / puts)
  spot: "#e2e8f0",   // slate-100  (reference line: current price)
  flip: "#fbbf24",   // amber-400  (gamma flip)
  maxPain: "#a78bfa",// violet-400 (max pain)
  smile: "#818cf8",  // indigo-400 (OTM IV smile)
  term: "#38bdf8",   // sky-400    (term structure ATM IV)
  hv: "#94a3b8",     // slate-400  (realized vol)
  iv: "#22c55e",     // green      (implied vol reference)
  axis: "#8190a6",
  grid: "#243142",
  gridStrong: "#52647d",
} as const;

export const ttStyle = {
  backgroundColor: "#101b29",
  border: "1px solid #334155",
  borderRadius: "10px",
  color: "#e2e8f0",
  fontFamily: "var(--font-sans), system-ui, sans-serif",
  fontSize: "11px",
  fontVariantNumeric: "tabular-nums",
  lineHeight: "1.6",
  padding: "10px 12px",
  boxShadow: "0 8px 28px #0006",
} as const;

export const chartCursor={stroke:'#7dd3fc',strokeOpacity:.45,strokeWidth:.8,strokeDasharray:'3 4'} as const;

// ── Formatters ──────────────────────────────────────────────────────────
export function fmtCompactUsd(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}K`;
  return `${sign}$${a.toFixed(2)}`;
}

export function fmtCompactNum(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (a >= 1e9) return `${sign}${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(1)}K`;
  return `${sign}${a.toFixed(0)}`;
}

// IV / HV come as fractions (0.32 → "32.0%")
export function fmtPctFrac(v: number | null | undefined, dp = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(dp)}%`;
}

// Already-percent values (e.g. expected move pct stored as fraction too → use fmtPctFrac)
export function fmtPlainPct(v: number | null | undefined, dp = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "" : ""}${v.toFixed(dp)}%`;
}

export function fmtNum(v: number | null | undefined, dp = 0): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export function fmtGreek(v: number | null | undefined, dp = 4): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(dp);
}

export function fmtPrice(v: number | null | undefined, dp = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

// Heat color for the IV surface: low IV cool (green) → mid (amber) → high (red).
export function ivHeatColor(iv: number, lo: number, hi: number): string {
  if (hi <= lo) return OPT_COLORS.smile;
  const t = Math.max(0, Math.min(1, (iv - lo) / (hi - lo)));
  // piecewise green → amber → red
  if (t < 0.5) {
    const k = t / 0.5; // green(34,197,94) → amber(251,191,36)
    const r = Math.round(34 + (251 - 34) * k);
    const g = Math.round(197 + (191 - 197) * k);
    const b = Math.round(94 + (36 - 94) * k);
    return `rgb(${r},${g},${b})`;
  }
  const k = (t - 0.5) / 0.5; // amber(251,191,36) → red(248,113,113)
  const r = Math.round(251 + (248 - 251) * k);
  const g = Math.round(191 + (113 - 191) * k);
  const b = Math.round(36 + (113 - 36) * k);
  return `rgb(${r},${g},${b})`;
}
