import { useMemo, useState } from 'react';
import type { MarketPulse } from '../../../supabase/functions/analyze-ticker/market-pulse';
import InteractivePriceChart from './InteractivePriceChart';
import { aggregateChartBars } from '@/lib/chart-indicators';

export default function MarketPulseChart({ data }: { data: MarketPulse }) {
  const [period, setPeriod] = useState<'session' | '20' | '63'>('session');
  const [minutes, setMinutes] = useState(5);
  const intraday = useMemo(() => aggregateChartBars(data.intraday.candles, minutes, data.intraday.intervalMinutes), [data.intraday.candles, data.intraday.intervalMinutes, minutes]);
  const rows = useMemo(() => period === 'session' ? intraday : data.daily.slice(-(period === '20' ? 20 : 63)), [period, intraday, data.daily]);
  const history = period === 'session' ? intraday : data.daily;
  return <InteractivePriceChart market symbol={data.symbol} title="Pulso de la sesión"
    subtitle={<>{period === 'session' ? `${data.intraday.date ?? 'Sin sesión'} · intervalos de ${Math.max(minutes, data.intraday.intervalMinutes)} min` : 'Sesiones diarias'} · {data.instrument.priceUnit || data.currency}</>}
    candles={rows} history={history} datasetKey={`${data.symbol}:${period}:${minutes}`} timezone={data.timezone}
    session={`${data.timezone} · ${period === 'session' ? 'Última sesión disponible. La última barra puede estar incompleta.' : 'OHLC diarios de las sesiones disponibles.'}`}
    allowVolume={data.instrument.volumeUnit !== 'unavailable'} volumeLabel={data.instrument.volumeUnit === 'fund-units' ? 'PARTICIPACIONES NEGOCIADAS' : 'VOLUMEN NEGOCIADO'}
    priceDecimals={data.instrument.priceDecimals} intraday={period === 'session'} emptyText={period === 'session' ? 'Sin barras intradiarias verificadas para esta sesión.' : 'Sin sesiones diarias verificadas para este período.'}
    periods={period === 'session' ? <div className="flex flex-wrap gap-1">{[5, 15, 30, 60].filter(value => value >= data.intraday.intervalMinutes).map(value => <button key={value} aria-label={`Intervalo de mercado ${value === 60 ? '1H' : `${value} min`}`} aria-pressed={minutes === value} onClick={() => setMinutes(value)} className={`rounded-lg px-2.5 py-1.5 text-[10px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70 ${minutes === value ? 'bg-slate-800 text-slate-200' : 'text-slate-500 hover:bg-slate-800/60'}`}>{value === 60 ? '1H' : `${value} min`}</button>)}</div> : undefined}
    intervals={<div className="flex flex-wrap gap-1 rounded-xl border border-slate-800 bg-slate-950/50 p-1">{(['session', '20', '63'] as const).map(value => <button key={value} aria-pressed={period === value} onClick={() => setPeriod(value)} className={`rounded-lg px-2.5 py-1.5 text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70 ${period === value ? 'bg-slate-700/70 text-slate-100' : 'text-slate-400 hover:bg-slate-800'}`}>{value === 'session' ? 'Sesión' : value === '20' ? '20 sesiones' : '3 meses'}</button>)}</div>}
  />;
}
