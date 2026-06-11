import { useMemo } from "react";
import {
  Bar, BarChart, CartesianGrid, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { ChainResponse, OptionContract } from "@/types/options";
import { OPT_COLORS, ttStyle, fmtCompactNum, fmtNum, fmtPrice } from "./theme";

type StrikeMetric = "volume" | "openInterest";

interface StrikeRow {
  strike: number;
  calls: number;
  puts: number;
}

const LABELS: Record<StrikeMetric, { title: string; tooltip: [string, string] }> = {
  volume:       { title: "Volumen por strike",          tooltip: ["Volumen calls", "Volumen puts"] },
  openInterest: { title: "Interés abierto por strike",  tooltip: ["OI calls", "OI puts"] },
};

// Side-by-side bars per strike (calls green / puts red), Moomoo-style.
// Strikes are windowed to ±25% around spot so the chart stays readable.
export function StrikeBarsChart({ data, metric }: { data: ChainResponse; metric: StrikeMetric }) {
  const { rows, atmStrike } = useMemo(() => {
    const byStrike = new Map<number, StrikeRow>();
    const pick = (c: OptionContract) => (metric === "volume" ? c.volume : c.openInterest) ?? 0;
    const add = (contracts: OptionContract[], side: "calls" | "puts") => {
      for (const c of contracts) {
        if (c.strike == null) continue;
        const m = c.strike / data.spot;
        if (m < 0.75 || m > 1.25) continue;
        const row = byStrike.get(c.strike) ?? { strike: c.strike, calls: 0, puts: 0 };
        row[side] += pick(c);
        byStrike.set(c.strike, row);
      }
    };
    add(data.calls ?? [], "calls");
    add(data.puts ?? [], "puts");

    const all = [...byStrike.values()]
      .filter((r) => r.calls > 0 || r.puts > 0)
      .sort((a, b) => a.strike - b.strike);

    let atm = all[0]?.strike ?? null;
    let best = Infinity;
    for (const r of all) {
      const d = Math.abs(r.strike - data.spot);
      if (d < best) { best = d; atm = r.strike; }
    }
    return { rows: all, atmStrike: atm };
  }, [data, metric]);

  const { tooltip } = LABELS[metric];

  if (rows.length === 0) {
    return (
      <div className="py-12 text-center text-[11px] text-muted-foreground/50 border border-border bg-card">
        Sin datos de {metric === "volume" ? "volumen" : "interés abierto"} para este vencimiento.
        Prueba con otro vencimiento o con un ticker más líquido.
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: 300, backgroundColor: OPT_COLORS.bg, border: "1px solid #1e293b", borderRadius: 2, padding: "8px 6px" }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 14, right: 12, left: 4, bottom: 4 }} barGap={0} barCategoryGap="20%">
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={OPT_COLORS.grid} />
          <XAxis dataKey="strike" stroke={OPT_COLORS.axis} tickLine={false} tickFormatter={(v: number) => fmtPrice(v, 0)} minTickGap={24} style={{ fontSize: "10px" }} />
          <YAxis stroke={OPT_COLORS.axis} tickLine={false} tickFormatter={(v: number) => fmtCompactNum(v)} width={48} style={{ fontSize: "10px" }} />
          <Tooltip
            contentStyle={ttStyle}
            formatter={(v: number, name) => [fmtNum(v), name === "calls" ? tooltip[0] : tooltip[1]]}
            labelFormatter={(k) => `Strike ${fmtPrice(k as number, 0)}`}
            cursor={{ fill: "rgba(148,163,184,0.06)" }}
          />
          {atmStrike != null && (
            <ReferenceLine
              x={atmStrike}
              stroke={OPT_COLORS.spot}
              strokeDasharray="4 3"
              label={{ value: `Spot $${fmtPrice(data.spot, 0)}`, position: "top", fill: OPT_COLORS.spot, fontSize: 9 }}
            />
          )}
          <Bar dataKey="calls" fill={OPT_COLORS.call} isAnimationActive={false} />
          <Bar dataKey="puts" fill={OPT_COLORS.put} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
