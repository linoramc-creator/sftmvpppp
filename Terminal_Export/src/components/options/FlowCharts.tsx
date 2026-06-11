import React, { useMemo } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { AggregationsResponse } from "@/types/options";
import {
  OPT_COLORS, ttStyle, fmtCompactNum, fmtCompactUsd, fmtPctFrac, fmtPrice, fmtNum,
} from "./theme";

// ── Open-interest profile (puts mirrored below zero) + spot / max-pain refs ──
function OiProfile({ data }: { data: AggregationsResponse }) {
  const rows = useMemo(
    () => [...(data.perStrike ?? [])].sort((a, b) => a.strike - b.strike).map((r) => ({
      strike: r.strike,
      callOI: r.callOI,
      putOI: -r.putOI, // mirror below the axis
    })),
    [data.perStrike],
  );

  return (
    <div style={{ width: "100%", height: 320, backgroundColor: OPT_COLORS.bg, border: "1px solid #1e293b", borderRadius: 2, padding: "8px 6px" }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 12, left: 4, bottom: 4 }} stackOffset="sign">
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={OPT_COLORS.grid} />
          <XAxis dataKey="strike" type="number" domain={["dataMin", "dataMax"]} stroke={OPT_COLORS.axis} tickLine={false} tickFormatter={(v) => fmtPrice(v, 0)} style={{ fontSize: "10px" }} />
          <YAxis stroke={OPT_COLORS.axis} tickLine={false} tickFormatter={(v) => fmtCompactNum(Math.abs(v))} width={48} style={{ fontSize: "10px" }} />
          <Tooltip
            contentStyle={ttStyle}
            formatter={(v: number, name) => [fmtNum(Math.abs(v)), name === "callOI" ? "Call OI" : "Put OI"]}
            labelFormatter={(k) => `Strike ${fmtPrice(k as number, 0)}`}
            cursor={{ fill: "rgba(148,163,184,0.06)" }}
          />
          <ReferenceLine y={0} stroke={OPT_COLORS.gridStrong} />
          <ReferenceLine x={data.spot} stroke={OPT_COLORS.spot} strokeDasharray="4 3" label={{ value: "Spot", position: "top", fill: OPT_COLORS.spot, fontSize: 9 }} />
          {data.maxPain != null && (
            <ReferenceLine x={data.maxPain} stroke={OPT_COLORS.maxPain} strokeDasharray="2 2" label={{ value: "Max pain", position: "bottom", fill: OPT_COLORS.maxPain, fontSize: 9 }} />
          )}
          <Bar dataKey="callOI" stackId="oi" fill={OPT_COLORS.call} isAnimationActive={false} />
          <Bar dataKey="putOI" stackId="oi" fill={OPT_COLORS.put} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" | "neutral" }) {
  const color = tone === "pos" ? "text-primary" : tone === "neg" ? "text-destructive" : "text-foreground/90";
  return (
    <div className="border border-border bg-card px-3 py-2">
      <div className="text-[9px] tracking-widest text-muted-foreground/50 uppercase">{label}</div>
      <div className={`text-sm font-mono mt-0.5 ${color}`}>{value}</div>
    </div>
  );
}

export function FlowCharts({ data }: { data: AggregationsResponse }) {
  const emLow = data.expectedMoveAbs != null ? data.spot - data.expectedMoveAbs : null;
  const emHigh = data.expectedMoveAbs != null ? data.spot + data.expectedMoveAbs : null;
  const pcr = data.putCallRatioOI;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
        <Stat label="Spot" value={`$${fmtPrice(data.spot)}`} tone="neutral" />
        <Stat label="Max Pain" value={data.maxPain != null ? `$${fmtPrice(data.maxPain, 0)}` : "—"} tone="neutral" />
        <Stat label="γ-Flip" value={data.gammaFlip != null ? `$${fmtPrice(data.gammaFlip, 0)}` : "—"} tone="neutral" />
        <Stat label="ATM IV" value={fmtPctFrac(data.atmIV)} tone="neutral" />
        <Stat label="P/C Ratio (OI)" value={pcr != null ? pcr.toFixed(2) : "—"} tone={pcr != null && pcr > 1 ? "neg" : "pos"} />
        <Stat label="P/C Ratio (Vol)" value={data.putCallRatioVol != null ? data.putCallRatioVol.toFixed(2) : "—"} tone="neutral" />
        <Stat label="Mov. esperado ±1σ" value={data.expectedMovePct != null ? `±${(data.expectedMovePct * 100).toFixed(1)}%` : "—"} tone="neutral" />
        <Stat
          label="Rango ±1σ"
          value={emLow != null && emHigh != null ? `${fmtPrice(emLow, 0)} – ${fmtPrice(emHigh, 0)}` : "—"}
          tone="neutral"
        />
        <Stat label="Total GEX" value={fmtCompactUsd(data.totalGex)} tone={data.totalGex >= 0 ? "pos" : "neg"} />
        <Stat label="Total DEX" value={fmtCompactUsd(data.totalDex)} tone={data.totalDex >= 0 ? "pos" : "neg"} />
        <Stat label="Total VEX" value={fmtCompactUsd(data.totalVex)} tone={data.totalVex >= 0 ? "pos" : "neg"} />
        <Stat label="Straddle ATM" value={data.expectedMoveStraddle != null ? `$${fmtPrice(data.expectedMoveStraddle)}` : "—"} tone="neutral" />
      </div>

      <div>
        <div className="text-[9px] text-muted-foreground/40 mb-1">
          Perfil de interés abierto · calls (verde, arriba) vs puts (rojo, abajo) — muros = soportes/resistencias
        </div>
        <OiProfile data={data} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <WallList title="Resistencias (Call OI)" walls={data.callWalls} color={OPT_COLORS.call} />
        <WallList title="Soportes (Put OI)" walls={data.putWalls} color={OPT_COLORS.put} />
      </div>
    </div>
  );
}

function WallList({ title, walls, color }: { title: string; walls?: { strike: number; openInterest: number }[]; color: string }) {
  const list = walls ?? [];
  return (
    <div className="border border-border bg-card">
      <div className="px-3 py-2 text-[9px] tracking-widest uppercase border-b border-border/50" style={{ color }}>{title}</div>
      <div className="divide-y divide-border/30">
        {list.length === 0 && <div className="px-3 py-2 text-[10px] text-muted-foreground/40">—</div>}
        {list.map((w) => (
          <div key={w.strike} className="flex items-center justify-between px-3 py-1.5 text-[11px] font-mono">
            <span className="text-foreground/80">${fmtPrice(w.strike, 0)}</span>
            <span className="text-muted-foreground/70">{fmtNum(w.openInterest)} OI</span>
          </div>
        ))}
      </div>
    </div>
  );
}
