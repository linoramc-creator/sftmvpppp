import {regularSessionEnd} from './market-session.ts';

export type RegularReportQuote = {
  symbol: string;
  price: number | null;
  previousClose: number | null;
  change: number | null;
  currency: string;
  timezone: string;
  date: string | null;
  at: string | null;
  kind: 'regular' | 'close' | 'unavailable';
  sessionStart: string | null;
  sessionEnd: string | null;
  fetchedAt: string;
  nextRefreshAt: string;
};

const positive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
const localDate = (time: number, zone: string) => new Intl.DateTimeFormat('en-CA', {timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit'}).format(time);
const iso = (time: number | null) => time === null ? null : new Date(time).toISOString();

/** A daily candle's timestamp is its opening time, not a timestamp of its closing trade. */
export function normalizeRegularQuote(symbol: string, raw: any, now = Date.now()): RegularReportQuote {
  const chart = raw?.chart?.result?.[0], meta = chart?.meta ?? {};
  let timezone = typeof meta.exchangeTimezoneName === 'string' ? meta.exchangeTimezoneName : 'UTC';
  let validTimezone = typeof meta.exchangeTimezoneName === 'string';
  try { localDate(now, timezone); } catch { timezone = 'UTC'; validTimezone = false; }
  const day = (time: number) => localDate(time, timezone), today = day(now);
  const period = meta.currentTradingPeriod?.regular;
  const start = positive(period?.start) ? period.start * 1000 : null;
  const endSeconds = regularSessionEnd(meta, symbol), end = positive(endSeconds) ? endSeconds * 1000 : null;
  const validPeriod = start !== null && end !== null && end > start;
  const scheduledRegular = validPeriod && now >= start! && now < end!;
  const at = positive(meta.regularMarketTime) && meta.regularMarketTime * 1000 <= now + 60000 ? meta.regularMarketTime * 1000 : null;
  // Never use preMarketPrice/postMarketPrice, nor infer opening from a weekday/US clock.
  const currentRegular = scheduledRegular && at !== null && at >= start! && at < end! && positive(meta.regularMarketPrice);
  const closedToday = validPeriod && end! <= now && day(end!) === today;
  const candles = new Map<string, {date: string; price: number}>();
  const closes = chart?.indicators?.quote?.[0]?.close ?? [];
  for (let i = 0; i < (chart?.timestamp?.length ?? 0); i++) {
    const time = chart.timestamp[i] * 1000;
    if (!positive(time) || time > now || !positive(closes[i])) continue;
    const date = day(time);
    if (date > today || date === today && !closedToday) continue;
    // Some daily charts append a current quote. Keep the actual daily candle.
    if (!candles.has(date)) candles.set(date, {date, price: closes[i]});
  }
  const completed = [...candles.values()].sort((a, b) => a.date.localeCompare(b.date));
  const last = completed.at(-1), previous = completed.at(-2);
  let price: number | null = currentRegular ? meta.regularMarketPrice : last?.price ?? null;
  let date: string | null = currentRegular ? day(at!) : last?.date ?? null;
  let previousClose: number | null = currentRegular ? last?.price ?? null : previous?.price ?? null;
  // A malformed payload without exchange metadata cannot identify a session close safely.
  if (!chart || !validTimezone) { price = null; date = null; previousClose = null; }
  const kind: RegularReportQuote['kind'] = price === null ? 'unavailable' : currentRegular ? 'regular' : 'close';
  const refresh = scheduledRegular ? Math.min(now + 60000, end! + 1000)
    : validPeriod && start! > now ? Math.min(start! + 1000, now + 15 * 60000) : now + 15 * 60000;
  return {
    symbol, price, previousClose,
    change: price !== null && previousClose !== null ? (price / previousClose - 1) * 100 : null,
    currency: typeof meta.currency === 'string' ? meta.currency : '', timezone, date,
    at: kind === 'regular' ? iso(at) : null, kind,
    sessionStart: validPeriod ? iso(start) : null, sessionEnd: validPeriod ? iso(end) : null,
    fetchedAt: new Date(now).toISOString(), nextRefreshAt: new Date(refresh).toISOString(),
  };
}

// This cache is intentionally independent of AI/report generation. Store raw data
// so session selection is recalculated at request time, including the close boundary.
const cache = new Map<string, {raw: any; expires: number; boundary: number | null}>();
const pending = new Map<string, Promise<any>>();
export async function regularReportQuote(symbol: string): Promise<RegularReportQuote> {
  const now = Date.now(), hit = cache.get(symbol);
  const crossedBoundary = hit?.boundary !== null && hit?.boundary !== undefined && hit.boundary <= now;
  let raw = hit && hit.expires > now && !crossedBoundary ? hit.raw : null;
  if (!raw) {
    let request = pending.get(symbol);
    if (!request) {
      request = (async () => {
        try {
          const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1mo&interval=1d&includePrePost=false`, {headers: {'User-Agent': 'Mozilla/5.0'}, redirect: 'error', signal: AbortSignal.timeout(8000)});
          if (!response.ok) return null;
          const value = await response.json();
          if (!value?.chart?.result?.[0]) return null;
          const selected = normalizeRegularQuote(symbol, value), fetched = Date.now();
          const boundaries = [selected.sessionStart, selected.sessionEnd].map(t => t ? Date.parse(t) : 0).filter(t => t > fetched);
          if (cache.size >= 100) cache.delete(cache.keys().next().value!);
          const scheduled = selected.sessionStart && selected.sessionEnd && Date.parse(selected.sessionStart) <= fetched && Date.parse(selected.sessionEnd) > fetched;
          cache.set(symbol, {raw: value, expires: fetched + (scheduled ? 45000 : 5 * 60000), boundary: boundaries.length ? Math.min(...boundaries) : null});
          return value;
        } catch { return null; }
      })().finally(() => pending.delete(symbol));
      pending.set(symbol, request);
    }
    raw = await request;
  }
  // A failed refresh must not relabel a cached, still-forming candle as a close.
  return normalizeRegularQuote(symbol, raw, Date.now());
}
