import { useEffect, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart,
  ReferenceLine, ResponsiveContainer, Scatter, ScatterChart,
  Tooltip, XAxis, YAxis,
} from "recharts";
import { fetchRiskData, isRiskConfigured, RiskApiError } from "@/lib/risk-api";
import type { RiskResponse } from "@/types/risk";
import { OPT_COLORS, ttStyle } from "@/components/options/theme";

const fmtDate = (s: string) => {
  const d = new Date(s + "T00:00:00Z");
  return Number.isNaN(d.getTime())
    ? s
    : d.toLocaleDateString("es-ES", { month: "short", year: "2-digit", timeZone: "UTC" });
};

const chartBox = {
  width: "100%",
  height: 280,
  backgroundColor: OPT_COLORS.bg,
  border: "1px solid #1e293b",
  borderRadius: 2,
  padding: "8px 6px",
} as const;

// ── Shared scaffolding ─────────────────────────────────────────────────

function ChartBlock({
  title, subtitle, howToRead, children,
}: {
  title: string;
  subtitle: string;
  howToRead: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[10px] tracking-widest text-foreground font-semibold mb-1">{title}</div>
      <div className="text-[9px] text-muted-foreground/40 mb-1.5">{subtitle}</div>
      {children}
      <div className="mt-2 px-3 py-2 border border-border/50 bg-card/50">
        <div className="text-[9px] tracking-widest text-primary/60 uppercase mb-1">Cómo leer este indicador</div>
        <p className="text-[11px] text-muted-foreground/70 leading-relaxed" style={{ fontFamily: "var(--font-sans)" }}>
          {howToRead}
        </p>
      </div>
    </div>
  );
}

function EmptyBlock({ text }: { text: string }) {
  return (
    <div className="py-10 text-center text-[11px] text-muted-foreground/50 border border-border bg-card">
      {text}
    </div>
  );
}

function StatChip({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "pos" | "neg" | "neutral" }) {
  const color = tone === "pos" ? "text-primary" : tone === "neg" ? "text-destructive" : "text-foreground/90";
  return (
    <span className="text-[10px] font-mono text-muted-foreground/60">
      {label} <span className={color}>{value}</span>
    </span>
  );
}

// ── 1. Drawdown histórico (underwater) ────────────────────────────────

