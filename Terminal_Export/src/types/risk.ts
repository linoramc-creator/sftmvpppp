// TypeScript mirrors of the risk analytics payload computed by the
// analyze-ticker edge function (handleRisk). All numbers are deterministic,
// calculated in backend code — never by an LLM.

export interface DrawdownPoint {
  date: string;
  drawdown: number; // fraction ≤ 0 (−0.35 = 35% below the running high)
}

export interface RefugePoint {
  date: string;
  corr: number | null; // 60-session rolling Pearson correlation vs GLD
}

export interface VixBin {
  ret: number;   // bin midpoint, daily return in %
  calm: number;  // relative frequency (%) of calm days (VIX ≤ 25) in this bin
  panic: number; // relative frequency (%) of panic days (VIX > 25) in this bin
}

export interface OilPoint {
  x: number; // Brent daily return (%)
  y: number; // asset daily return (%)
}

export interface RiskResponse {
  ticker: string;
  drawdown: {
    points: DrawdownPoint[];
    maxDrawdown: number;
    current: number;
  } | null;
  refuge: {
    points: RefugePoint[];
    current: number | null;
  } | null;
  vixRegime: {
    bins: VixBin[];
    calmDays: number;
    panicDays: number;
    calmMean: number | null;
    calmStd: number | null;
    panicMean: number | null;
    panicStd: number | null;
    /** Decimated VIX closes (2y) for the regime band; absent on older backends. */
    vixSeries?: { date: string; vix: number }[];
  } | null;
  oilBeta: {
    points: OilPoint[];
    beta: number;
    alpha: number;
    r2: number | null;
    days: number;
  } | null;
  fetchedAt: string;
}
