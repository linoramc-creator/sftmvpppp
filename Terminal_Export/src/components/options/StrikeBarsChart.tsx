import { useMemo,useState } from "react";
import {
  Bar, BarChart, CartesianGrid, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { ChainResponse } from "@/types/options";
import { OPT_COLORS, ttStyle, fmtCompactNum, fmtNum, fmtPrice } from "./theme";
import {strikeMetricRows,type StrikeMetric} from '@/lib/option-chart-data';

const LABELS: Record<StrikeMetric, { title: string; tooltip: [string, string] }> = {
  volume:       { title: "Volumen por strike",          tooltip: ["Volumen calls", "Volumen puts"] },
  openInterest: { title: "Interés abierto por strike",  tooltip: ["OI calls", "OI puts"] },
};

// Side-by-side real contract counts. The local window never requeries the chain.
export function StrikeBarsChart({ data, metric }: { data: ChainResponse; metric: StrikeMetric }) {
  const[width,setWidth]=useState(.25);
  const rows=useMemo(()=>strikeMetricRows(data.calls??[],data.puts??[],data.spot,metric,width),[data,metric,width]);

  const { tooltip } = LABELS[metric];
  const controls=<div className="mb-3 flex flex-wrap items-center justify-between gap-2"><span className="text-[10px] text-slate-400">{data.expiry} · Contratos</span><div role="group" aria-label="Distancia de strikes al precio" className="flex gap-1">{[.1,.25,.5].map(value=><button key={value} aria-pressed={width===value} onClick={()=>setWidth(value)} className={`rounded-md border px-2.5 py-1.5 text-[10px] outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70 ${width===value?'border-blue-400/30 bg-blue-400/10 text-blue-300':'border-slate-700/50 text-slate-400'}`}>±{value*100}%</button>)}</div></div>;

  if (rows.length === 0) {
    return (<div>{controls}
      <div className="py-12 text-center text-[11px] text-muted-foreground/50 border border-border bg-card">
        Sin datos de {metric === "volume" ? "volumen" : "interés abierto"} para este vencimiento.
        Prueba con otro vencimiento o con un ticker más líquido.
      </div></div>
    );
  }

  return (<div>{controls}
    <div style={{ width: "100%", height: 300, backgroundColor: OPT_COLORS.bg, border: "1px solid #1e293b", borderRadius: 12, padding: "12px 8px" }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 14, right: 12, left: 4, bottom: 4 }} barGap={0} barCategoryGap="20%">
          <CartesianGrid strokeDasharray="2 5" vertical={false} stroke={OPT_COLORS.grid} />
          <XAxis dataKey="strike" type="number" domain={['dataMin','dataMax']} stroke={OPT_COLORS.axis} tickLine={false} tickFormatter={(v: number) => fmtPrice(v, Math.abs(v)<10?2:1)} minTickGap={24} style={{ fontSize: "10px" }} />
          <YAxis stroke={OPT_COLORS.axis} tickLine={false} tickFormatter={(v: number) => fmtCompactNum(v)} width={48} style={{ fontSize: "10px" }} />
          <Tooltip
            contentStyle={ttStyle}
            formatter={(v: number, name) => [fmtNum(v), name === "calls" ? tooltip[0] : tooltip[1]]}
            labelFormatter={(k) => `Strike ${fmtPrice(k as number, 2)}`}
            cursor={false}
          />
          {data.spot>0 && (
            <ReferenceLine
              x={data.spot}
              stroke={OPT_COLORS.spot}
              strokeDasharray="4 3"
              label={{ value: `Spot $${fmtPrice(data.spot, 2)}`, position: "top", fill: OPT_COLORS.spot, fontSize: 9 }}
            />
          )}
          <Bar maxBarSize={24} dataKey="calls" fill={OPT_COLORS.call} isAnimationActive={false} />
          <Bar maxBarSize={24} dataKey="puts" fill={OPT_COLORS.put} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div></div>
  );
}
