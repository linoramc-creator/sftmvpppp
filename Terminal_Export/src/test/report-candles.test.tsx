import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InstrumentPriceChart } from '../components/charts/InstrumentPriceChart';
import { acquireReportCandles, candleWindow, parseReportCandles, reportCandlePeriods } from '../lib/report-candles';
import type { PriceBar } from '../lib/chart-indicators';

const request = vi.hoisted(() => vi.fn());
vi.mock('../lib/beta-api', () => ({ authenticatedFetch: request }));
afterEach(() => { cleanup(); request.mockReset(); });
const start = Date.parse('2026-07-01T13:30:00Z');
const rows: PriceBar[] = Array.from({ length: 95 }, (_, day) => day).filter(day => ![0, 6].includes(new Date(start + day * 86400000).getUTCDay())).flatMap(day => [0, 4].map(hour => ({ time: start + day * 86400000 + hour * 3600000, open: 100 + day, high: 103 + day, low: 98 + day, close: 101 + day, volume: 1000 + day })));
const fixture = (symbol: string, candles = rows) => ({ symbol, currency: 'USD', timezone: 'America/New_York', instrument: { volumeUnit: 'shares', priceDecimals: 2 }, series: { '4h': { candles, timezone: 'America/New_York', session: 'Sesión regular · última vela puede ser parcial' }, '1h': { candles, timezone: 'America/New_York', session: 'Sesión regular' }, '1d': { candles: candles.filter((_, i) => i % 2 === 0), timezone: 'America/New_York', session: 'Sesión regular' } } });
const response = (symbol: string, candles = rows) => ({ ok: true, json: async () => fixture(symbol, candles) });

describe('report candlestick history', () => {
  it('defaults to a month of real four-hour candles and supports longer views and local tools', async () => {
    request.mockResolvedValue(response('VRT'));
    const { container } = render(<InstrumentPriceChart ticker="VRT"/>);
    await screen.findByRole('application', { name: 'Velas japonesas 4H de VRT' });
    expect(request).toHaveBeenCalledTimes(1);
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ panel: 'assetCandles', subject: 'VRT' });
    expect(screen.getByRole('button', { name: 'Velas 4H' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Período 1 MES' })).toHaveAttribute('aria-pressed', 'true');
    const month = candleWindow(rows, 30);
    expect(month.length).toBeGreaterThan(40);
    expect(container.querySelectorAll('[data-candle-time]')).toHaveLength(month.length);
    expect(screen.queryByTestId('price-line')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Período 3 MESES' }));
    expect(container.querySelectorAll('[data-candle-time]')).toHaveLength(candleWindow(rows, 90).length);
    fireEvent.click(screen.getByRole('button', { name: 'Bandas Bollinger 20' }));
    expect(container.querySelectorAll('[data-bollinger]')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Acercar velas' }));
    expect(container.querySelectorAll('[data-candle-time]').length).toBeLessThan(candleWindow(rows, 90).length);
    expect(request).toHaveBeenCalledTimes(1);
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
  });

  it('does not advertise unavailable long history or synthesize four-hour candles from daily bars', async () => {
    const payload = fixture('IPO', rows.slice(-8));
    delete (payload.series as any)['4h'];
    request.mockResolvedValue({ ok: true, json: async () => payload });
    const { container } = render(<InstrumentPriceChart ticker="IPO"/>);
    await screen.findByText('No hay velas verificadas para este intervalo. Prueba otro intervalo o actualiza el histórico.');
    expect(screen.getByRole('button', { name: 'Velas 4H' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Período 3 MESES' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Velas 1 DÍA' }));
    expect(screen.getByRole('button', { name: 'Período 1 MES' })).toHaveAttribute('aria-pressed', 'true');
    expect(container.querySelectorAll('[data-candle-time]')).toHaveLength(4);
    expect(screen.getByText('Histórico limitado al período disponible')).toBeVisible();
  });

  it('provides a clean retry after a failed request and retains a valid chart when refresh fails', async () => {
    request.mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValueOnce(response('RETRY')).mockRejectedValueOnce(new Error('Unavailable'));
    render(<InstrumentPriceChart ticker="RETRY"/>);
    fireEvent.click(await screen.findByRole('button', { name: 'Reintentar histórico' }));
    await screen.findByRole('application');
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar histórico' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('application')).toBeVisible();
  });

  it('never displays the previous instrument during a ticker change or accepts an out-of-order response', async () => {
    let resolveFirst!: (value: unknown) => void;
    request.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; })).mockResolvedValueOnce(response('SECOND'));
    const { rerender } = render(<InstrumentPriceChart ticker="FIRST"/>);
    rerender(<InstrumentPriceChart ticker="SECOND"/>);
    await screen.findByRole('application', { name: 'Velas japonesas 4H de SECOND' });
    resolveFirst(response('FIRST'));
    await waitFor(() => expect(screen.queryByRole('application', { name: 'Velas japonesas 4H de FIRST' })).toBeNull());
  });
});

describe('bounded shared candle requests', () => {
  it('coalesces subscribers, cancels only after the final subscriber leaves and caches only successful data', async () => {
    let finish!: (value: unknown) => void;
    request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const first = acquireReportCandles('SHARED'), second = acquireReportCandles('SHARED');
    expect(request).toHaveBeenCalledTimes(1);
    const signal = request.mock.calls[0][1].signal;
    first.release(); await Promise.resolve();
    expect(signal.aborted).toBe(false);
    finish(response('SHARED')); await second.promise;
    second.release();
    await acquireReportCandles('SHARED').promise;
    expect(request).toHaveBeenCalledTimes(1);
    request.mockImplementationOnce((_url: string, init: RequestInit) => new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('Aborted')))));
    const abandoned = acquireReportCandles('ABANDONED');
    const rejected = expect(abandoned.promise).rejects.toThrow('Aborted');
    abandoned.release(); await rejected;
    expect(request.mock.calls[1][1].signal.aborted).toBe(true);
  });

  it('validates identity and OHLC shape, preserves precise values and never invents volume', () => {
    expect(() => parseReportCandles(fixture('OTHER'), 'FX')).toThrow();
    const precise = rows.slice(0, 2).map(row => ({ ...row, open: 1.08001, high: 1.08007, low: 1.08000, close: 1.08006, volume: null }));
    const payload = fixture('FX', [...precise, { ...precise[0], time: precise[0].time + 1, low: 999 }]);
    (payload.instrument as any).volumeUnit = 'unavailable';
    payload.instrument.priceDecimals = 5;
    const result = parseReportCandles(payload, 'FX');
    expect(result.series['4h']?.candles).toHaveLength(2);
    expect(result.series['4h']?.candles[0].close).toBe(1.08006);
    expect(result.series['4h']?.candles[0].volume).toBeNull();
    expect(result.allowVolume).toBe(false);
    expect(result.priceDecimals).toBe(5);
    expect(reportCandlePeriods(precise, '4h')).toEqual([30]);
  });
});
