import { useMemo } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { EtfResponse, EtfGeoRisk } from "@/types/etf";
import { OPT_COLORS, ttStyle } from "@/components/options/theme";

const DONUT_COLORS = [
  "#22c55e", "#38bdf8", "#818cf8", "#fbbf24", "#f472b6",
  "#34d399", "#f87171", "#a78bfa", "#fb923c", "#94a3b8", "#64748b",
];

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-1.5">
      <div className="text-[10px] tracking-widest text-foreground font-semibold">{title}</div>
      {subtitle && <div className="text-[9px] text-muted-foreground/40 mt-0.5">{subtitle}</div>}
    </div>
  );
}

function EmptyNote({ text }: { text: string }) {
  return (
    <div className="py-8 text-center text-[11px] text-muted-foreground/50 border border-border bg-card">
      {text}
    </div>
  );
}

// Inline percentage bar used in tables (regional / allocation breakdowns).
function PctBar({ pct, color, max = 100 }: { pct: number; color: string; max?: number }) {
  const width = Math.max(1, Math.min(100, (pct / max) * 100));
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="flex-1 h-1.5 bg-secondary/60 overflow-hidden">
        <div className="h-full" style={{ width: `${width}%`, background: color }} />
      </div>
      <span className="text-[11px] font-mono text-foreground/80 tabular-nums w-12 text-right">{pct.toFixed(1)}%</span>
    </div>
  );
}

// ── Sector / asset-class donut + table ─────────────────────────────────

