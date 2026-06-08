import React, { useMemo, useState } from "react";
import type { ChainResponse, OptionContract } from "@/types/options";
import { fmtGreek, fmtNum, fmtPctFrac, fmtPrice } from "./theme";

const NUM = (v: number | null, dp = 2) => (v == null ? "—" : fmtPrice(v, dp));

// Calls on the left, strike in the centre, puts on the right — the standard
// trading layout. Greeks come pre-computed from the BSM service.
export function ChainTable({ data }: { data: ChainResponse }) {
  const [windowed, setWindowed] = useState(true);

  const { strikes, callMap, putMap, atmStrike } = useMemo(() => {
    const cm = new Map<number, OptionContract>();
    const pm = new Map<number, OptionContract>();
    data.calls.forEach((c) => c.strike != null && cm.set(c.strike, c));
    data.puts.forEach((p) => p.strike != null && pm.set(p.strike, p));
    const all = Array.from(new Set([...cm.keys(), ...pm.keys()])).sort((a, b) => a - b);
    let atm = all[0];
    let best = Infinity;
    for (const k of all) {
      const d = Math.abs(k - data.spot);
      if (d < best) { best = d; atm = k; }
    }
    return { strikes: all, callMap: cm, putMap: pm, atmStrike: atm };
  }, [data]);

  const shown = useMemo(() => {
    if (!windowed) return strikes;
    const idx = strikes.indexOf(atmStrike);
    const lo = Math.max(0, idx - 20);
    const hi = Math.min(strikes.length, idx + 21);
    return strikes.slice(lo, hi);
  }, [windowed, strikes, atmStrike]);

  const callCols = ["OI", "Vol", "IV", "Δ", "Γ", "Θ", "Vega"];
  const putCols = ["Vega", "Θ", "Γ", "Δ", "IV", "Vol", "OI"];

  const callCells = (c?: OptionContract) => [
    fmtNum(c?.openInterest ?? null), fmtNum(c?.volume ?? null), fmtPctFrac(c?.impliedVolatility ?? null),
    fmtGreek(c?.delta ?? null, 3), fmtGreek(c?.gamma ?? null, 4), fmtGreek(c?.theta ?? null, 3), fmtGreek(c?.vega ?? null, 3),
  ];
  const putCells = (p?: OptionContract) => [
    fmtGreek(p?.vega ?? null, 3), fmtGreek(p?.theta ?? null, 3), fmtGreek(p?.gamma ?? null, 4), fmtGreek(p?.delta ?? null, 3),
    fmtPctFrac(p?.impliedVolatility ?? null), fmtNum(p?.volume ?? null), fmtNum(p?.openInterest ?? null),
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[9px] text-muted-foreground/40">
          Cadena de opciones · {data.expiry} · {data.daysToExpiry}d · spot ${fmtPrice(data.spot)} · {strikes.length} strikes
        </div>
        <button
          onClick={() => setWindowed((w) => !w)}
          className="px-2.5 py-1 text-[9px] tracking-widest border border-border text-muted-foreground hover:text-foreground transition-colors"
        >
          {windowed ? "VER TODOS" : "CERCA DEL DINERO"}
        </button>
      </div>

      <div className="overflow-x-auto border border-border" style={{ maxHeight: 540 }}>
        <table className="w-full font-mono min-w-max" style={{ fontSize: "11px" }}>
          <thead className="sticky top-0 z-10 bg-secondary">
            <tr className="border-b border-border">
              <th colSpan={callCols.length} className="px-2 py-1.5 text-center text-[10px] tracking-widest" style={{ color: "#22c55e" }}>CALLS</th>
              <th className="px-2 py-1.5 text-center text-[10px] tracking-widest text-muted-foreground/70 border-x border-border">STRIKE</th>
              <th colSpan={putCols.length} className="px-2 py-1.5 text-center text-[10px] tracking-widest" style={{ color: "#f87171" }}>PUTS</th>
            </tr>
            <tr className="border-b border-border bg-secondary/60">
              {callCols.map((c) => <th key={`c-${c}`} className="px-2 py-1 text-right text-[9px] text-muted-foreground/50 font-normal">{c}</th>)}
              <th className="px-2 py-1 text-center text-[9px] text-muted-foreground/60 border-x border-border">$</th>
              {putCols.map((c) => <th key={`p-${c}`} className="px-2 py-1 text-right text-[9px] text-muted-foreground/50 font-normal">{c}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/20">
            {shown.map((k) => {
              const c = callMap.get(k);
              const p = putMap.get(k);
              const isATM = k === atmStrike;
              const callItm = k < data.spot;
              const putItm = k > data.spot;
              return (
                <tr key={k} className={isATM ? "bg-primary/10" : "hover:bg-primary/[0.03] transition-colors"}>
                  {callCells(c).map((cell, j) => (
                    <td key={`c-${j}`} className={`px-2 py-1 text-right ${callItm ? "text-foreground/85" : "text-muted-foreground/55"}`}>{cell}</td>
                  ))}
                  <td className={`px-2 py-1 text-center font-semibold border-x border-border ${isATM ? "text-primary" : "text-foreground/80"}`}>
                    {fmtPrice(k, 0)}
                  </td>
                  {putCells(p).map((cell, j) => (
                    <td key={`p-${j}`} className={`px-2 py-1 text-right ${putItm ? "text-foreground/85" : "text-muted-foreground/55"}`}>{cell}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="text-[9px] text-muted-foreground/30 mt-1.5">
        ITM resaltado · fila ATM marcada · Δ delta, Γ gamma, Θ theta/día, Vega por punto de IV — todos calculados por BSM
      </div>
    </div>
  );
}
