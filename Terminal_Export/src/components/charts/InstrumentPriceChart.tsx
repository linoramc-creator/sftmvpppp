import { useEffect, useState } from "react";
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { fetchTickerFundamentals } from "@/lib/analyze";

// 1-month price chart of the analysed instrument, shown inside the executive
// summary. Japanese candlesticks (real Yahoo OHLC) drawn with plain SVG — no
// chart library dependency. When an older backend only ships closes, the
// component falls back to the original area chart instead of rendering a
// degenerate (flat) series. Data comes from the deterministic fundamentals
// endpoint, never from the LLM.

const POS = "#3b82f6"; // blue-500 (matches IndexSparkline)
const NEG = "#f87171"; // red-400

const SESSIONS_1M = 23; // ~1 month of trading sessions

const fmtPrice = (p: number | null) =>
  p != null
    ? p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "—";

const fmtPct = (p: number | null) =>
  p != null ? `${p >= 0 ? "+" : ""}${p.toFixed(2)}%` : "—";

const fmtTickDate = (t: number): string =>
  new Date(t * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" });

interface Candle { t: number; o: number; h: number; l: number; c: number }
interface PricePoint { t: number; v: number }

// ── SVG candlestick canvas ─────────────────────────────────────────────
// viewBox is stretched to the container (preserveAspectRatio="none");
// vector-effect keeps wick/border strokes at 1px regardless of scaling.

const VBW = 1000; // viewBox width
const VBH = 190;  // viewBox height
const PAD_Y = 6;  // top/bottom padding inside the viewBox

function CandleCanvas({ candles }: { candles: Candle[] }) {
  const lo = Math.min(...candles.map((k) => k.l));
  const hi = Math.max(...candles.map((k) => k.h));
  const range = hi - lo || 1;
  const y = (v: number) => PAD_Y + (1 - (v - lo) / range) * (VBH - 2 * PAD_Y);

  const slot = VBW / candles.length;
  const bodyW = Math.max(2, slot * 0.6);

  // 4 horizontal gridlines at equal price intervals
  const ticks = [0, 1 / 3, 2 / 3, 1].map((f) => lo + f * range);

  return (
    <div className="flex" style={{ gap: 6 }}>
      <div className="relative flex-1" style={{ height: VBH }}>
        <svg
          width="100%" height={VBH} viewBox={`0 0 ${VBW} ${VBH}`}
          preserveAspectRatio="none" style={{ display: "block" }}
          role="img" aria-label="Gráfico de velas japonesas, 1 mes"
        >
          {ticks.map((v) => (
            <line
              key={v}
              x1={0} x2={VBW} y1={y(v)} y2={y(v)}
              stroke="#1e293b" strokeDasharray="3 4" vectorEffect="non-scaling-stroke"
            />
          ))}
          {candles.map((k, i) => {
            const x = (i + 0.5) * slot;
            const up = k.c >= k.o;
            const color = up ? POS : NEG;
            const top = y(Math.max(k.o, k.c));
            const bot = y(Math.min(k.o, k.c));
            const bodyH = Math.max(1.5, bot - top);
            const date = fmtTickDate(k.t);
            return (
              <g key={k.t}>
                <title>
                  {`${date}\nO ${fmtPrice(k.o)}  H ${fmtPrice(k.h)}\nL ${fmtPrice(k.l)}  C ${fmtPrice(k.c)}`}
                </title>
                <line
                  x1={x} x2={x} y1={y(k.h)} y2={y(k.l)}
                  stroke={color} strokeWidth={1.2} vectorEffect="non-scaling-stroke"
                />
                <rect
                  x={x - bodyW / 2} y={top} width={bodyW} height={bodyH}
                  fill={color} fillOpacity={0.85}
                  stroke={color} strokeWidth={1} vectorEffect="non-scaling-stroke"
                />
              </g>
            );
          })}
        </svg>
      </div>
      {/* Price axis rendered as HTML so labels never distort with the SVG stretch */}
      <div className="relative shrink-0" style={{ width: 48, height: VBH }}>
        {ticks.map((v) => (
          <span
            key={v}
            className="absolute right-0 font-mono"
            style={{
              top: y(v) - 6, fontSize: 9, color: "#475569", lineHeight: 1,
            }}
          >
            {fmtPrice(v)}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Area fallback (closes only — old backend without OHLC) ─────────────

function AreaFallback({ points, color, ticker }: { points: PricePoint[]; color: string; ticker: string }) {
  return (
    <ResponsiveContainer width="100%" height={190}>
      <AreaChart data={points} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`instr-grad-${ticker}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#1e293b" strokeDasharray="2 3" vertical={false} />
        <XAxis
          dataKey="t" tickFormatter={fmtTickDate} stroke="#334155"
          tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={48}
          style={{ fontSize: 9, fontFamily: "monospace" }}
        />
        <YAxis
          domain={["dataMin", "dataMax"]} stroke="#334155" tickLine={false}
          axisLine={false} width={46} tickFormatter={(v: number) => fmtPrice(v)}
          style={{ fontSize: 9, fontFamily: "monospace" }}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "#0f172a", borderColor: "#1e293b",
            borderRadius: 4, fontFamily: "monospace", fontSize: 11,
          }}
          labelFormatter={(t) => fmtTickDate(t as number)}
          formatter={(v: number) => [`$${fmtPrice(v)}`, "Precio"]}
          cursor={{ stroke: "#475569", strokeWidth: 1 }}
        />
        <Area
          type="monotone" dataKey="v" stroke={color} strokeWidth={1.8}
          fill={`url(#instr-grad-${ticker})`} dot={false} isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── Container ──────────────────────────────────────────────────────────

export function InstrumentPriceChart({ ticker }: { ticker: string }) {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [points, setPoints]   = useState<PricePoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ticker) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setCandles([]);
    setPoints([]);
    fetchTickerFundamentals(ticker)
      .then((f) => {
        if (cancelled) return;
        const price = f?.price;
        if (!price || price.c.length < 2) return;
        const start = Math.max(0, price.c.length - SESSIONS_1M);
        const hasOhlc =
          Array.isArray(price.o) && price.o.length === price.c.length &&
          Array.isArray(price.h) && price.h.length === price.c.length &&
          Array.isArray(price.l) && price.l.length === price.c.length;
        const ks: Candle[] = [];
        const ps: PricePoint[] = [];
        for (let i = start; i < price.c.length; i++) {
          ps.push({ t: price.t[i], v: price.c[i] });
          if (hasOhlc) {
            ks.push({
              t: price.t[i],
              o: price.o![i], h: price.h![i], l: price.l![i], c: price.c[i],
            });
          }
        }
        setPoints(ps);
        setCandles(ks);
      })
      .catch(() => { /* empty state below */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ticker]);

  if (loading) {
    return (
      <div className="mb-4" style={{ height: 250, background: "#0d1520", border: "1px solid #1e293b", borderRadius: 4 }}>
        <div className="h-full flex items-center justify-center">
          <span className="text-[9px] tracking-widest text-muted-foreground/40 uppercase animate-pulse">
            Cargando precio 1 mes...
          </span>
        </div>
      </div>
    );
  }

  if (points.length < 2) {
    return (
      <div className="mb-4 flex flex-col items-center justify-center gap-1"
           style={{ height: 250, background: "#0d1520", border: "1px dashed #1e293b", borderRadius: 4 }}>
        <span className="text-[9px] tracking-widest text-muted-foreground/45 uppercase">Sin histórico de precio disponible</span>
        <span className="text-[8px] text-muted-foreground/30 font-mono">{ticker} · 1M</span>
      </div>
    );
  }

  const last = points[points.length - 1].v;
  const prev = points[points.length - 2].v;
  const first = points[0].v;
  const change1d = prev > 0 ? ((last - prev) / prev) * 100 : null;
  const change1m = first > 0 ? ((last - first) / first) * 100 : null;
  const isPos = (change1m ?? 0) >= 0;
  const color = isPos ? POS : NEG;
  const useCandles = candles.length >= 2;
  const lo = useCandles ? Math.min(...candles.map((k) => k.l)) : Math.min(...points.map((p) => p.v));
  const hi = useCandles ? Math.max(...candles.map((k) => k.h)) : Math.max(...points.map((p) => p.v));

  return (
    <div className="mb-4" style={{ background: "#0d1520", border: "1px solid #1e293b", borderRadius: 4, padding: "10px 12px 8px" }}>
      <div className="flex justify-between items-start gap-3 flex-wrap">
        <div>
          <div style={{ fontSize: 10, letterSpacing: "0.12em", color: "#94a3b8", textTransform: "uppercase", fontWeight: 600 }}>
            {ticker} · PRECIO 1 MES {useCandles ? "· VELAS OHLC" : ""}
          </div>
          <div className="flex gap-2.5 items-baseline mt-0.5">
            <span style={{ fontSize: 18, fontWeight: 600, color: "#e2e8f0", fontFamily: "monospace" }}>
              ${fmtPrice(last)}
            </span>
            <span style={{ fontSize: 11, color: (change1d ?? 0) >= 0 ? POS : NEG, fontFamily: "monospace" }}>
              {fmtPct(change1d)} 1d
            </span>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div style={{ fontSize: 8, color: "#475569", letterSpacing: "0.1em" }}>1M</div>
          <div style={{ fontSize: 12, color, fontFamily: "monospace", lineHeight: 1.2 }}>{fmtPct(change1m)}</div>
        </div>
      </div>

      <div style={{ marginTop: 8 }}>
        {useCandles
          ? <CandleCanvas candles={candles} />
          : <AreaFallback points={points} color={color} ticker={ticker} />}
        <div className="flex justify-between mt-1" style={{ fontSize: 9, color: "#475569", fontFamily: "monospace", letterSpacing: "0.05em" }}>
          <span>{fmtTickDate(points[0].t)} · L {fmtPrice(lo)}</span>
          <span>H {fmtPrice(hi)} · {fmtTickDate(points[points.length - 1].t)}</span>
        </div>
      </div>
    </div>
  );
}