function SectorBreakdown({ data }: { data: EtfResponse }) {
  const sectors = data.sectors ?? [];
  const alloc = data.assetAllocation ?? [];
  // Sector breakdown for equity ETFs; fall back to asset-class allocation
  // for bond/mixed funds where Yahoo reports no sector weights.
  const rows = sectors.length > 0
    ? sectors.map((s) => ({ name: s.sector, pct: s.pct }))
    : alloc.map((a) => ({ name: a.label, pct: a.pct }));

  if (rows.length === 0) {
    return <EmptyNote text="Yahoo no publica desglose sectorial ni de clases de activo para este ETF." />;
  }

  return (
    <div className="grid md:grid-cols-2 gap-4 items-start">
      <div style={{ width: "100%", height: 260, backgroundColor: OPT_COLORS.bg, border: "1px solid #1e293b", borderRadius: 2 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={rows} dataKey="pct" nameKey="name"
              cx="50%" cy="50%" innerRadius={58} outerRadius={95}
              paddingAngle={1} isAnimationActive={false} stroke="none"
            >
              {rows.map((_, i) => (
                <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={ttStyle} formatter={(v: number, name) => [`${v.toFixed(1)}%`, String(name)]} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="border border-border bg-card">
        <div className="divide-y divide-border/30">
          {rows.map((r, i) => (
            <div key={r.name} className="flex items-center gap-3 px-3 py-1.5">
              <span className="w-2 h-2 shrink-0" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
              <span className="text-[11px] text-foreground/80 flex-1 truncate">{r.name}</span>
              <span className="text-[11px] font-mono text-primary tabular-nums">{r.pct.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Regional breakdown (table with inline bars) ────────────────────────

function CountryBreakdown({ data }: { data: EtfResponse }) {
  const countries = data.countries ?? null;
  if (!countries || countries.length === 0) {
    return <EmptyNote text="Desglose regional no disponible en ninguna fuente (FMP y Yahoo no publican la cartera por país de este ETF)." />;
  }
  const max = Math.max(...countries.map((c) => c.pct));
  return (
    <div>
      <div className="border border-border bg-card">
        <div className="divide-y divide-border/30">
          {countries.slice(0, 15).map((c) => (
            <div key={c.country} className="flex items-center gap-4 px-3 py-1.5">
              <span className="text-[11px] text-foreground/80 w-44 truncate shrink-0">{c.country}</span>
              <div className="flex-1">
                <PctBar pct={c.pct} color={OPT_COLORS.term} max={max} />
              </div>
            </div>
          ))}
        </div>
      </div>
      {data.countriesSource === "yahoo-approx" && (
        <div className="text-[9px] text-muted-foreground/40 mt-1 px-1">
          Aproximado a partir del país de domicilio del top 10 de posiciones (Yahoo), renormalizado — FMP no publica la cartera por país de este ETF.
        </div>
      )}
    </div>
  );
}

// ── Top holdings table ─────────────────────────────────────────────────

function HoldingsTable({ data }: { data: EtfResponse }) {
  const holdings = data.holdings ?? [];
  if (holdings.length === 0) {
    return <EmptyNote text="Yahoo no publica las posiciones principales de este ETF." />;
  }
  const max = Math.max(...holdings.map((h) => h.pct));
  return (
    <div className="border border-border bg-card overflow-x-auto">
      <table className="w-full font-mono" style={{ fontSize: "12px" }}>
        <thead>
          <tr className="border-b border-border bg-secondary/40">
            <th className="px-3 py-2 text-left text-[10px] tracking-widest text-muted-foreground/50 font-normal">#</th>
            <th className="px-3 py-2 text-left text-[10px] tracking-widest text-muted-foreground/50 font-normal">TICKER</th>
            <th className="px-3 py-2 text-left text-[10px] tracking-widest text-muted-foreground/50 font-normal">NOMBRE</th>
            <th className="px-3 py-2 text-right text-[10px] tracking-widest text-muted-foreground/50 font-normal">PESO</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/30">
          {holdings.map((h, i) => (
            <tr key={`${h.symbol}-${i}`} className="hover:bg-primary/3 transition-colors">
              <td className="px-3 py-1.5 text-muted-foreground/40">{i + 1}</td>
              <td className="px-3 py-1.5 text-primary font-semibold">{h.symbol || "—"}</td>
              <td className="px-3 py-1.5 text-foreground/75" style={{ fontFamily: "var(--font-sans)" }}>{h.name || "—"}</td>
              <td className="px-3 py-1.5">
                <PctBar pct={h.pct} color={OPT_COLORS.call} max={max} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Geopolitical risk layer ────────────────────────────────────────────

function GeoRiskChart({ risks }: { risks: EtfGeoRisk[] }) {
  const rows = useMemo(
    () => risks.map((r) => ({
      name: `${r.factor} (${r.kind})`,
      contribution: r.contribution,
      exposure: r.exposurePct,
      score: r.score,
      note: r.note,
    })),
    [risks],
  );

  if (rows.length === 0) {
    return <EmptyNote text="Sin factores de riesgo geopolítico relevantes detectados en la cartera (o sin datos de exposición)." />;
  }

  return (
    <div>
      <div style={{ width: "100%", height: Math.max(160, rows.length * 36 + 40), backgroundColor: OPT_COLORS.bg, border: "1px solid #1e293b", borderRadius: 2, padding: "8px 6px" }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={OPT_COLORS.grid} />
            <XAxis type="number" stroke={OPT_COLORS.axis} tickLine={false} style={{ fontSize: "10px" }} />
            <YAxis
              type="category" dataKey="name" width={170}
              stroke={OPT_COLORS.axis} tickLine={false} style={{ fontSize: "10px" }}
            />
            <Tooltip
              contentStyle={ttStyle}
              formatter={(v: number, _name, entry) => {
                const p = entry?.payload as typeof rows[number] | undefined;
                return [
                  `${v.toFixed(1)} pts (exposición ${p?.exposure.toFixed(1)}% × severidad ${p?.score})`,
                  "Riesgo ponderado",
                ];
              }}
              cursor={{ fill: "rgba(148,163,184,0.06)" }}
            />
            <Bar dataKey="contribution" isAnimationActive={false}>
              {rows.map((r, i) => (
                <Cell key={i} fill={r.score >= 70 ? OPT_COLORS.put : r.score >= 45 ? OPT_COLORS.flip : OPT_COLORS.call} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 space-y-1">
        {rows.map((r) => (
          <div key={r.name} className="text-[10px] text-muted-foreground/55 leading-relaxed">
            <span className="text-foreground/75 font-semibold">{r.name}:</span> {r.note}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── News feed ──────────────────────────────────────────────────────────

function EtfNews({ data }: { data: EtfResponse }) {
  const news = data.news ?? [];
  if (news.length === 0) {
    return <EmptyNote text="Sin noticias recientes en ninguna fuente (Finnhub, Yahoo y FMP no devolvieron resultados para este ETF)." />;
  }
  return (
    <div className="border border-border bg-card divide-y divide-border/30">
      {news.map((n) => (
        <a
          key={n.url}
          href={n.url} target="_blank" rel="noopener noreferrer"
          className="block px-3 py-2 hover:bg-primary/3 transition-colors"
        >
          <div className="text-[12px] text-foreground/85 leading-snug" style={{ fontFamily: "var(--font-sans)" }}>{n.title}</div>
          <div className="text-[9px] text-muted-foreground/40 mt-0.5 font-mono">{n.source} · {n.datetime}</div>
        </a>
      ))}
    </div>
  );
}

// ── Container ──────────────────────────────────────────────────────────

export function EtfSubSection({ data }: { data: EtfResponse }) {
  return (
    <div className="space-y-6">
      {(data.name || data.family || data.category) && (
        <div className="flex items-center gap-3 flex-wrap text-[10px] font-mono">
          {data.name && <span className="text-foreground/85">{data.name}</span>}
          {data.family && <span className="text-muted-foreground/50">{data.family}</span>}
          {data.category && <span className="text-primary/70 border border-primary/25 px-1.5 py-0.5">{data.category}</span>}
        </div>
      )}

      <div>
        <SectionTitle
          title="EXPOSICIÓN POR SECTOR / CLASE DE ACTIVO"
          subtitle={`Pesos publicados por el proveedor del fondo (vía ${data.sectorsSource === "fmp" ? "FMP" : "Yahoo Finance"})`}
        />
        <SectorBreakdown data={data} />
      </div>

      <div>
        <SectionTitle
          title="DESGLOSE REGIONAL"
          subtitle={
            data.countriesSource === "yahoo-approx"
              ? "Peso por país estimado desde el top 10 de posiciones (vía Yahoo)"
              : "Peso por país de la cartera (vía FMP)"
          }
        />
        <CountryBreakdown data={data} />
      </div>

      <div>
        <SectionTitle
          title="TOP 10 POSICIONES"
          subtitle="Mayores posiciones del fondo y su peso en cartera"
        />
        <HoldingsTable data={data} />
      </div>

      <div>
        <SectionTitle
          title="CAPA DE RIESGO GEOPOLÍTICO"
          subtitle="Exposición real (sector/país) × severidad heurística fija · cálculo determinista y auditable, no generado por IA"
        />
        <GeoRiskChart risks={data.geoRisks ?? []} />
      </div>

      <div>
        <SectionTitle
          title="NOTICIAS RELEVANTES"
          subtitle={`Últimos 30 días · ${
            data.newsSource === "yahoo" ? "Yahoo Finance"
            : data.newsSource === "fmp" ? "FMP"
            : "Finnhub"
          }`}
        />
        <EtfNews data={data} />
      </div>
    </div>
  );
}
