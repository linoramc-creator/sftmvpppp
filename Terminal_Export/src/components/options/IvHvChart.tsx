import React from "react";
import {
  Area, AreaChart, CartesianGrid, Line, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { IVHVResponse } from "@/types/options";
import { OPT_COLORS, ttStyle, fmtPctFrac } from "./theme";
import { Legend } from "./IvSkewChart";

const fmtDate = (s: string) => {
  const d = new Date(s + "T00:00:00Z");
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString("es-ES", { month: "short", year: "2-digit" });
};

export function IvHvChart({ data }: { data: IVHVResponse }) {
  const rows = data.series
    .filter((p) => p.hv != null)
    .map((p) => ({ date: p.date, hv: p.hv != null ? p.hv * 100 : null }));

  const iv30 = data.currentIV30 != null ? data.currentIV30 * 100 : null;
  const vp = data.variancePremium;

  return (
    <div>
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div className="text-[9px] text-muted-foreground/40">
          Volatilidad realizada (HV, ventana {data.window}d) vs. IV30 implícita actual
        </div>
        <div className="flex gap-3 text-[10px] font-mono">
          <span className="text-muted-foreground/60">IV30 <span className="text-primary">{fmtPctFrac(data.currentIV30)}</span></span>
          <span className="text-muted-foreground/60">HV <span style={{ color: OPT_COLORS.hv }}>{fmtPctFrac(data.currentHV)}</span></span>
          <span className="text-muted-foreground/60">
            VRP <span className={vp != null && vp >= 0 ? "text-primary" : "text-destructive"}>
              {vp != null ? `${vp >= 0 ? "+" : ""}${(vp * 100).toFixed(1)}pp` : "—"}
            </span>
          </span>
        </div>
      </div>

      <div style={{ width: "100%", height: 340, backgroundColor: OPT_COLORS.bg, border: "1px solid #1e293b", borderRadius: 2, padding: "10px 6px" }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={rows} margin={{ top: 14, right: 12, left: 0, bottom: 4 }}>
            <defs>
              <linearGradient id="hvGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={OPT_COLORS.hv} stopOpacity={0.25} />
                <stop offset="100%" stopColor={OPT_COLORS.hv} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={OPT_COLORS.grid} />
            <XAxis dataKey="date" stroke={OPT_COLORS.axis} tickLine={false} tickFormatter={fmtDate} minTickGap={40} style={{ fontSize: "10px" }} />
            <YAxis stroke={OPT_COLORS.axis} tickLine={false} tickFormatter={(v) => `${v.toFixed(0)}%`} width={42} style={{ fontSize: "10px" }} />
            <Tooltip
              contentStyle={ttStyle}
              formatter={(v: number) => [`${v.toFixed(1)}%`, "HV"]}
              labelFormatter={(s) => fmtDate(s as string)}
              cursor={{ stroke: OPT_COLORS.gridStrong }}
            />
            {iv30 != null && (
              <ReferenceLine
                y={iv30}
                stroke={OPT_COLORS.iv}
                strokeDasharray="5 3"
                label={{ value: `IV30 ${iv30.toFixed(0)}%`, position: "insideTopLeft", fill: OPT_COLORS.iv, fontSize: 9 }}
              />
            )}
            <Area type="monotone" dataKey="hv" stroke={OPT_COLORS.hv} strokeWidth={2} fill="url(#hvGrad)" dot={false} connectNulls isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <Legend items={[["HV realizada", OPT_COLORS.hv], ["IV30 implícita", OPT_COLORS.iv]]} />

      {data.ivRank == null && (
        <div className="text-[9px] text-muted-foreground/30 mt-2 text-center">
          IV Rank / IV Percentile requieren histórico de IV (snapshots diarios) — pendiente. Ver README del servicio.
        </div>
      )}
    </div>
  );
}
