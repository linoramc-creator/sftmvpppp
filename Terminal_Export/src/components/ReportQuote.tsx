import {useEffect, useState} from 'react';
import {authenticatedFetch} from '@/lib/beta-api';
import {usePanelActive} from './KeepPanel';
import type {RegularReportQuote} from '../../../supabase/functions/analyze-ticker/regular-quote';

const memory = new Map<string, RegularReportQuote>();
const MINUTE = 60000;
export function reportQuoteRefreshDelay(quote: RegularReportQuote | null, now = Date.now()): number {
  if (!quote) return MINUTE;
  const refresh = Date.parse(quote.nextRefreshAt);
  return Number.isFinite(refresh) ? Math.max(1000, Math.min(refresh - now, 15 * MINUTE)) : MINUTE;
}
export function reportQuoteTime(quote: RegularReportQuote) {
  if (quote.kind === 'regular' && quote.at && Number.isFinite(Date.parse(quote.at))) {
    return new Intl.DateTimeFormat('es-ES', {timeZone: quote.timezone, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short'}).format(new Date(quote.at));
  }
  // Date-only trading sessions must not shift to the previous day in a US timezone.
  return quote.date && /^\d{4}-\d{2}-\d{2}$/.test(quote.date)
    ? new Intl.DateTimeFormat('es-ES', {timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric'}).format(new Date(`${quote.date}T12:00:00Z`)) : null;
}

export default function ReportQuote({symbol}: {symbol: string}) {
  const active = usePanelActive();
  const [data, setData] = useState<RegularReportQuote | null>(() => memory.get(symbol) ?? null);
  const [pending, setPending] = useState(false), [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!active || !symbol) return;
    let live = true, inFlight = false, timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    setData(memory.get(symbol) ?? null); setFailed(false);
    const schedule = (quote: RegularReportQuote | null) => {
      clearTimeout(timer);
      if (live && document.visibilityState !== 'hidden') timer = setTimeout(() => void load(true), reportQuoteRefreshDelay(quote));
    };
    const load = async (force = false) => {
      if (!live || inFlight || document.visibilityState === 'hidden') return;
      const previous = memory.get(symbol);
      if (!force && previous && Date.parse(previous.nextRefreshAt) > Date.now()) {setData(previous); schedule(previous); return;}
      inFlight = true; setPending(true);
      try {
        const response = await authenticatedFetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-ticker`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({panel: 'regularQuote', subject: symbol}), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)])});
        if (!response.ok) throw Error();
        const quote: RegularReportQuote = await response.json();
        if (quote.symbol !== symbol || !['regular', 'close', 'unavailable'].includes(quote.kind)) throw Error();
        if (!live) return;
        if (quote.kind === 'unavailable' && previous) {setFailed(true); schedule(null); return;}
        if (memory.size >= 50) memory.delete(memory.keys().next().value!);
        memory.set(symbol, quote); setData(quote); setFailed(false); schedule(quote);
      } catch {if (live) {setFailed(true); schedule(null);}}
      finally {inFlight = false; if (live) setPending(false);}
    };
    const visible = () => {
      clearTimeout(timer);
      if (document.visibilityState === 'visible') void load(true);
    };
    document.addEventListener('visibilitychange', visible);
    void load();
    return () => {live = false; controller.abort(); clearTimeout(timer); document.removeEventListener('visibilitychange', visible);};
  }, [symbol, active]);
  const quote = data?.symbol === symbol ? data : null;
  const pastSession = quote?.kind === 'regular' && quote.sessionEnd && Date.parse(quote.sessionEnd) <= Date.now();
  const mode = quote?.kind === 'regular' && !pastSession ? 'Sesión regular' : quote?.kind === 'close' ? 'Último cierre' : 'Última cotización';
  const time = quote ? reportQuoteTime(quote) : null;
  return <section aria-label={`Cotización de ${symbol}`} className="mb-5 flex min-h-16 flex-wrap items-center justify-between gap-x-5 gap-y-2 rounded-xl border border-slate-700/40 bg-slate-900/35 px-4 py-3 font-body">
    <div className="flex items-baseline gap-2.5"><span className="text-xs font-medium text-slate-400">{symbol}</span><span className="text-xl font-semibold tabular-nums tracking-tight text-slate-100">{quote?.price == null ? '—' : quote.price.toLocaleString('es-ES', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>{quote?.currency && <span className="text-[10px] text-slate-500">{quote.currency}</span>}{quote?.change != null && <span className={`text-xs font-medium tabular-nums ${quote.change >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{quote.change > 0 ? '+' : ''}{quote.change.toFixed(2)}%</span>}</div>
    <div className="text-right text-[10px] leading-relaxed text-slate-500">{!quote && pending ? <span role="status">Consultando cotización…</span> : <><p>{quote?.price == null ? 'Cotización no disponible' : mode}{time && <> · {time}</>}</p>{failed ? <p>Actualización pendiente</p> : quote?.kind === 'regular' && !pastSession && <p>Actualización cada 60 s · puede haber retraso</p>}</>}</div>
  </section>;
}
