import { useMemo } from "react";
import {
  CartesianGrid, Line, LineChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { SurfaceResponse } from "@/types/options";
import { OPT_COLORS, ttStyle, fmtPrice } from "./theme";

// One colour per expiry series, cycled if there are more expiries than colours.
const SERIES_COLORS = ["#38bdf8", "#818cf8", "#fbbf24", "#f472b6", "#34d399"];

const fmtExpiry = (iso: string) => {
  const d = new Date(iso + "T00:00:00Z");
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("es-ES", { day: "2-digit", month: "short", timeZone: "UTC" });
};

// IV (%) vs strike, one line per expiry — the classic volatility smile.
// The surface endpoint already keeps only OTM quotes in the 0.7–1.3
// moneyness band, which is exactly the smile convention.
export function VolatilitySmileChart({ data, maxExpiries = 4 }: { data: SurfaceResponse; maxExpiries?: number }) {
  const { rows, series } = useMemo(() => {
    const points = data.points ?? [];
    const expiries = (data.expiries ?? []).slice(0, maxExpiries);
    const byStrike = new Map<number, Record<string, number>>();
    for (const p of points) {
      if (!expiries.includes(p.expiry)) continue;
      const row = byStrike.get(p.strike) ?? {};
      row[p.expiry] = p.iv * 100;
      byStrike.set(p.strike, row);
    }
    const merged = [...byStrike.entries()]
      .map(([strike, ivs]) => ({ strike, ...ivs }))
      .sort((a, b) => a.strike - b.strike);
    return { rows: merged, series: expiries };
  }, [data, maxExpiries]);

  if (rows.length === 0) {
    return (
      <div className="py-12 text-center text-[11px] text-muted-foreground/50 border border-border bg-card">
        Sin cotizaciones de IV suficientes para dibujar el smile de volatilidad.
      </div>
    );
  }

  return (
    <div>
      <div style={{ width: "100%", height: 300, backgroundColor: OPT_COLORS.bg, border: "1px solid #1e293b", borderRadius: 2, padding: "8px 6px" }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 14, right: 12, left: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={OPT_COLORS.grid} />
            <XAxis
              dataKey="strike" type="number" domain={["dataMin", "dataMax"]}
              stroke={OPT_COLORS.axis} tickLine={false}
              tickFormatter={(v: number) => fmtPrice(v, 0)} style={{ fontSize: "10px" }}
            />
            <YAxis
              stroke={OPT_COLORS.axis} tickLine={false}
              tickFormatter={(v: number) => `${v.toFixed(0)}%`} width={42}
              domain={["auto", "auto"]} style={{ fontSize: "10px" }}
            />
            <Tooltip
              contentStyle={ttStyle}
              formatter={(v: number, name) => [`${v.toFixed(1)}%`, fmtExpiry(String(name))]}
              labelFormatter={(k) => `Strike ${fmtPrice(k as number, 0)}`}
              cursor={{ stroke: OPT_COLORS.gridStrong }}
            />
            <ReferenceLine
              x={data.spot}
              stroke={OPT_COLORS.spot}
              strokeDasharray="4 3"
              label={{ value: `Spot $${fmtPrice(data.spot, 0)}`, position: "top", fill: OPT_COLORS.spot, fontSize: 9 }}
            />
            {series.map((expiry, i) => (
              <Line
                key={expiry}
                type="monotone"
                dataKey={expiry}
                name={expiry}
                stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                strokeWidth={2}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap gap-3 mt-1.5 px-1">
        {series.map((expiry, i) => (
          <span key={expiry} className="flex items-center gap-1.5 text-[9px] text-muted-foreground/60 font-mono">
            <span className="inline-block w-3 h-0.5" style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} />
            {fmtExpiry(expiry)}
          </span>
        ))}
      </div>
    </div>
  );
}
