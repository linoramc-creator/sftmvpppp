import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGrowthChartData, financialNumber } from '../Terminal_Export/src/lib/revenue-growth.ts';
import { curateNews, segmentPeriods, cached, bondsPanel, businessPanel, institutionalPanel, extractChannels } from '../supabase/functions/analyze-ticker/panels.ts';

test('growth matches prior fiscal year despite ordering and missing intervening quarters', () => {
  const result = buildGrowthChartData([
    { period: '2025-06-28', revenue: '$120M', revenueGrowth: 'N/D' },
    { period: '2024-06-29', revenue: '$100M', revenueGrowth: 'N/D' },
    { period: '2025-03-29', revenue: '$110M', revenueGrowth: 'N/D' },
  ]);
  assert.deepEqual(result.map(r => r.period), ['2024-06-29', '2025-03-29', '2025-06-28']);
  assert.equal(result[1].revenueGrowth, null);
  assert.ok(Math.abs(result[2].revenueGrowth! - 20) < 0.0001);
});
test('growth preserves zero and negative change and does not divide by zero', () => {
  const input = (revenue: string) => [{ period: '2024-03-31', revenue, revenueGrowth: 'N/D' }, { period: '2025-03-31', revenue: '$0', revenueGrowth: '+12%' }];
  assert.equal(buildGrowthChartData(input('$100'))[1].revenueGrowth, -100);
  assert.equal(buildGrowthChartData(input('$0'))[1].revenueGrowth, null);
  assert.equal(buildGrowthChartData([{ period: '2025-03-31', revenue: 'N/D', revenueGrowth: '0%' }])[0].revenueGrowth, 0);
  assert.equal(financialNumber(' $1,200.25 M '), 1200250000);
  assert.equal(financialNumber('N/D'), null);
});
test('growth rejects invalid periods, de-duplicates dates and parses provided percentages', () => {
  const result = buildGrowthChartData([{ period: 'bad', revenue: '$1', revenueGrowth: '1%' }, { period: '2025-03-31', revenue: 'N/D', revenueGrowth: 'N/D' }, { period: '2025-03-31', revenue: '$2B', revenueGrowth: '-3,5 %' }]);
  assert.equal(result.length, 1); assert.equal(result[0].revenueGrowth, -3.5);
});
test('news rejects stale, unrelated, promotional, unsafe and syndicated items', () => {
  const article = (title: string, url: string, date = '2026-09-14') => ({ title, url, date, source: 'test' });
  const result = curateNews([
    article('Apple earnings revenue beat expectations', 'https://a.example/news?utm=1'),
    article('Apple earnings revenue beat expectations again', 'https://b.example/news'),
    article('Microsoft revenue rises', 'https://c.example/news'),
    article('Apple stocks to buy now after earnings', 'https://d.example/news'),
    article('Apple new sales contract', 'https://e.example/news', '2025-01-01'),
    article('Apple dividend increases', 'javascript:alert(1)'),
    article('Apple wins regulatory approval', 'https://f.example/news'),
    article('Apple price update', 'https://g.example/news'),
  ], 'AAPL Apple', Date.parse('2026-09-15'));
  assert.equal(result.length, 2);
  assert.ok(result.every(r => r.url.startsWith('https:')));
});
test('news limit is a maximum, never padded with irrelevant articles', () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ title: `Apple ${'x'.repeat(i + 1)} revenue ${'y'.repeat(i + 1)}`, url: `https://example.com/${i}`, date: '2026-09-14', source: 'test' }));
  assert.ok(curateNews(rows, 'Apple', Date.parse('2026-09-15')).length <= 5);
  assert.deepEqual(curateNews(rows, 'Treasury', Date.parse('2026-09-15')), []);
});
test('news excludes passing mentions and repeated coverage of the same product launch', () => {
  const rows = [
    { title: 'Oracle revenue rises', excerpt: 'Apple also reported results.', url: 'https://example.com/1', source: 'test', date: '2026-09-14' },
    { title: 'Apple unveils new iPhone', excerpt: 'Apple announced a major product launch at its headquarters.', url: 'https://example.com/2', source: 'test', date: '2026-09-14' },
    { title: 'Analysts discuss Apple iPhone launch pricing', url: 'https://example.com/3', source: 'test', date: '2026-09-13' },
  ];
  const filtered = curateNews(rows, 'Apple AAPL', Date.parse('2026-09-15'));
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].url, rows[1].url);
});
test('segments exclude totals, preserve eliminations and require numeric reported values', () => {
  assert.deepEqual(segmentPeriods([{ date: '2025-09-30', reportedCurrency: 'USD', data: { Product: 90, Service: 20, Eliminations: -10, Total: 100, Unknown: 'N/D' } }]), [{ date: '2025-09-30', currency: 'USD', segments: [{ name: 'Product', value: 90 }, { name: 'Service', value: 20 }, { name: 'Eliminations', value: -10 }] }]);
  assert.deepEqual(segmentPeriods({ error: 'plan not available' }), []);
});
test('cache coalesces concurrent calls and retries failed requests', async () => {
  let calls = 0;
  const fn = async () => { calls++; return { value: 1 }; };
  const [a, b] = await Promise.all([cached('unit:coalesce', 10000, fn), cached('unit:coalesce', 10000, fn)]);
  assert.equal(calls, 1); assert.deepEqual(a, b);
  await assert.rejects(cached('unit:fail', 10000, async () => { throw new Error('failed'); }));
  assert.equal(await cached('unit:fail', 10000, async () => 'recovered'), 'recovered');
});
test('indirect distribution never becomes a direct sales channel', () => {
  const doc = { title: 'Report', date: '', source: 'SEC', url: 'https://sec.gov/report', excerpt: 'Revenue through indirect distribution channels.' };
  assert.equal(extractChannels([doc]).some(c => c.name === 'Venta directa'), false);
  assert.equal(extractChannels([{ ...doc, excerpt: 'Products are sold through retail and online stores and a direct sales force.' }]).length, 3);
});
test('panels return explicit missing data when providers fail, without fabricated numbers', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 503 });
  const env = { FMP_KEY: '', FRED_KEY: '', TAVILY_KEY: '', FINNHUB_KEY: '' };
  try {
    const bonds = await bondsPanel(env);
    assert.equal(bonds.etfs.length, 8);
    assert.ok(bonds.etfs.every(e => e.price === null && e.points.length === 0));
    assert.ok(bonds.series.every(s => s.points.length === 0));
    const deps = { summary: async () => null };
    const business = await businessPanel('TEST', env, deps);
    assert.deepEqual(business.products, []);
    const institutions = await institutionalPanel('TEST', env, deps);
    assert.equal(institutions.institutionalPct, null);
    assert.deepEqual(institutions.holders, []);
  } finally { globalThis.fetch = original; }
});
