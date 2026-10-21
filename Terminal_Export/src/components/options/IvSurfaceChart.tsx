import React, { useMemo } from "react";
import {
  CartesianGrid, Cell, ReferenceLine, ResponsiveContainer,
  Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from "recharts";
import type { SurfaceResponse } from "@/types/options";
import { OPT_COLORS, ttStyle, fmtPctFrac, fmtPrice, ivHeatColor } from "./theme";
import {chartDateLabel} from '@/lib/financial-chart-data';

// A true 3D mesh needs three.js; here the IV surface is projected to 2D with
// IV encoded as color (height), which reads cleanly in the terminal grid.
export function IvSurfaceChart({ data }: { data: SurfaceResponse }) {
  const { points, lo, hi } = useMemo(() => {
    const pts = (data.points ?? []).filter(p=>Number.isFinite(p.iv)&&Number.isFinite(p.moneyness)&&Number.isFinite(p.daysToExpiry)).map((p) => ({
      expiry:p.expiry,
      dte: p.daysToExpiry,
      moneyness: p.moneyness,
      iv: p.iv,
      ivPct: p.iv * 100,
      strike: p.strike,
      type: p.type,
    }));
    const ivs = pts.map((p) => p.iv);
    return { points: pts, lo: ivs.length ? Math.min(...ivs) : 0, hi: ivs.length ? Math.max(...ivs) : 1 };
  }, [data.points]);

  if (points.length === 0) {
    return (
      <div className="py-16 text-center text-[11px] text-muted-foreground/50 border border-border bg-card">
        Sin datos suficientes para la superficie de volatilidad
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <div className="text-[9px] text-muted-foreground/70">
          Superficie IV · eje X días a vencimiento, eje Y moneyness (K/S), color = IV
        </div>
        <HeatLegend lo={lo} hi={hi} />
      </div>
      <div style={{ width: "100%", height: 380, backgroundColor: OPT_COLORS.bg, border: "1px solid #1e293b", borderRadius: 12, padding: "12px 8px" }}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 14, right: 16, left: 4, bottom: 8 }}>
            <CartesianGrid strokeDasharray="2 5" stroke={OPT_COLORS.grid} />
            <XAxis
              type="number" dataKey="dte" name="DTE"
              stroke={OPT_COLORS.axis} tickLine={false}
              tickFormatter={(v) => `${v}d`} style={{ fontSize: "10px" }}
            />
            <YAxis
              type="number" dataKey="moneyness" name="Moneyness"
              domain={["dataMin", "dataMax"]} stroke={OPT_COLORS.axis} tickLine={false}
              tickFormatter={(v) => v.toFixed(2)} width={42} style={{ fontSize: "10px" }}
            />
            <ZAxis type="number" dataKey="ivPct" range={[36, 36]} />
            <Tooltip
              contentStyle={ttStyle}
              content={({active,payload})=>{const point=payload?.[0]?.payload as typeof points[number]|undefined;return active&&point?<div style={ttStyle}><p className="mb-2 font-medium text-slate-200">{chartDateLabel(point.expiry,true)} · {point.type==='call'?'Call':'Put'}</p><div className="space-y-1 text-slate-400"><p>Strike <b className="ml-2 font-medium text-slate-100">{fmtPrice(point.strike)}</b></p><p>Volatilidad implícita <b className="ml-2 font-medium text-blue-300">{fmtPctFrac(point.iv)}</b></p><p>Vencimiento <b className="ml-2 font-medium text-slate-100">{point.dte} días</b></p><p>K/S <b className="ml-2 font-medium text-slate-100">{point.moneyness.toFixed(3)}</b></p></div></div>:null;}}
              cursor={{ strokeDasharray: "3 3", stroke: OPT_COLORS.gridStrong }}
              formatter={(v: number, name) => {
                if (name === "Moneyness") return [v.toFixed(3), "K/S"];
                if (name === "DTE") return [`${v}d`, "Días"];
                return [v, name];
              }}
            />
            <ReferenceLine y={1} stroke={OPT_COLORS.spot} strokeDasharray="4 3"
              label={{ value: "ATM", position: "insideRight", fill: OPT_COLORS.spot, fontSize: 9 }} />
            <Scatter data={points} isAnimationActive={false}>
              {points.map((p, i) => (
                <Cell key={i} fill={ivHeatColor(p.iv, lo, hi)} fillOpacity={0.85} />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function HeatLegend({ lo, hi }: { lo: number; hi: number }) {
  const stops = [0, 0.25, 0.5, 0.75, 1];
  return (
    <div className="flex items-center gap-2">
      <span className="text-[9px] text-muted-foreground/60 font-mono">{fmtPctFrac(lo, 0)}</span>
      <div className="flex h-2 w-24 rounded overflow-hidden">
        {stops.map((t) => (
          <span key={t} className="flex-1" style={{ background: ivHeatColor(lo + (hi - lo) * t, lo, hi) }} />
        ))}
      </div>
      <span className="text-[9px] text-muted-foreground/60 font-mono">{fmtPctFrac(hi, 0)}</span>
    </div>
  );
}
