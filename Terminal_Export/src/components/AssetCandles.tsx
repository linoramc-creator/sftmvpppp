import { useMemo, useState } from 'react';
import type { AssetSnapshot, CandleInterval } from '../../../supabase/functions/analyze-ticker/asset-snapshot';
import InteractivePriceChart from './InteractivePriceChart';

const intervals: Record<CandleInterval, string> = { '1h': '1H', '4h': '4H', '1d': '1 DÍA', '1w': '1 SEMANA' };
const rangeLabels: Record<number, string> = { 7: '1 SEM', 30: '1 MES', 90: '3 MESES', 365: '1 AÑO', 730: '2 AÑOS', 1825: '5 AÑOS' };

export default function AssetCandles({ data }: { data: AssetSnapshot }) {
  const [interval, setInterval] = useState<CandleInterval>('4h'), [days, setDays] = useState(30);
  const source = data.series?.[interval] ?? { candles: interval === '4h' ? data.candles : [], timezone: data.timezone, session: data.session };
  const rows = useMemo(() => {
    const end = source.candles.at(-1)?.time ?? Date.now();
    return source.candles.filter(c => c.time >= end - days * 86400000);
  }, [source.candles, days]);
  const coverageDays = source.candles.length > 1 ? (source.candles.at(-1)!.time - source.candles[0].time) / 86400000 : 0;
  const rangeOptions = interval === '1w' ? [365, 730, 1825] : interval === '1d' ? [90, 365, 730] : coverageDays >= 80 ? [7, 30, 90] : [7, 30];
  return <InteractivePriceChart symbol={data.symbol} title={`PRECIO · VELAS ${intervals[interval]}`} subtitle={<>{data.symbol} <span className="mx-1.5 text-slate-700">/</span> {data.instrument?.priceUnit || data.currency} <span className="mx-1.5 text-slate-700">/</span> {source.timezone}</>}
    candles={rows} history={source.candles} datasetKey={`${data.symbol}:${interval}:${days}`} timezone={source.timezone} session={source.session}
    allowVolume={data.instrument?.volumeUnit !== 'unavailable'} priceDecimals={data.instrument?.priceDecimals} intraday={interval === '1h' || interval === '4h'}
    intervals={<div className="flex rounded-xl border border-slate-800 bg-slate-950/50 p-1">{(Object.keys(intervals) as CandleInterval[]).map(value => <button key={value} aria-label={`Velas ${intervals[value]}`} aria-pressed={interval === value} onClick={() => { setInterval(value); setDays(value === '1w' ? 1825 : value === '1d' ? 365 : 30); }} className={`rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70 ${interval === value ? 'bg-blue-400/15 text-blue-300 shadow-sm' : 'text-slate-500 hover:bg-slate-800 hover:text-slate-200'}`}>{intervals[value]}</button>)}</div>}
    periods={<div className="flex gap-1">{rangeOptions.map(value => <button key={value} aria-label={`Período ${rangeLabels[value]}`} aria-pressed={days === value} className={`rounded-lg px-2.5 py-1.5 text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70 ${days === value ? 'bg-slate-800 text-slate-200' : 'text-slate-500 hover:bg-slate-800/60 hover:text-slate-300'}`} onClick={() => setDays(value)}>{rangeLabels[value]}</button>)}</div>}
  />;
}
