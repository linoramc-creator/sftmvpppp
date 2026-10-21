import { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import InteractivePriceChart from '@/components/InteractivePriceChart';
import { acquireReportCandles, candleWindow, reportCandlePeriods, type ReportCandlesData, type ReportCandleInterval } from '@/lib/report-candles';

const intervalLabels: Record<ReportCandleInterval, string> = { '1h': '1H', '4h': '4H', '1d': '1 DÍA', '1w': '1 SEMANA' };
const periodLabels: Record<number, string> = { 30: '1 MES', 90: '3 MESES', 365: '1 AÑO', 730: '2 AÑOS', 1825: '5 AÑOS' };
const buttonStyle = 'rounded-lg px-2.5 py-1.5 text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70 disabled:cursor-not-allowed disabled:opacity-30';

/** Real intraday OHLC, shared by report summaries and instrument detail views. */
export function InstrumentPriceChart({ ticker }: { ticker: string }) {
  const symbol = ticker.trim().toUpperCase();
  const [data, setData] = useState<ReportCandlesData | null>(null);
  const [interval, setInterval] = useState<ReportCandleInterval>('4h');
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  const appliedRevision = useRef(0);

  useEffect(() => { setInterval('4h'); setDays(30); }, [symbol]);
  useEffect(() => {
    if (!symbol) { setData(null); setLoading(false); return; }
    let active = true;
    setLoading(true); setError('');
    const force = appliedRevision.current !== revision;
    appliedRevision.current = revision;
    const request = acquireReportCandles(symbol, force);
    request.promise.then(value => { if (active) setData(value); }).catch(() => {
      if (active) setError('No se ha podido actualizar el histórico. Puedes volver a intentarlo.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; request.release(); };
  }, [symbol, revision]);

  const current = data?.symbol === symbol ? data : null;
  const source = current?.series[interval];
  const history = source?.candles ?? [];
  const rows = useMemo(() => candleWindow(history, days), [history, days]);
  const periods = reportCandlePeriods(history, interval);
  // A shorter coverage window is disclosed, never padded with synthetic candles.
  const span = history.length > 1 ? (history.at(-1)!.time - history[0].time) / 86400000 : 0;
  const limited = rows.length > 0 && span < Math.min(days, 30) - 5;

  if (!current) return <section aria-label={`Histórico de ${symbol}`} aria-busy={loading} className="mb-4 rounded-2xl border border-slate-800 bg-[#0b111b] p-5 font-sans">
    <div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold text-slate-100">{symbol} · Precio y volumen</h2><span className="text-[10px] text-slate-500">4H · 1 MES</span></div>
    {loading ? <div role="status" className="mt-5 h-[330px] rounded-xl border border-slate-800/60 bg-gradient-to-b from-slate-900/40 to-transparent motion-safe:animate-pulse"><span className="sr-only">Cargando velas del activo…</span></div> : <div role="alert" className="flex min-h-[230px] flex-col items-center justify-center gap-4 text-center"><p className="max-w-sm text-sm leading-relaxed text-slate-400">{error || 'No hay histórico disponible para este activo.'}</p><button type="button" className={`${buttonStyle} inline-flex items-center gap-2 border border-slate-700 text-blue-300 hover:bg-slate-800`} onClick={() => setRevision(value => value + 1)}><RefreshCw size={13}/>Reintentar histórico</button></div>}
  </section>;

  return <div className="mb-4 min-w-0 space-y-2" aria-busy={loading}>
    <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[10px] text-slate-500"><span>{limited ? 'Histórico limitado al período disponible' : 'Histórico de negociación'}{loading && ' · Actualizando…'}</span><button type="button" aria-label="Actualizar histórico" disabled={loading} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200 disabled:opacity-40" onClick={() => setRevision(value => value + 1)}><RefreshCw size={12} className={loading ? 'motion-safe:animate-spin' : ''}/>Actualizar</button></div>
    {error && <p role="alert" className="rounded-lg border border-rose-400/20 bg-rose-400/5 px-3 py-2 text-xs text-rose-300">{error}</p>}
    <InteractivePriceChart symbol={symbol} title={`PRECIO · VELAS ${intervalLabels[interval]}`} subtitle={<>{symbol} <span className="mx-1.5 text-slate-700">/</span> {current.priceUnit || current.currency} <span className="mx-1.5 text-slate-700">/</span> {source?.timezone || current.timezone}</>}
      candles={rows} history={history} datasetKey={`${symbol}:${interval}:${days}`} timezone={source?.timezone || current.timezone} session={source?.session || 'Histórico de negociación'} allowVolume={current.allowVolume} priceDecimals={current.priceDecimals} intraday={interval === '1h' || interval === '4h'} emptyText="No hay velas verificadas para este intervalo. Prueba otro intervalo o actualiza el histórico."
      intervals={<div className="flex rounded-xl border border-slate-800 bg-slate-950/50 p-1">{(Object.keys(intervalLabels) as ReportCandleInterval[]).map(value => <button type="button" key={value} aria-label={`Velas ${intervalLabels[value]}`} aria-pressed={interval === value} disabled={!current.series[value]?.candles.length} onClick={() => { const available = reportCandlePeriods(current.series[value]?.candles ?? [], value); const desired = value === '1w' ? 1825 : value === '1d' ? 365 : 30; setInterval(value); setDays(available.includes(desired) ? desired : available.at(-1)!); }} className={`${buttonStyle} ${interval === value ? 'bg-blue-400/15 text-blue-300' : 'text-slate-500 hover:bg-slate-800 hover:text-slate-200'}`}>{intervalLabels[value]}</button>)}</div>}
      periods={<div className="flex gap-1">{periods.map(value => <button type="button" key={value} aria-label={`Período ${periodLabels[value]}`} aria-pressed={days === value} className={`${buttonStyle} ${days === value ? 'bg-slate-800 text-slate-200' : 'text-slate-500 hover:bg-slate-800/60 hover:text-slate-300'}`} onClick={() => setDays(value)}>{periodLabels[value]}</button>)}</div>}
    />
  </div>;
}