function DrawdownChart({ data }: { data: NonNullable<RiskResponse["drawdown"]> }) {
  const rows = data.points.map((p) => ({ date: p.date, dd: p.drawdown * 100 }));
  return (
    <div>
      <div className="flex gap-4 mb-1.5 flex-wrap">
        <StatChip label="Drawdown actual" value={`${(data.current * 100).toFixed(1)}%`} tone={data.current < -0.05 ? "neg" : "neutral"} />
        <StatChip label="Máx. drawdown" value={`${(data.maxDrawdown * 100).toFixed(1)}%`} tone="neg" />
      </div>
      <div style={chartBox}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
            <defs>
              <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={OPT_COLORS.put} stopOpacity={0.05} />
                <stop offset="100%" stopColor={OPT_COLORS.put} stopOpacity={0.4} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={OPT_COLORS.grid} />
            <XAxis dataKey="date" stroke={OPT_COLORS.axis} tickLine={false} tickFormatter={fmtDate} minTickGap={48} style={{ fontSize: "10px" }} />
            <YAxis stroke={OPT_COLORS.axis} tickLine={false} tickFormatter={(v: number) => `${v.toFixed(0)}%`} width={42} domain={["auto", 0]} style={{ fontSize: "10px" }} />
            <Tooltip
              contentStyle={ttStyle}
              formatter={(v: number) => [`${v.toFixed(1)}%`, "Drawdown"]}
              labelFormatter={(s) => fmtDate(s as string)}
              cursor={{ stroke: OPT_COLORS.gridStrong }}
            />
            <ReferenceLine y={0} stroke={OPT_COLORS.gridStrong} />
            <Area type="monotone" dataKey="dd" stroke={OPT_COLORS.put} strokeWidth={1.5} fill="url(#ddGrad)" dot={false} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── 2. Termómetro de refugio (correlación 60d vs GLD) ─────────────────

function RefugeChart({ data }: { data: NonNullable<RiskResponse["refuge"]> }) {
  const rows = data.points.map((p) => ({ date: p.date, corr: p.corr }));
  const cur = data.current;
  return (
    <div>
      <div className="flex gap-4 mb-1.5 flex-wrap">
        <StatChip
          label="Correlación actual vs oro"
          value={cur != null ? cur.toFixed(2) : "—"}
          tone={cur != null ? (cur < 0 ? "pos" : cur > 0.4 ? "neg" : "neutral") : "neutral"}
        />
      </div>
      <div style={chartBox}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={OPT_COLORS.grid} />
            <XAxis dataKey="date" stroke={OPT_COLORS.axis} tickLine={false} tickFormatter={fmtDate} minTickGap={48} style={{ fontSize: "10px" }} />
            <YAxis stroke={OPT_COLORS.axis} tickLine={false} tickFormatter={(v: number) => v.toFixed(1)} width={38} domain={[-1, 1]} style={{ fontSize: "10px" }} />
            <Tooltip
              contentStyle={ttStyle}
              formatter={(v: number) => [v.toFixed(2), "Correlación 60d"]}
              labelFormatter={(s) => fmtDate(s as string)}
              cursor={{ stroke: OPT_COLORS.gridStrong }}
            />
            <ReferenceLine y={0} stroke={OPT_COLORS.gridStrong} strokeDasharray="4 3" />
            <Line type="monotone" dataKey="corr" stroke={OPT_COLORS.term} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── 3. Régimen de mercado VIX (histograma calma vs pánico) ────────────

function VixRegimeChart({ data }: { data: NonNullable<RiskResponse["vixRegime"]> }) {
  // Trim all-zero tail bins so the X axis stays focused on real data.
  const first = data.bins.findIndex((b) => b.calm > 0 || b.panic > 0);
  let last = -1;
  for (let i = data.bins.length - 1; i >= 0; i--) {
    if (data.bins[i].calm > 0 || data.bins[i].panic > 0) { last = i; break; }
  }
  const bins = first >= 0 && last >= first ? data.bins.slice(first, last + 1) : data.bins;
  return (
    <div>
      <div className="flex gap-4 mb-1.5 flex-wrap">
        <StatChip label="Días calma (VIX≤25)" value={`${data.calmDays}`} tone="pos" />
        <StatChip label="Días pánico (VIX>25)" value={`${data.panicDays}`} tone="neg" />
        <StatChip label="Media calma" value={data.calmMean != null ? `${data.calmMean >= 0 ? "+" : ""}${data.calmMean.toFixed(2)}%` : "—"} />
        <StatChip label="Media pánico" value={data.panicMean != null ? `${data.panicMean >= 0 ? "+" : ""}${data.panicMean.toFixed(2)}%` : "—"} />
      </div>
      <div style={chartBox}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={bins} margin={{ top: 8, right: 12, left: 0, bottom: 4 }} barGap={0} barCategoryGap="10%">
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={OPT_COLORS.grid} />
            <XAxis dataKey="ret" stroke={OPT_COLORS.axis} tickLine={false} tickFormatter={(v: number) => `${v}%`} minTickGap={24} style={{ fontSize: "10px" }} />
            <YAxis stroke={OPT_COLORS.axis} tickLine={false} tickFormatter={(v: number) => `${v.toFixed(0)}%`} width={38} style={{ fontSize: "10px" }} />
            <Tooltip
              contentStyle={ttStyle}
              formatter={(v: number, name) => [`${v.toFixed(1)}% de los días`, name === "calm" ? "Calma (VIX≤25)" : "Pánico (VIX>25)"]}
              labelFormatter={(k) => `Retorno diario ≈ ${k}%`}
              cursor={{ fill: "rgba(148,163,184,0.06)" }}
            />
            <ReferenceLine x={0} stroke={OPT_COLORS.gridStrong} strokeDasharray="4 3" />
            <Bar dataKey="calm" fill={OPT_COLORS.call} fillOpacity={0.8} isAnimationActive={false} />
            <Bar dataKey="panic" fill={OPT_COLORS.put} fillOpacity={0.8} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── 4. Sensibilidad al petróleo (beta OLS vs Brent) ───────────────────

function OilBetaChart({ data }: { data: NonNullable<RiskResponse["oilBeta"]> }) {
  const xs = data.points.map((p) => p.x);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const lineStart = { x: xMin, y: data.alpha + data.beta * xMin };
  const lineEnd   = { x: xMax, y: data.alpha + data.beta * xMax };
  const weak = data.r2 != null && data.r2 < 0.05;
  return (
    <div>
      <div className="flex gap-4 mb-1.5 flex-wrap">
        <StatChip label="Beta vs Brent" value={data.beta.toFixed(2)} tone={Math.abs(data.beta) > 0.3 ? "neg" : "neutral"} />
        <StatChip label="R²" value={data.r2 != null ? data.r2.toFixed(2) : "—"} />
        <StatChip label="Días" value={`${data.days}`} />
      </div>
      <div style={chartBox}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={OPT_COLORS.grid} />
            <XAxis
              type="number" dataKey="x" name="Brent"
              stroke={OPT_COLORS.axis} tickLine={false}
              tickFormatter={(v: number) => `${v.toFixed(0)}%`} style={{ fontSize: "10px" }}
            />
            <YAxis
              type="number" dataKey="y" name="Activo"
              stroke={OPT_COLORS.axis} tickLine={false}
              tickFormatter={(v: number) => `${v.toFixed(0)}%`} width={42} style={{ fontSize: "10px" }}
            />
            <Tooltip
              contentStyle={ttStyle}
              formatter={(v: number, name) => [`${v.toFixed(2)}%`, name === "Brent" ? "Retorno Brent" : "Retorno activo"]}
              cursor={{ strokeDasharray: "3 3", stroke: OPT_COLORS.gridStrong }}
            />
            <ReferenceLine x={0} stroke={OPT_COLORS.gridStrong} strokeDasharray="4 3" />
            <ReferenceLine y={0} stroke={OPT_COLORS.gridStrong} strokeDasharray="4 3" />
            <ReferenceLine segment={[lineStart, lineEnd]} stroke={OPT_COLORS.flip} strokeWidth={2} />
            <Scatter data={data.points} fill={OPT_COLORS.term} fillOpacity={0.45} isAnimationActive={false} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      {weak && (
        <div className="text-[9px] text-muted-foreground/40 mt-1 px-1">
          R² muy bajo: la relación con el petróleo no es estadísticamente relevante para este activo.
        </div>
      )}
    </div>
  );
}

// ── Container: fetches once per ticker, renders the four blocks ─────────

export function RiskSubSection({ ticker }: { ticker: string }) {
  const [data, setData]       = useState<RiskResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");

  useEffect(() => {
    if (!ticker || !isRiskConfigured()) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setData(null);
    fetchRiskData(ticker, controller.signal)
      .then((d) => { if (!controller.signal.aborted) setData(d); })
      .catch((e) => {
        if (controller.signal.aborted || (e instanceof Error && e.name === "AbortError")) return;
        setError(e instanceof RiskApiError ? e.message : "No se pudieron calcular las métricas de riesgo.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [ticker]);

  if (!isRiskConfigured()) {
    return <EmptyBlock text="Backend de Supabase no configurado — define VITE_SUPABASE_URL para habilitar el análisis de riesgo." />;
  }

  if (loading) {
    return (
      <div className="flex items-center gap-3 py-10 text-muted-foreground text-[11px] tracking-widest">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        CALCULANDO MÉTRICAS DE RIESGO...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-3 border border-destructive/40 bg-destructive/5 flex items-start gap-2">
        <AlertCircle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
        <p className="text-xs text-destructive font-mono">{error || "Sin datos de riesgo."}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ChartBlock
        title="DRAWDOWN HISTÓRICO"
        subtitle="Distancia respecto al máximo histórico (serie underwater, hasta 10 años)"
        howToRead="Muestra cuánto ha caído el activo desde su máximo anterior en cada momento. Cuanto más profundo y prolongado el valle, más doloroso fue mantener la posición. Si el valor actual está cerca de 0%, el activo cotiza en máximos; un −30% significa que necesita subir un 43% para recuperarlos."
      >
        {data.drawdown
          ? <DrawdownChart data={data.drawdown} />
          : <EmptyBlock text="Histórico de precios insuficiente para calcular el drawdown." />}
      </ChartBlock>

      <ChartBlock
        title="TERMÓMETRO DE REFUGIO"
        subtitle="Correlación rolling de 60 sesiones entre el activo y el oro (GLD)"
        howToRead="Mide si el activo se mueve con el oro (refugio clásico) o contra él. Correlación negativa o cercana a 0 indica que el oro diversifica tu posición; correlación alta y positiva indica que en una crisis ambos podrían caer a la vez y el oro no te protegería."
      >
        {data.refuge
          ? <RefugeChart data={data.refuge} />
          : <EmptyBlock text="No hay suficientes sesiones alineadas con GLD para calcular la correlación (mínimo ~80)." />}
      </ChartBlock>

      <ChartBlock
        title="RÉGIMEN DE MERCADO VIX"
        subtitle="Distribución de retornos diarios: calma (VIX≤25, verde) vs pánico (VIX>25, rojo) · últimos 2 años"
        howToRead="Compara cómo se comporta el activo cuando el mercado está tranquilo frente a cuando hay miedo. Si la campana roja (pánico) es mucho más ancha o está desplazada a la izquierda, el activo sufre amplificación en crisis. Si ambas campanas son parecidas, el activo es relativamente inmune al régimen de volatilidad."
      >
        {data.vixRegime
          ? <VixRegimeChart data={data.vixRegime} />
          : <EmptyBlock text="No hay suficientes sesiones alineadas con el VIX para separar regímenes (mínimo ~60 días)." />}
      </ChartBlock>

      <ChartBlock
        title="SENSIBILIDAD AL PETRÓLEO"
        subtitle="Beta OLS de los retornos diarios del activo frente al Brent (BZ=F) · último año"
        howToRead="Cada punto es un día: eje X el movimiento del Brent, eje Y el del activo. La pendiente de la línea amarilla es la beta: una beta de 0.5 significa que, de media, el activo sube un 0.5% cuando el petróleo sube un 1%. Un R² bajo indica que el petróleo apenas explica los movimientos del activo, aunque la beta no sea cero."
      >
        {data.oilBeta
          ? <OilBetaChart data={data.oilBeta} />
          : <EmptyBlock text="No hay suficientes sesiones alineadas con el Brent (BZ=F) para estimar la beta." />}
      </ChartBlock>
    </div>
  );
}
