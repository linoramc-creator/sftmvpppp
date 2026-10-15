import {ArrowUpRight, Clock3} from 'lucide-react';
import type {AssetSnapshot} from '../../../supabase/functions/analyze-ticker/asset-snapshot';
import type {ExtendedQuote} from '../../../supabase/functions/analyze-ticker/extended-hours';

const finite = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const priceText = (value: number | null | undefined) => finite(value)
  ? value.toLocaleString('es-ES', {minimumFractionDigits: 2, maximumFractionDigits: 2})
  : '—';

const changeText = (value: number) =>
  `${value > 0 ? '+' : ''}${value.toLocaleString('es-ES', {minimumFractionDigits: 2, maximumFractionDigits: 2})}%`;

const zoneLabel = (zone: string) => ({
  'America/New_York': 'ET', 'America/Chicago': 'CT',
  'Europe/Madrid': 'Madrid', 'Europe/London': 'Londres',
  'Asia/Tokyo': 'JST', 'Asia/Seoul': 'KST',
}[zone] ?? zone);

export function assetQuoteTime(at: string | null | undefined, timezone = 'America/New_York') {
  if (!at || !Number.isFinite(Date.parse(at))) return null;
  let zone = timezone;
  try { new Intl.DateTimeFormat('es-ES', {timeZone: zone}); } catch { zone = 'UTC'; }
  const date = new Date(at);
  const day = date.toLocaleDateString('es-ES', {timeZone: zone, day: '2-digit', month: 'short', year: 'numeric'});
  const hour = date.toLocaleTimeString('es-ES', {timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});
  return `${day} · ${hour} ${zoneLabel(zone)}`;
}

export function extendedQuoteTime(quote: ExtendedQuote) {
  const exact = assetQuoteTime(quote.at, 'America/New_York');
  if (exact) return exact;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(quote.date)) return 'Hora no disponible';
  // A session date is not a timestamp. Format in UTC to preserve the supplied day.
  const day = new Date(`${quote.date}T12:00:00Z`).toLocaleDateString('es-ES', {
    timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric',
  });
  return `${day} · último precio de sesión`;
}

function SessionQuote({quote, currency}: {quote: ExtendedQuote; currency: string}) {
  return <div className="min-w-0 rounded-xl border border-slate-700/40 bg-slate-950/30 p-3.5">
    <p className="text-[11px] font-medium tracking-wide text-slate-400">
      {quote.session === 'pre' ? 'Premarket' : 'Postmarket'}
    </p>
    <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1 tabular-nums">
      <span className="text-lg font-semibold tracking-tight text-slate-100">{priceText(quote.price)}</span>
      {currency && <span className="text-[10px] text-slate-500">{currency}</span>}
      {finite(quote.change) && <span className={`text-xs font-medium ${quote.change >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
        {changeText(quote.change)}
      </span>}
    </div>
    <p className="mt-2 text-[10px] leading-relaxed text-slate-400">{extendedQuoteTime(quote)}</p>
  </div>;
}

export default function AssetOverview({symbol, data, busy = false, onAnalyze}: {
  symbol: string;
  data: AssetSnapshot | null;
  busy?: boolean;
  onAnalyze: () => void;
}) {
  const quotes = data?.extendedHours?.quotes.filter(quote => finite(quote.price)) ?? [];
  const time = assetQuoteTime(data?.quoteAt, data?.timezone);
  return <section aria-label={`Resumen de ${symbol}`} aria-busy={busy}
    className="overflow-hidden rounded-xl border border-slate-700/50 bg-[#0b1017] font-body shadow-sm">
    <div className="flex flex-col justify-between gap-5 px-5 py-5 sm:flex-row sm:items-start sm:px-6">
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-2.5 text-xs">
          <span className="rounded-md border border-slate-600/50 bg-slate-800/70 px-2 py-1 font-mono font-medium text-slate-200">{symbol}</span>
          {data?.exchange && <span className="text-slate-400">{data.exchange}</span>}
          {busy && <span role="status" className="text-slate-500">Actualizando…</span>}
        </div>
        <h1 className="font-body text-[23px] font-semibold leading-tight tracking-tight text-slate-100 sm:text-[26px]">
          {data?.name || symbol}
        </h1>
        <button onClick={onAnalyze}
          className="mt-3 inline-flex items-center gap-2 rounded-lg border border-slate-600/60 bg-slate-800/50 px-3 py-2 text-xs font-medium text-slate-200 transition-colors hover:border-emerald-500/60 hover:bg-emerald-500/10 hover:text-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b1017]">
          Analizar {symbol}<ArrowUpRight size={14} aria-hidden="true"/>
        </button>
      </div>
      <div className="min-w-0 sm:text-right">
        <p className="mb-1 text-[11px] font-medium text-slate-400">Cotización · sesión regular</p>
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 sm:justify-end">
          <span className="text-[34px] font-semibold leading-tight tracking-tight text-slate-50 tabular-nums">{priceText(data?.price)}</span>
          {data?.currency && <span className="text-xs font-medium text-slate-400">{data.currency}</span>}
          {finite(data?.change) && <span className={`rounded-md px-2 py-1 text-sm font-medium tabular-nums ${data.change >= 0 ? 'bg-emerald-400/10 text-emerald-400' : 'bg-rose-400/10 text-rose-400'}`}>
            {changeText(data.change)}
          </span>}
        </div>
        {time && <p className="mt-2 inline-flex items-center gap-1.5 text-[10px] text-slate-400">
          <Clock3 size={11} aria-hidden="true"/>{time}
        </p>}
      </div>
    </div>
    {(data?.description || quotes.length > 0) && <div className={`grid items-start gap-5 border-t border-slate-700/40 px-5 py-4 sm:px-6 ${data?.description && quotes.length ? 'lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]' : ''}`}>
      {data?.description && <div className="min-w-0">
        <h2 className="mb-2 font-body text-[11px] font-semibold tracking-wide text-slate-400">Actividad</h2>
        <p className="max-w-[70ch] text-[13px] leading-[1.75] text-slate-300">{data.description}</p>
      </div>}
      {quotes.length > 0 && <div aria-label="Negociación fuera de horario" className={`grid gap-2.5 ${quotes.length > 1 ? 'sm:grid-cols-2' : ''}`}>
        {quotes.map(quote => <SessionQuote key={quote.session} quote={quote} currency={data?.extendedHours?.currency || data?.currency || ''}/>)}
      </div>}
    </div>}
  </section>;
}
