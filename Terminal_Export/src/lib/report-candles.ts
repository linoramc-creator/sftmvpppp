import { authenticatedFetch } from './beta-api';
import type { PriceBar } from './chart-indicators';

export type ReportCandleInterval = '1h' | '4h' | '1d' | '1w';
type Series = { candles: PriceBar[]; timezone: string; session: string };
export type ReportCandlesData = { symbol: string; currency: string; timezone: string; priceUnit: string; priceDecimals?: number; allowVolume: boolean; series: Partial<Record<ReportCandleInterval, Series>> };
const intervals: ReportCandleInterval[] = ['1h', '4h', '1d', '1w'];
const memory = new Map<string, { value: ReportCandlesData; expires: number }>();
const pending = new Map<string, { promise: Promise<ReportCandlesData>; controller: AbortController; readers: number; settled: boolean }>();
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function timezone(value: unknown): string {
  if (typeof value === 'string') try { new Intl.DateTimeFormat('es-ES', { timeZone: value }); return value; } catch { /* UTC below. */ }
  return 'UTC';
}

export function parseReportCandles(raw: any, symbol: string): ReportCandlesData {
  if (typeof raw?.symbol !== 'string' || raw.symbol.toUpperCase() !== symbol) throw new Error('El histórico no corresponde al activo solicitado.');
  const series: ReportCandlesData['series'] = {};
  for (const interval of intervals) {
    const source = raw?.series?.[interval] ?? (interval === '4h' ? { candles: raw?.candles, timezone: raw?.timezone, session: raw?.session } : null);
    if (!Array.isArray(source?.candles)) continue;
    const unique = new Map<number, PriceBar>();
    for (const row of source.candles) {
      if (!row || ![row.time, row.open, row.high, row.low, row.close].every(finite) || row.time < 1e12 || row.low <= 0 || row.high < row.low || row.high < Math.max(row.open, row.close) || row.low > Math.min(row.open, row.close)) continue;
      unique.set(row.time, { time: row.time, open: row.open, high: row.high, low: row.low, close: row.close, volume: finite(row.volume) && row.volume >= 0 ? row.volume : null, ...(row.partial === true ? { partial: true } : {}) });
    }
    series[interval] = { candles: [...unique.values()].sort((a, b) => a.time - b.time), timezone: timezone(source.timezone || raw.timezone), session: typeof source.session === 'string' ? source.session : 'Histórico de negociación' };
  }
  if (!Object.values(series).some(value => value.candles.length >= 2)) throw new Error('No hay histórico de velas disponible.');
  const digits = raw.instrument?.priceDecimals;
  return { symbol, currency: typeof raw.currency === 'string' ? raw.currency : '', timezone: timezone(raw.timezone), priceUnit: typeof raw.instrument?.priceUnit === 'string' ? raw.instrument.priceUnit : '', ...(Number.isInteger(digits) && digits >= 0 && digits <= 8 ? { priceDecimals: digits } : {}), allowVolume: raw.instrument?.volumeUnit !== 'unavailable', series };
}

export function candleWindow(rows: PriceBar[], days: number): PriceBar[] {
  const end = rows.at(-1)?.time;
  return end == null ? [] : rows.filter(row => row.time >= end - days * 86400000);
}

export function reportCandlePeriods(rows: PriceBar[], interval: ReportCandleInterval): number[] {
  const days = rows.length > 1 ? (rows.at(-1)!.time - rows[0].time) / 86400000 : 0;
  const candidates = interval === '1w' ? [30, 90, 365, 730, 1825] : interval === '1d' ? [30, 90, 365, 730] : [30, 90];
  return candidates.filter(value => value === 30 || days >= value - Math.min(10, value * .15));
}

/** Subscriber-aware coalescing: switching panels does not leave abandoned requests. */
export function acquireReportCandles(symbol: string, force = false): { promise: Promise<ReportCandlesData>; release: () => void } {
  const cached = memory.get(symbol);
  if (!force && cached && cached.expires > Date.now()) return { promise: Promise.resolve(cached.value), release: () => {} };
  let entry = pending.get(symbol);
  if (!entry || entry.controller.signal.aborted) {
    const controller = new AbortController();
    const created = { controller, readers: 0, settled: false, promise: Promise.resolve(null as unknown as ReportCandlesData) };
    created.promise = authenticatedFetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-ticker`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ panel: 'assetCandles', subject: symbol }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]),
    }).then(async response => {
      if (!response.ok) throw new Error('No se ha podido cargar el histórico.');
      const value = parseReportCandles(await response.json(), symbol);
      if (!controller.signal.aborted) {
        if (memory.size >= 30) memory.delete(memory.keys().next().value!);
        memory.set(symbol, { value, expires: Date.now() + 120000 });
      }
      return value;
    }).finally(() => { created.settled = true; if (pending.get(symbol) === created) pending.delete(symbol); });
    pending.set(symbol, created); entry = created;
  }
  entry.readers++;
  let released = false;
  const current = entry;
  return { promise: current.promise, release: () => {
    if (released) return; released = true; current.readers--;
    // StrictMode reattaches synchronously; give that subscriber the same request.
    queueMicrotask(() => { if (!current.readers && !current.settled) current.controller.abort(); });
  } };
}
