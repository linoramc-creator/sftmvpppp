import React from "react";
import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { TermStructureResponse } from "@/types/options";
import { OPT_COLORS, ttStyle } from "./theme";
import { Legend } from "./IvSkewChart";
import {chartDateLabel} from '@/lib/financial-chart-data';

export function TermStructureChart({ data }: { data: TermStructureResponse }) {
  const rows = [...(data.points ?? [])]
    .sort((a, b) => a.daysToExpiry - b.daysToExpiry)
    .map((p) => ({
      expiry:p.expiry,
      label: `${p.daysToExpiry}d`,
      dte: p.daysToExpiry,
      atmIV: p.atmIV != null ? p.atmIV * 100 : null,
      em: p.expectedMovePct != null ? p.expectedMovePct * 100 : null,
    }));

  return (
    <div>
      <div className="text-[9px] text-muted-foreground/70 mb-1">
        Estructura temporal · IV ATM por vencimiento (contango vs backwardation)
      </div>
      <div style={{ width: "100%", height: 340, backgroundColor: OPT_COLORS.bg, border: "1px solid #1e293b", borderRadius: 12, padding: "12px 8px" }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 14, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="2 5" vertical={false} stroke={OPT_COLORS.grid} />
            <XAxis dataKey="dte" type="number" domain={['dataMin','dataMax']} tickFormatter={v=>`${v}d`} stroke={OPT_COLORS.axis} tickLine={false} style={{ fontSize: "10px" }} />
            <YAxis
              stroke={OPT_COLORS.axis}
              tickLine={false}
              tickFormatter={(v) => `${v.toFixed(0)}%`}
              width={42}
              style={{ fontSize: "10px" }}
            />
            <Tooltip
              contentStyle={ttStyle}
              formatter={(v: number, name) => [v == null ? "—" : `${v.toFixed(1)}%`, name === "atmIV" ? "IV ATM" : "Mov. esperado ±1σ"]}
              labelFormatter={(value,payload)=>{const row=payload?.[0]?.payload;return row?`${chartDateLabel(row.expiry,true)} · ${row.dte} días`:`${value} días`;}}
              cursor={{stroke:"#7dd3fc",strokeOpacity:.45,strokeWidth:.8,strokeDasharray:"3 4"}}
            />
            <Line type="linear" dataKey="atmIV" name="atmIV" stroke={OPT_COLORS.term} strokeWidth={2.5} dot={{ r: 3, fill: OPT_COLORS.term, strokeWidth: 0 }} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />
            <Line type="linear" dataKey="em" name="em" stroke={OPT_COLORS.smile} strokeWidth={1.5} strokeDasharray="2 5" dot={false} connectNulls={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <Legend items={[["IV ATM", OPT_COLORS.term], ["Mov. esperado ±1σ", OPT_COLORS.smile]]} />
    </div>
  );
}
