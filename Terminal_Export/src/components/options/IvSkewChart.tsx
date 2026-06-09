import React from "react";
import {
  CartesianGrid, Line, LineChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { SkewResponse } from "@/types/options";
import { OPT_COLORS, ttStyle, fmtPctFrac, fmtPrice } from "./theme";

export function IvSkewChart({ data }: { data: SkewResponse }) {
  const rows = [...(data.points ?? [])]
    .sort((a, b) => a.strike - b.strike)
    .map((p) => ({
      strike: p.strike,
      callIV: p.callIV != null ? p.callIV * 100 : null,
      putIV: p.putIV != null ? p.putIV * 100 : null,
      smile: p.iv != null ? p.iv * 100 : null,
    }));

  return (
    <div>
      <div className="text-[9px] text-muted-foreground/40 mb-1">
        Volatilidad implícita por strike · {data.expiry} · sonrisa OTM en violeta
      </div>
      <div style={{ width: "100%", height: 340, backgroundColor: OPT_COLORS.bg, border: "1px solid #1e293b", borderRadius: 2, padding: "10px 6px" }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 14, right: 12, left: 0, bottom: 4 }}>
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
              tickFormatter={(v) => `${v.toFixed(0)}%`}
              width={42}
              style={{ fontSize: "10px" }}
            />
            <Tooltip
              contentStyle={ttStyle}
              formatter={(v: number, name) => [v == null ? "—" : `${v.toFixed(1)}%`, name]}
              labelFormatter={(k) => `Strike ${fmtPrice(k as number, 0)}`}
              cursor={{ stroke: OPT_COLORS.gridStrong }}
            />
            <ReferenceLine
              x={data.spot}
              stroke={OPT_COLORS.spot}
              strokeDasharray="4 3"
              label={{ value: "Spot", position: "top", fill: OPT_COLORS.spot, fontSize: 9 }}
            />
            <Line type="monotone" dataKey="smile" name="Smile OTM" stroke={OPT_COLORS.smile} strokeWidth={2.5} dot={false} connectNulls isAnimationActive={false} />
            <Line type="monotone" dataKey="callIV" name="Call IV" stroke={OPT_COLORS.call} strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} strokeOpacity={0.7} />
            <Line type="monotone" dataKey="putIV" name="Put IV" stroke={OPT_COLORS.put} strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} strokeOpacity={0.7} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <Legend items={[["Smile OTM", OPT_COLORS.smile], ["Call IV", OPT_COLORS.call], ["Put IV", OPT_COLORS.put]]} />
    </div>
  );
}

export function Legend({ items }: { items: [string, string][] }) {
  return (
    <div className="flex gap-4 justify-center mt-2 flex-wrap">
      {items.map(([label, color]) => (
        <div key={label} className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: color }} />
          <span className="text-[9px] text-muted-foreground/70 tracking-wide">{label}</span>
        </div>
      ))}
    </div>
  );
}
