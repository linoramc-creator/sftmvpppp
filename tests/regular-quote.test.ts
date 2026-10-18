import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeRegularQuote, regularReportQuote} from '../supabase/functions/analyze-ticker/regular-quote.ts';
const seconds = (date: string) => Date.parse(date) / 1000;
function fixture({at = '2026-10-16T18:00:00Z', price = 110, zone = 'America/New_York', currency = 'USD', start = '2026-10-16T13:30:00Z', end = '2026-10-16T20:00:00Z', times = ['2026-10-14T13:30:00Z', '2026-10-15T13:30:00Z', '2026-10-16T13:30:00Z'], closes = [95, 100, 110]} = {}) {
  return {chart: {result: [{meta: {symbol: 'SPY', currency, exchangeTimezoneName: zone, regularMarketTime: seconds(at), regularMarketPrice: price, preMarketPrice: 999, postMarketPrice: 888, currentTradingPeriod: {regular: {start: seconds(start), end: seconds(end)}}}, timestamp: times.map(seconds), indicators: {quote: [{close: closes}]}}]}};
}

test('regular report uses the real regular quote and completed prior close, refreshing every 60s', () => {
  const quote = normalizeRegularQuote('SPY', fixture(), Date.parse('2026-10-16T18:00:10Z'));
  assert.equal(quote.kind, 'regular'); assert.equal(quote.price, 110); assert.equal(quote.previousClose, 100);
  assert.ok(Math.abs(quote.change! - 10) < 1e-8); assert.equal(quote.at, '2026-10-16T18:00:00.000Z');
  assert.equal(quote.nextRefreshAt, '2026-10-16T18:01:10.000Z');
});

test('postmarket chooses the completed daily close, never the extended quote', () => {
  const raw = fixture({price: 109, at: '2026-10-16T19:59:55Z'});
  const quote = normalizeRegularQuote('SPY', raw, Date.parse('2026-10-16T21:00:00Z'));
  assert.equal(quote.kind, 'close'); assert.equal(quote.price, 110); assert.equal(quote.previousClose, 100);
  assert.equal(quote.date, '2026-10-16'); assert.equal(quote.at, null);
});

test('premarket and weekends preserve the last completed session and its own return', () => {
  const raw = fixture({start: '2026-10-19T13:30:00Z', end: '2026-10-19T20:00:00Z'});
  for (const now of ['2026-10-18T18:00:00Z', '2026-10-19T12:00:00Z']) {
    const quote = normalizeRegularQuote('SPY', raw, Date.parse(now));
    assert.equal(quote.kind, 'close'); assert.equal(quote.price, 110); assert.equal(quote.date, '2026-10-16');
    assert.equal(quote.previousClose, 100); assert.ok(Math.abs(quote.change! - 10) < 1e-8);
  }
});

test('scheduled hours on a holiday cannot turn a stale regular quote into an open market', () => {
  const raw = fixture({start: '2026-10-19T13:30:00Z', end: '2026-10-19T20:00:00Z'});
  const quote = normalizeRegularQuote('SPY', raw, Date.parse('2026-10-19T14:00:00Z'));
  assert.equal(quote.kind, 'close'); assert.equal(quote.price, 110); assert.equal(quote.date, '2026-10-16');
});

test('the exchange early close overrides regular US hours and ignores appended quote duplicates', () => {
  const raw = fixture({start: '2026-11-27T14:30:00Z', end: '2026-11-27T18:00:00Z', at: '2026-11-27T17:59:58Z', price: 104, times: ['2026-11-25T14:30:00Z', '2026-11-27T14:30:00Z', '2026-11-27T17:59:58Z'], closes: [100, 105, 104]});
  const quote = normalizeRegularQuote('SPY', raw, Date.parse('2026-11-27T18:01:00Z'));
  assert.equal(quote.kind, 'close'); assert.equal(quote.price, 105); assert.equal(quote.previousClose, 100);
});

test('foreign ETF session and currency remain exchange-specific across DST', () => {
  const raw = fixture({zone: 'Europe/Berlin', currency: 'EUR', start: '2026-10-26T08:00:00Z', end: '2026-10-26T16:30:00Z', at: '2026-10-26T10:00:00Z', price: 102, times: ['2026-10-23T07:00:00Z', '2026-10-26T08:00:00Z'], closes: [100, 999]});
  const quote = normalizeRegularQuote('VWCE.DE', raw, Date.parse('2026-10-26T10:00:10Z'));
  assert.equal(quote.kind, 'regular'); assert.equal(quote.price, 102); assert.equal(quote.previousClose, 100);
  assert.equal(quote.currency, 'EUR'); assert.equal(quote.timezone, 'Europe/Berlin');
});

test('a session beginning at UTC midnight retains the exchange trading date', () => {
  const raw = fixture({zone: 'Asia/Tokyo', currency: 'JPY', start: '2026-10-19T00:00:00Z', end: '2026-10-19T06:30:00Z', at: '2026-10-19T01:00:00Z', times: ['2026-10-16T00:00:00Z', '2026-10-19T00:00:00Z'], closes: [100, 110]});
  const quote = normalizeRegularQuote('1306.T', raw, Date.parse('2026-10-19T01:01:00Z'));
  assert.equal(quote.kind, 'regular'); assert.equal(quote.date, '2026-10-19'); assert.equal(quote.previousClose, 100);
});

test('missing currency, close or reference values are never fabricated', () => {
  const raw = fixture({currency: '', times: ['2026-10-16T13:30:00Z'], closes: [110]});
  const quote = normalizeRegularQuote('SPY', raw, Date.parse('2026-10-16T21:00:00Z'));
  assert.equal(quote.price, 110); assert.equal(quote.previousClose, null); assert.equal(quote.change, null); assert.equal(quote.currency, '');
  assert.equal(normalizeRegularQuote('SPY', fixture({zone: 'Invalid/Timezone'})).price, null);
  const absent = normalizeRegularQuote('SPY', null);
  assert.equal(absent.kind, 'unavailable'); assert.equal(absent.price, null);
});

test('a request near the close schedules the boundary rather than polling after it', () => {
  const quote = normalizeRegularQuote('SPY', fixture({at: '2026-10-16T19:59:50Z'}), Date.parse('2026-10-16T19:59:50Z'));
  assert.equal(quote.nextRefreshAt, '2026-10-16T20:00:01.000Z');
});

test('server cache coalesces requests and fetches a new daily candle at the closing boundary', async () => {
  const originalFetch = globalThis.fetch, originalNow = Date.now;
  let now = Date.parse('2026-10-16T19:59:50Z'), calls = 0;
  Date.now = () => now;
  globalThis.fetch = async () => {calls++; return Response.json(fixture({at: '2026-10-16T19:59:50Z', price: 109, closes: [95, 100, calls === 1 ? 109 : 110]}));};
  try {
    const [first, second] = await Promise.all([regularReportQuote('CACHE_TEST'), regularReportQuote('CACHE_TEST')]);
    assert.equal(calls, 1); assert.equal(first.kind, 'regular'); assert.equal(second.price, 109);
    now = Date.parse('2026-10-16T20:00:01Z');
    const close = await regularReportQuote('CACHE_TEST');
    assert.equal(calls, 2); assert.equal(close.kind, 'close'); assert.equal(close.price, 110);
    await regularReportQuote('CACHE_TEST'); assert.equal(calls, 2);
  } finally {globalThis.fetch = originalFetch; Date.now = originalNow;}
});
