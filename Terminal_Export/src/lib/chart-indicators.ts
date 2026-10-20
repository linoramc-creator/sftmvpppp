export type PriceBar = { time: number; open: number; high: number; low: number; close: number; volume: number | null; partial?: boolean };
export type ChartIndicator = 'sma20' | 'sma50' | 'ema20';
export type ChartScale = 'linear' | 'log' | 'percent';

export const chartIndicators: Record<ChartIndicator, { label: string; color: string; period: number; exponential?: boolean }> = {
  sma20: { label: 'SMA 20', color: '#fbbf24', period: 20 },
  sma50: { label: 'SMA 50', color: '#a78bfa', period: 50 },
  ema20: { label: 'EMA 20', color: '#22d3ee', period: 20, exponential: true },
};

// Seed both averages with a full period. Calculate before cutting the viewport so
// moving or zooming the chart never changes an indicator's historical value.
export function movingAverage(rows: readonly PriceBar[], period: number, exponential = false): Array<number | null> {
  const result: Array<number | null> = Array(rows.length).fill(null);
  if (!Number.isInteger(period) || period < 1) return result;
  let sum = 0, previous: number | null = null, valid = 0;
  for (let i = 0; i < rows.length; i++) {
    const close = rows[i].close;
    if (!Number.isFinite(close)) { sum = 0; valid = 0; previous = null; continue; }
    sum += close;
    valid++;
    if (valid < period) continue;
    if (previous === null) previous = sum / period;
    else if (exponential) previous = close * (2 / (period + 1)) + previous * (1 - 2 / (period + 1));
    else {
      sum -= rows[i - period].close;
      previous = sum / period;
    }
    result[i] = previous;
  }
  return result;
}

export function chartPriceDigits(symbol: string, price: number): number {
  if (symbol.toUpperCase().endsWith('=X')) return price >= 20 ? 3 : 5;
  if (Math.abs(price) > 0 && Math.abs(price) < 1) return 5;
  return 2;
}

export function aggregateChartBars(rows: readonly PriceBar[], minutes: number, baseMinutes = 5): PriceBar[] {
  if (!rows.length || minutes <= baseMinutes) return [...rows];
  const duration = minutes * 60000, anchor = rows[0].time;
  const groups = new Map<number, PriceBar[]>();
  for (const row of rows) {
    const bucket = anchor + Math.floor((row.time - anchor) / duration) * duration;
    const group = groups.get(bucket) ?? []; group.push(row); groups.set(bucket, group);
  }
  return [...groups].map(([time, group]) => ({
    time, open: group[0].open, close: group.at(-1)!.close,
    high: Math.max(...group.map(row => row.high)), low: Math.min(...group.map(row => row.low)),
    volume: group.every(row => row.volume != null && row.volume >= 0) ? group.reduce((sum, row) => sum + row.volume!, 0) : null,
    partial: group.some(row => row.partial) || group.length < minutes / baseMinutes,
  }));
}

export function chartScaleBounds(minimum: number, maximum: number, mode: ChartScale) {
  const logarithmic = mode === 'log' && minimum > 0;
  const transform = (value: number) => logarithmic ? Math.log(Math.max(Number.MIN_VALUE, value)) : value;
  const inverse = (value: number) => logarithmic ? Math.exp(value) : value;
  const min = transform(minimum), max = transform(maximum);
  const padding = Math.max((max - min) * .1, logarithmic ? .000001 : Math.abs(maximum) * .00001 || .00001);
  return { low: min - padding, high: max + padding, transform, inverse };
}
