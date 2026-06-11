import { useEffect, useState } from "react";
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { fetchTickerFundamentals } from "@/lib/analyze";

// 1-month price chart of the analysed instrument, shown inside the executive
// summary. Same visual language as the sidebar index sparklines (area +
// gradient, blue when up / red when down) but larger — it is part of the
// analysis, not a widget. Data comes from the deterministic fundamentals
// endpoint (Yahoo daily closes), never from the LLM.

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

interface PricePoint { t: number; v: number }

export function InstrumentPriceChart({ ticker }: { ticker: string }) {
  const [points, setPoints]   = useState<PricePoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ticker) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setPoints([]);
    fetchTickerFundamentals(ticker)
      .then((f) => {
        if (cancelled) return;
        const price = f?.price;
        if (!price || price.c.length < 2) { setPoints([]); return; }
        const start = Math.max(0, price.c.length - SESSIONS_1M);
        const out: PricePoint[] = [];
        for (let i = start; i < price.c.length; i++) {
          out.push({ t: price.t[i], v: price.c[i] });
        }
        setPoints(out);
      })
      .catch(() => { if (!cancelled) setPoints([]); })
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
  const lo = Math.min(...points.map((p) => p.v));
  const hi = Math.max(...points.map((p) => p.v));

  return (
    <div className="mb-4" style={{ background: "#0d1520", border: "1px solid #1e293b", borderRadius: 4, padding: "10px 12px 8px" }}>
      <div className="flex justify-between items-start gap-3 flex-wrap">
        <div>
          <div style={{ fontSize: 10, letterSpacing: "0.12em", color: "#94a3b8", textTransform: "uppercase", fontWeight: 600 }}>
            {ticker} · PRECIO 1 MES
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
              dataKey="t"
              tickFormatter={fmtTickDate}
              stroke="#334155"
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              minTickGap={48}
              style={{ fontSize: 9, fontFamily: "monospace" }}
            />
            <YAxis
              domain={["dataMin", "dataMax"]}
              stroke="#334155"
              tickLine={false}
              axisLine={false}
              width={46}
              tickFormatter={(v: number) => fmtPrice(v)}
              style={{ fontSize: 9, fontFamily: "monospace" }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#0f172a",
                borderColor: "#1e293b",
                borderRadius: 4,
                fontFamily: "monospace",
                fontSize: 11,
              }}
              labelFormatter={(t) => fmtTickDate(t as number)}
              formatter={(v: number) => [`$${fmtPrice(v)}`, "Precio"]}
              cursor={{ stroke: "#475569", strokeWidth: 1 }}
            />
            <Area
              type="monotone"
              dataKey="v"
              stroke={color}
              strokeWidth={1.8}
              fill={`url(#instr-grad-${ticker})`}
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
        <div className="flex justify-between mt-0.5" style={{ fontSize: 9, color: "#475569", fontFamily: "monospace", letterSpacing: "0.05em" }}>
          <span>L {fmtPrice(lo)}</span>
          <span>H {fmtPrice(hi)}</span>
        </div>
      </div>
    </div>
  );
}
