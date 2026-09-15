import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOpinions, rating, recentPartnerships } from '../supabase/functions/analyze-ticker/editorial.ts';
import { cleanReportText, cleanHeadline } from '../Terminal_Export/src/lib/editorial.ts';
import { mergeGrowthSeries } from '../Terminal_Export/src/lib/revenue-growth.ts';

test('precise growth enriches the history without discarding older quarters or duplicating fiscal dates', () => {
  const rows = mergeGrowthSeries([{period:'2025-12-27', revenueGrowth:10}, {period:'2026-03-28', revenueGrowth:12}, {period:'2026-06-27', revenueGrowth:16}], [{period:'2026-03-31', revenueGrowth:null}, {period:'2026-06-30', revenueGrowth:16.3565}]);
  assert.equal(rows.length, 3); assert.equal(rows[0].revenueGrowth, 10); assert.equal(rows[1].revenueGrowth, 12); assert.equal(rows[2].revenueGrowth, 16.3565);
});

test('rating normalization never infers a recommendation from an ownership action', () => {
  assert.equal(rating('Outperform'), 'Comprar');
  assert.equal(rating('Equal-Weight'), 'Mantener');
  assert.equal(rating('Underperform'), 'Vender');
  assert.equal(rating('Increased position'), 'Sin calificar');
});
test('institution opinions preserve dates and do not turn a target into a buy rating', () => {
  const now = Date.parse('2026-09-15');
  const summary = { price: { currency: 'USD' }, upgradeDowngradeHistory: { history: [{ firm: 'J.P. Morgan', epochGradeDate: Date.parse('2026-09-10') / 1000, toGrade: 'Overweight', action: 'main' }] } };
  const rows = buildOpinions(summary, [{ gradingCompany: 'JPMorgan', date: '2026-09-01', newGrade: 'Neutral' }], [{ analystCompany: 'JPMorgan Securities', publishedDate: '2026-09-12', priceTarget: 300 }, { analystCompany: 'UBS', publishedDate: '2026-09-11', priceTarget: 210 }, { analystCompany: 'Old bank', publishedDate: '2024-01-01', priceTarget: 80 }], now);
  assert.equal(rows.length, 2);
  const jp = rows.find(r => r.recommendation === 'Comprar')!;
  assert.equal(jp.target, 300); assert.equal(jp.date, '2026-09-10'); assert.equal(jp.targetDate, '2026-09-12');
  assert.equal(rows.find(r => r.institution === 'UBS')?.recommendation, 'Sin calificar');
});
test('partnership window excludes old, undated, future and speculative stories', () => {
  const doc = { title: 'Apple announces partnership with Example', date: '2026-02-01', source: '', url: 'https://example.com' };
  const result = recentPartnerships([doc, { ...doc, date: '2024-02-01' }, { ...doc, date: '' }, { ...doc, date: '2027-01-01' }, { ...doc, title: 'Apple could partner with Example' }], Date.parse('2026-09-15'));
  assert.deepEqual(result, [doc]);
});
test('presentation removes providers and citations but retains facts and uncertainty', () => {
  const text = 'Los ingresos crecieron un 12% (Yahoo Finance).\nFuente: FMP\nLa estimación es de 20 millones. [1](https://example.com)\nCálculo determinista, no generado por IA.';
  const cleaned = cleanReportText(text);
  assert.ok(!/Yahoo|FMP|https|determinista|por IA/.test(cleaned));
  assert.ok(cleaned.includes('12%')); assert.ok(cleaned.includes('estimación'));
  assert.equal(cleanHeadline('Apple raises guidance - Reuters'), 'Apple raises guidance');
  assert.equal(cleanReportText('## Fuentes\n- Reuters\n- https://example.com\n## Negocio\nGemini es un producto de Google.'), '## Negocio\nGemini es un producto de Google.');
});
