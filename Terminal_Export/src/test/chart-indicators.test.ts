import { describe, expect, it } from 'vitest';
import { aggregateChartBars, chartPriceDigits, chartScaleBounds, movingAverage, type PriceBar } from '../lib/chart-indicators';
const bars = (values: number[]): PriceBar[] => values.map((close, time) => ({ time, close, open: close, low: close, high: close, volume: null }));

describe('technical overlays', () => {
  it('aggregates actual intraday OHLC bars without inventing volume or completing an unfinished bar', () => {
    const input = bars([10, 12, 11, 15]).map((row, i) => ({ ...row, time: i * 300000, volume: i === 1 ? null : 100 }));
    const result = aggregateChartBars(input, 15);
    expect(result).toEqual([{ time: 0, open: 10, high: 12, low: 10, close: 11, volume: null, partial: false }, { time: 900000, open: 15, high: 15, low: 15, close: 15, volume: 100, partial: true }]);
    expect(aggregateChartBars(input, 5)).toEqual(input);
  });
  it('requires a complete warm-up and calculates simple and seeded exponential averages', () => {
    expect(movingAverage(bars([1, 2, 3, 4, 8]), 3)).toEqual([null, null, 2, 3, 5]);
    expect(movingAverage(bars([1, 2, 3, 4, 8]), 3, true)).toEqual([null, null, 2, 3, 5.5]);
    expect(movingAverage(bars([1, 2]), 3)).toEqual([null, null]);
  });
  it('restarts warm-up after a missing observation instead of drawing invented continuity', () => {
    expect(movingAverage(bars([1, 2, NaN, 4, 5, 6, 7]), 3)).toEqual([null, null, null, null, null, 5, 6]);
    expect(movingAverage(bars([1, 2, 3]), 0)).toEqual([null, null, null]);
  });
});

describe('multi-asset axes', () => {
  it('retains five-decimal FX precision and does not pad a tight currency range by a cent', () => {
    expect(chartPriceDigits('EURUSD=X', 1.08012)).toBe(5);
    expect(chartPriceDigits('JPY=X', 149.123)).toBe(3);
    const scale = chartScaleBounds(1.0801, 1.0803, 'linear');
    expect(scale.high - scale.low).toBeLessThan(.004);
  });
  it('maps equal percentage moves equally on logarithmic axes and handles nonpositive data safely', () => {
    const scale = chartScaleBounds(100, 400, 'log');
    expect(scale.transform(200) - scale.transform(100)).toBeCloseTo(scale.transform(400) - scale.transform(200));
    expect(scale.inverse(scale.transform(123.456))).toBeCloseTo(123.456);
    expect(chartScaleBounds(-1, 2, 'log').transform(-1)).toBe(-1);
  });
});
