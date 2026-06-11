import React, { useMemo, useState } from "react";
import {
  Bar, BarChart, Cell, CartesianGrid, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { AggregationsResponse } from "@/types/options";
import { OPT_COLORS, ttStyle, fmtCompactUsd, fmtPrice } from "./theme";

type Metric = "gex" | "dex" | "vex";

const META: Record<Metric, { label: string; help: string }> = {
  gex: { label: "GEX", help: "Gamma Exposure · $ por movimiento del 1% del subyacente" },
  dex: { label: "DEX", help: "Delta Exposure · dólar-delta neto por strike" },
  vex: { label: "VEX", help: "Vega Exposure · $ por punto de volatilidad" },
};

export function GexDexChart({ data }: { data: AggregationsResponse }) {
  const [metric, setMetric] = useState<Metric>("gex");

  const rows = useMemo(
    () => [...(data.perStrike ?? [])].sort((a, b) => a.strike - b.strike).map((r) => ({
      strike: r.strike,
      value: r[metric],
    })),
    [data.perStrike, metric],
  );

  const total =
    metric === "gex" ? data.totalGex : metric === "dex" ? data.totalDex : data.totalVex;

  return (
    <div>
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div className="flex gap-1">
          {(Object.keys(META) as Metric[]).map((m) => (
            <button
              key={m}
              onClick={() => setMetric(m)}
              className={`px-3 py-1 text-[10px] tracking-widest border transition-colors ${
                metric === m
                  ? "border-primary text-primary bg-primary/10"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {META[m].label}
            </button>
          ))}
        </div>
        <div className="text-[10px] text-muted-foreground/60 font-mono">
          Σ {META[metric].label}: <span className={total >= 0 ? "text-primary" : "text-destructive"}>
            {fmtCompactUsd(total)}
          </span>
        </div>
      </div>
      <div className="text-[9px] text-muted-foreground/40 mb-1">{META[metric].help}</div>

      <div style={{ width: "100%", height: 360, backgroundColor: OPT_COLORS.bg, border: "1px solid #1e293b", borderRadius: 2, padding: "8px 6px" }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={OPT_COLORS.grid} />
            <XAxis
              dataKey="strike"
              type="number"
              domain={["dataMin", "dataMax"]}
              stroke={OPT_COLORS.axis}
              tickLine={false}
              tickFormatter={(v) => fmtPrice(v, 0)}
              style={{ fontSize: "10px" }}
            />
            <YAxis
              stroke={OPT_COLORS.axis}
              tickLine={false}
              tickFormatter={(v) => fmtCompactUsd(v)}
              width={62}
              style={{ fontSize: "10px" }}
            />
            <Tooltip
              contentStyle={ttStyle}
              formatter={(v: number) => [fmtCompactUsd(v), META[metric].label]}
              labelFormatter={(k) => `Strike ${fmtPrice(k as number, 0)}`}
              cursor={{ fill: "rgba(148,163,184,0.06)" }}
            />
            <ReferenceLine y={0} stroke={OPT_COLORS.gridStrong} />
            <ReferenceLine
              x={data.spot}
              stroke={OPT_COLORS.spot}
              strokeDasharray="4 3"
              label={{ value: `Spot ${fmtPrice(data.spot, 1)}`, position: "top", fill: OPT_COLORS.spot, fontSize: 9 }}
            />
            {metric === "gex" && data.gammaFlip != null && (
              <ReferenceLine
                x={data.gammaFlip}
                stroke={OPT_COLORS.flip}
                strokeDasharray="2 2"
                label={{ value: `γ-flip ${fmtPrice(data.gammaFlip, 1)}`, position: "insideTopRight", fill: OPT_COLORS.flip, fontSize: 9 }}
              />
            )}
            <Bar dataKey="value" isAnimationActive={false}>
              {rows.map((r, i) => (
                <Cell key={i} fill={r.value >= 0 ? OPT_COLORS.call : OPT_COLORS.put} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
