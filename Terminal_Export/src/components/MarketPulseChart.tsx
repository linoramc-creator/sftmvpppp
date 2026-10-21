import { useMemo, useState } from 'react';
import type { MarketPulse } from '../../../supabase/functions/analyze-ticker/market-pulse';
import InteractivePriceChart from './InteractivePriceChart';
import { aggregateChartBars } from '@/lib/chart-indicators';

export default function MarketPulseChart({ data }: { data: MarketPulse }) {
  const [period, setPeriod] = useState<'session' | '20' | '63' | '126' | '252' | 'all'>('session');
  const [minutes, setMinutes] = useState(5);
  const effectiveMinutes = Math.max(minutes, data.intraday.intervalMinutes);
  const intraday = useMemo(() => aggregateChartBars(data.intraday.candles, effectiveMinutes, data.intraday.intervalMinutes), [data.intraday.candles, data.intraday.intervalMinutes, effectiveMinutes]);
  const rows = useMemo(() => period === 'session' ? intraday : period === 'all' ? data.daily : data.daily.slice(-Number(period)), [period, intraday, data.daily]);
  const history = period === 'session' ? intraday : data.daily;
  return <InteractivePriceChart market symbol={data.symbol} title={period==='session'?'Pulso de la sesión':'Histórico de precios'}
    subtitle={<>{period === 'session' ? `${data.intraday.date ?? 'Sin sesión'} · intervalos de ${effectiveMinutes} min` : `Sesiones diarias · ${rows.length} disponibles`} · {data.instrument.priceUnit || data.currency}</>}
    candles={rows} history={history} datasetKey={`${data.symbol}:${period}:${effectiveMinutes}`} timezone={data.timezone}
    session={`${data.timezone} · ${period === 'session' ? 'Última sesión disponible. La última barra puede estar incompleta.' : 'OHLC diarios de las sesiones disponibles.'}`}
    allowVolume={data.instrument.volumeUnit !== 'unavailable'} volumeLabel={data.instrument.volumeUnit === 'fund-units' ? 'PARTICIPACIONES NEGOCIADAS' : 'VOLUMEN NEGOCIADO'}
    priceDecimals={data.instrument.priceDecimals} intraday={period === 'session'} emptyText={period === 'session' ? 'Sin barras intradiarias verificadas para esta sesión.' : 'Sin sesiones diarias verificadas para este período.'}
    periods={period === 'session' ? <div className="flex flex-wrap gap-1">{[5, 15, 30, 60, 240].filter(value => value >= data.intraday.intervalMinutes && value % data.intraday.intervalMinutes === 0).map(value => <button key={value} aria-label={`Intervalo de mercado ${value >= 60 ? `${value / 60}H` : `${value} min`}`} aria-pressed={effectiveMinutes === value} onClick={() => setMinutes(value)} className={`rounded-lg px-2.5 py-1.5 text-[10px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70 ${effectiveMinutes === value ? 'bg-slate-800 text-slate-200' : 'text-slate-500 hover:bg-slate-800/60'}`}>{value >= 60 ? `${value / 60}H` : `${value} min`}</button>)}</div> : undefined}
    intervals={<div className="flex flex-wrap gap-1 rounded-xl border border-slate-800 bg-slate-950/50 p-1">{(['session', '20', '63', '126', '252', 'all'] as const).map(value => <button key={value} aria-pressed={period === value} onClick={() => setPeriod(value)} className={`rounded-lg px-2.5 py-1.5 text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70 ${period === value ? 'bg-slate-700/70 text-slate-100' : 'text-slate-400 hover:bg-slate-800'}`}>{({session:'Sesión','20':'20 sesiones','63':'3 meses','126':'6 meses','252':'1 año',all:'Histórico'})[value]}</button>)}</div>}
  />;
}
