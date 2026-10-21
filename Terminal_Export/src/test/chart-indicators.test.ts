import { describe, expect, it } from 'vitest';
import { aggregateChartBars, averageTrueRange, bollingerBands, chartPriceDigits, chartScaleBounds, movingAverage, type PriceBar } from '../lib/chart-indicators';
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
  it('uses the same full closing window for Bollinger bands and preserves narrow FX variance', () => {
    const points=bollingerBands(bars([1,2,3,4]),3);
    expect(points.slice(0,2)).toEqual([null,null]);
    expect(points[2]!.middle).toBe(2);
    expect(points[2]!.upper).toBeCloseTo(2+2*Math.sqrt(2/3));
    expect(points[3]!.lower).toBeCloseTo(3-2*Math.sqrt(2/3));
    const fx=bollingerBands(bars([1.08001,1.08002,1.08003]),3)[2]!;
    expect(fx.upper-fx.lower).toBeCloseTo(4*Math.sqrt(2/3)*.00001,10);
    expect(bollingerBands(bars([1,NaN,3]),3)).toEqual([null,null,null]);
  });
  it('seeds Wilder ATR with true ranges and includes gaps from the previous close', () => {
    const input=bars([10,12,16,15]).map((row,i)=>({...row,high:[11,13,17,16][i],low:[9,11,15,14][i]}));
    const atr=averageTrueRange(input,3);
    expect(atr.slice(0,2)).toEqual([null,null]);
    expect(atr[2]).toBeCloseTo((2+3+5)/3);
    expect(atr[3]).toBeCloseTo(((10/3)*2+2)/3);
    expect(averageTrueRange(bars([1,NaN,2,3]),2)).toEqual([null,null,null,.5]);
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
