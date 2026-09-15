import { useEffect, useState } from 'react';
import { fetchTickerFundamentals, type QuarterlyPeriod } from '@/lib/analyze';
import { buildGrowthChartData, mergeGrowthSeries } from '@/lib/revenue-growth';
export type RevenuePoint = { period: string; revenueGrowth: number | null };
export function RevenueGrowthBars({ data }: { data: RevenuePoint[] }) {
  const first = data.findIndex(p => p.revenueGrowth !== null && Number.isFinite(p.revenueGrowth));
  if (first < 0) return <p className="py-8 text-sm text-muted-foreground">No hay períodos comparables para mostrar el crecimiento interanual.</p>;
  const rows = data.slice(first);
  const values = rows.flatMap(p => p.revenueGrowth !== null && Number.isFinite(p.revenueGrowth) ? [p.revenueGrowth] : []);
  const low = Math.min(0, ...values), high = Math.max(0, ...values);
  const span = Math.max(1, high - low), min = low < 0 ? low - span * .12 : 0, max = high > 0 ? high + span * .12 : low < 0 ? 0 : 1;
  const width = Math.max(300, rows.length * 60 + 100), height = 310;
  const y = (value: number) => 20 + (max - value) / (max - min) * 230;
  const step = (width - 100) / rows.length;
  const percent = (value: number) => `${value > 0 ? '+' : ''}${value.toLocaleString('es-ES', { maximumFractionDigits: 1 })}%`;
  return <div><h3 className="text-sm font-semibold mb-3">Crecimiento interanual de ingresos</h3><div className="overflow-x-auto border border-border bg-card">
    <svg role="img" aria-label="Gráfico de barras del crecimiento interanual de ingresos" viewBox={`0 0 ${width} ${height}`} style={{ display: 'block', width: '100%', minWidth: rows.length > 4 ? Math.min(width, 620) : 0, height: 310 }}>
      <title>Crecimiento interanual de ingresos por trimestre</title>
      {Array.from({ length: 5 }, (_, i) => min + (max - min) * i / 4).map((value, i) => <g key={i}><line x1={70} x2={width - 20} y1={y(value)} y2={y(value)} stroke="#253044" /><text x={60} y={y(value) + 4} textAnchor="end" fill="#94a3b8" fontSize={11}>{percent(value)}</text></g>)}
      <line x1={70} x2={width - 20} y1={y(0)} y2={y(0)} stroke="#94a3b8" />
      {rows.map((point, i) => { const value = point.revenueGrowth, x = 75 + i * step; const valid = value !== null && Number.isFinite(value); return <g key={point.period}>
        {valid ? <rect data-testid="revenue-growth-bar" x={x + step * .15} y={Math.min(y(value), y(0))} width={step * .6} height={Math.max(2, Math.abs(y(value) - y(0)))} fill={value >= 0 ? '#34d399' : '#f87171'}><title>{point.period}: {percent(value)}</title></rect> : <text x={x + step / 2} y={y(0) - 8} textAnchor="middle" fill="#64748b" fontSize={10}>N/D</text>}
        {valid && <text x={x + step / 2} y={value >= 0 ? y(value) - 7 : y(value) + 16} textAnchor="middle" fill="#cbd5e1" fontSize={10}>{percent(value)}</text>}
        <text x={x + step / 2} y={275} textAnchor="middle" fill="#94a3b8" fontSize={10}>{point.period.slice(0, 7)}</text>
      </g>; })}
    </svg>
  </div><p className="text-xs text-muted-foreground mt-2">Variación respecto al mismo trimestre del año anterior.</p></div>;
}
export function RevenueGrowthSection({ ticker, fallback }: { ticker: string; fallback: QuarterlyPeriod[] }) {
  const [precise, setPrecise] = useState<RevenuePoint[] | null>(null);
  useEffect(() => { let cancelled = false; setPrecise(null);
    fetchTickerFundamentals(ticker).then(result => {
      if (cancelled || !result) return;
      const rows = result.periodsIso.map((period, index) => ({ period, revenueGrowth: result.series.revenueGrowth[index] ?? null }));
      if (rows.some(p => p.revenueGrowth !== null)) setPrecise(rows);
    });
    return () => { cancelled = true; };
  }, [ticker]);
  return <RevenueGrowthBars data={mergeGrowthSeries(buildGrowthChartData(fallback), precise ?? [])} />;
}
