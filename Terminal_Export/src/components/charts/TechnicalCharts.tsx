import { useEffect, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import {
  Bar, CartesianGrid, Cell, ComposedChart, Line, LineChart,
  ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { TechnicalsResponse } from "@/types/technicals";
import { OPT_COLORS, ttStyle, fmtPrice } from "@/components/options/theme";

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
const TECH_URL = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/analyze-ticker` : "";

async function fetchTechnicals(ticker: string, signal?: AbortSignal): Promise<TechnicalsResponse | null> {
  if (!TECH_URL) return null;
  const resp = await fetch(TECH_URL, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(ANON_KEY ? { Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY } : {}),
    },
    body: JSON.stringify({ technicals: true, ticker }),
  });
  if (!resp.ok) {
    let detail = `Error ${resp.status}`;
    try { const j = await resp.json(); detail = j.error || detail; } catch { /* keep */ }
    throw new Error(detail);
  }
  return (await resp.json()) as TechnicalsResponse;
}

const fmtDate = (s: string) => {
  const d = new Date(s + "T00:00:00Z");
  return Number.isNaN(d.getTime())
    ? s
    : d.toLocaleDateString("es-ES", { month: "short", year: "2-digit", timeZone: "UTC" });
};

const box = (height: number) => ({
  width: "100%", height,
  backgroundColor: OPT_COLORS.bg, border: "1px solid #1e293b",
  borderRadius: 2, padding: "8px 6px",
}) as const;

function Chip({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "pos" | "neg" | "neutral" }) {
  const color = tone === "pos" ? "text-primary" : tone === "neg" ? "text-destructive" : "text-foreground/90";
  return (
    <span className="text-[10px] font-mono text-muted-foreground/60">
      {label} <span className={color}>{value}</span>
    </span>
  );
}

// ── Price + moving averages ─────────────────────────────────────────────

function PriceSmaChart({ data }: { data: TechnicalsResponse }) {
  const rows = data.series;
  return (
    <div style={box(280)}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={OPT_COLORS.grid} />
          <XAxis dataKey="date" stroke={OPT_COLORS.axis} tickLine={false} tickFormatter={fmtDate} minTickGap={48} style={{ fontSize: "10px" }} />
          <YAxis stroke={OPT_COLORS.axis} tickLine={false} tickFormatter={(v: number) => fmtPrice(v, 0)} width={48} domain={["auto", "auto"]} style={{ fontSize: "10px" }} />
          <Tooltip
            contentStyle={ttStyle}
            formatter={(v: number, name) => [
              `$${fmtPrice(v)}`,
              name === "close" ? "Cierre" : name === "sma50" ? "SMA 50" : "SMA 200",
            ]}
            labelFormatter={(s) => fmtDate(s as string)}
            cursor={{ stroke: OPT_COLORS.gridStrong }}
          />
          <Line type="monotone" dataKey="close" stroke={OPT_COLORS.spot} strokeWidth={1.8} dot={false} connectNulls isAnimationActive={false} />
          <Line type="monotone" dataKey="sma50" stroke={OPT_COLORS.term} strokeWidth={1.4} dot={false} connectNulls isAnimationActive={false} />
          <Line type="monotone" dataKey="sma200" stroke={OPT_COLORS.flip} strokeWidth={1.4} dot={false} connectNulls isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── RSI(14) with 30/70 bands ────────────────────────────────────────────

function RsiChart({ data }: { data: TechnicalsResponse }) {
  return (
    <div style={box(180)}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data.series} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={OPT_COLORS.grid} />
          <XAxis dataKey="date" stroke={OPT_COLORS.axis} tickLine={false} tickFormatter={fmtDate} minTickGap={48} style={{ fontSize: "10px" }} />
          <YAxis stroke={OPT_COLORS.axis} tickLine={false} domain={[0, 100]} ticks={[0, 30, 50, 70, 100]} width={34} style={{ fontSize: "10px" }} />
          <Tooltip
            contentStyle={ttStyle}
            formatter={(v: number) => [v.toFixed(1), "RSI 14"]}
            labelFormatter={(s) => fmtDate(s as string)}
            cursor={{ stroke: OPT_COLORS.gridStrong }}
          />
          <ReferenceLine y={70} stroke={OPT_COLORS.put} strokeDasharray="4 3" label={{ value: "70", position: "insideRight", fill: OPT_COLORS.put, fontSize: 9 }} />
          <ReferenceLine y={30} stroke={OPT_COLORS.call} strokeDasharray="4 3" label={{ value: "30", position: "insideRight", fill: OPT_COLORS.call, fontSize: 9 }} />
          <Line type="monotone" dataKey="rsi" stroke={OPT_COLORS.smile} strokeWidth={1.6} dot={false} connectNulls isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── MACD (histogram + lines) ────────────────────────────────────────────

function MacdChart({ data }: { data: TechnicalsResponse }) {
  const rows = data.series;
  return (
    <div style={box(180)}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={OPT_COLORS.grid} />
          <XAxis dataKey="date" stroke={OPT_COLORS.axis} tickLine={false} tickFormatter={fmtDate} minTickGap={48} style={{ fontSize: "10px" }} />
          <YAxis stroke={OPT_COLORS.axis} tickLine={false} tickFormatter={(v: number) => v.toFixed(1)} width={42} style={{ fontSize: "10px" }} />
          <Tooltip
            contentStyle={ttStyle}
            formatter={(v: number, name) => [
              v.toFixed(3),
              name === "macd" ? "MACD" : name === "macdSignal" ? "Señal" : "Histograma",
            ]}
            labelFormatter={(s) => fmtDate(s as string)}
            cursor={{ stroke: OPT_COLORS.gridStrong }}
          />
          <ReferenceLine y={0} stroke={OPT_COLORS.gridStrong} />
          <Bar dataKey="macdHist" isAnimationActive={false}>
            {rows.map((r, i) => (
              <Cell key={i} fill={(r.macdHist ?? 0) >= 0 ? OPT_COLORS.call : OPT_COLORS.put} fillOpacity={0.55} />
            ))}
          </Bar>
          <Line type="monotone" dataKey="macd" stroke={OPT_COLORS.term} strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
          <Line type="monotone" dataKey="macdSignal" stroke={OPT_COLORS.flip} strokeWidth={1.2} dot={false} connectNulls isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function MiniLegend({ items }: { items: [string, string][] }) {
  return (
    <div className="flex flex-wrap gap-3 mt-1 px-1">
      {items.map(([label, color]) => (
        <span key={label} className="flex items-center gap-1.5 text-[9px] text-muted-foreground/60 font-mono">
          <span className="inline-block w-3 h-0.5" style={{ background: color }} />
          {label}
        </span>
      ))}
    </div>
  );
}

// ── Container: deterministic charts rendered above the AI narrative ─────

export function TechnicalSubSection({ ticker }: { ticker: string }) {
  const [data, setData]       = useState<TechnicalsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");

  useEffect(() => {
    if (!ticker || !TECH_URL) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setData(null);
    fetchTechnicals(ticker, controller.signal)
      .then((d) => { if (!controller.signal.aborted) setData(d); })
      .catch((e) => {
        if (controller.signal.aborted || (e instanceof Error && e.name === "AbortError")) return;
        setError(e instanceof Error ? e.message : "No se pudieron calcular los indicadores técnicos.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [ticker]);

  if (!TECH_URL) return null;

  if (loading) {
    return (
      <div className="flex items-center gap-3 py-6 text-muted-foreground text-[11px] tracking-widest">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        CALCULANDO INDICADORES TÉCNICOS...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mb-4 p-3 border border-destructive/40 bg-destructive/5 flex items-start gap-2">
        <AlertCircle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
        <p className="text-xs text-destructive font-mono">{error || "Sin datos técnicos."}</p>
      </div>
    );
  }

  const { current } = data;
  const rsiTone = current.rsi == null ? "neutral" : current.rsi >= 70 ? "neg" : current.rsi <= 30 ? "pos" : "neutral";
  const trendUp = current.close != null && current.sma200 != null && current.close > current.sma200;
  const macdUp = current.macd != null && current.macdSignal != null && current.macd > current.macdSignal;

  return (
    <div className="mb-5 space-y-4">
      <div className="flex gap-4 flex-wrap">
        <Chip label="Precio vs SMA200" value={current.sma200 != null ? (trendUp ? "ALCISTA" : "BAJISTA") : "—"} tone={current.sma200 == null ? "neutral" : trendUp ? "pos" : "neg"} />
        <Chip label="RSI 14" value={current.rsi != null ? current.rsi.toFixed(1) : "—"} tone={rsiTone} />
        <Chip label="MACD" value={current.macd != null && current.macdSignal != null ? (macdUp ? "SOBRE SEÑAL" : "BAJO SEÑAL") : "—"} tone={current.macd == null ? "neutral" : macdUp ? "pos" : "neg"} />
      </div>

      <div>
        <div className="text-[9px] text-muted-foreground/40 mb-1">Precio (1 año) con medias móviles de 50 y 200 sesiones — cálculo determinista, no IA</div>
        <PriceSmaChart data={data} />
        <MiniLegend items={[["Cierre", OPT_COLORS.spot], ["SMA 50", OPT_COLORS.term], ["SMA 200", OPT_COLORS.flip]]} />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div>
          <div className="text-[9px] text-muted-foreground/40 mb-1">RSI 14 · &gt;70 sobrecompra, &lt;30 sobreventa</div>
          <RsiChart data={data} />
        </div>
        <div>
          <div className="text-[9px] text-muted-foreground/40 mb-1">MACD (12, 26, 9) · histograma = MACD − señal</div>
          <MacdChart data={data} />
          <MiniLegend items={[["MACD", OPT_COLORS.term], ["Señal", OPT_COLORS.flip]]} />
        </div>
      </div>
    </div>
  );
}
