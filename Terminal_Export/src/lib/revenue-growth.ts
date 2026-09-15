import type { QuarterlyPeriod } from './analyze';

export function financialNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/[$€£\s]/g, '').replace(/,/g, '');
  const match = text.match(/^([+-]?\d+(?:\.\d+)?)([BMKT])?$/i);
  if (!match) return null;
  const multiplier = ({ K: 1e3, M: 1e6, B: 1e9, T: 1e12 } as Record<string, number>)[match[2]?.toUpperCase()] ?? 1;
  return Number(match[1]) * multiplier;
}

// Match fiscal year-end dates (including 52/53-week calendars), never array offsets.
export function buildGrowthChartData(data: Pick<QuarterlyPeriod, 'period' | 'revenue' | 'revenueGrowth'>[]) {
  const byDate = new Map<string, typeof data[number]>();
  for (const row of data) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.period) || !Number.isFinite(Date.parse(row.period)) || new Date(row.period).toISOString().slice(0, 10) !== row.period) continue;
    if (!byDate.has(row.period) || financialNumber(row.revenue) !== null) byDate.set(row.period, row);
  }
  const sorted = [...byDate.values()].sort((a, b) => a.period.localeCompare(b.period));
  return sorted.map(row => {
    const time = Date.parse(row.period);
    const candidates = sorted.filter(other => {
      const days = (time - Date.parse(other.period)) / 86400000;
      return days >= 350 && days <= 380;
    });
    const previous = candidates.sort((a, b) => Math.abs(time - Date.parse(a.period) - 365.25 * 86400000) - Math.abs(time - Date.parse(b.period) - 365.25 * 86400000))[0];
    const revenue = financialNumber(row.revenue);
    const base = previous ? financialNumber(previous.revenue) : null;
    const provided = typeof row.revenueGrowth === 'string' && /^[+-]?\d+(?:[.,]\d+)?\s*%$/.test(row.revenueGrowth.trim())
      ? Number(row.revenueGrowth.replace('%', '').replace(',', '.').trim()) : null;
    const revenueGrowth = revenue !== null && base !== null
      ? (base > 0 ? (revenue / base - 1) * 100 : null)
      : provided;
    // Exact dates avoid duplicate labels around fiscal quarter boundaries.
    return { period: row.period, revenueGrowth };
  });
}
