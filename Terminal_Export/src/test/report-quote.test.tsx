import {act, cleanup, render, screen} from '@testing-library/react';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import ReportQuote, {reportQuoteRefreshDelay, reportQuoteTime} from '../components/ReportQuote';
import KeepPanel from '../components/KeepPanel';
import {authenticatedFetch} from '../lib/beta-api';
import type {RegularReportQuote} from '../../../supabase/functions/analyze-ticker/regular-quote';
vi.mock('../lib/beta-api', () => ({authenticatedFetch: vi.fn()}));
const request = vi.mocked(authenticatedFetch);
function quote(symbol: string, kind: RegularReportQuote['kind'] = 'regular'): RegularReportQuote {
  return {symbol, price: 110, previousClose: 100, change: 10, currency: 'EUR', timezone: 'Europe/Berlin', date: '2026-10-16', at: kind === 'regular' ? new Date(Date.now() - 5000).toISOString() : null, kind, sessionStart: '2026-10-16T08:00:00Z', sessionEnd: '2026-10-16T20:00:00Z', fetchedAt: new Date().toISOString(), nextRefreshAt: new Date(Date.now() + (kind === 'regular' ? 60000 : 900000)).toISOString()};
}
async function flush() {await act(async () => {await Promise.resolve(); await Promise.resolve();});}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime('2026-10-16T18:00:00Z'); request.mockReset();
  Object.defineProperty(document, 'visibilityState', {configurable: true, value: 'visible'});
  request.mockImplementation(async (_url, init) => Response.json(quote(JSON.parse(String(init?.body)).subject)));
});
afterEach(() => {cleanup(); vi.useRealTimers();});

it('shows one dated regular-session price and polls exactly every 60 seconds', async () => {
  render(<ReportQuote symbol="REGULAR_TEST"/>); await flush();
  expect(screen.getByText('110,00')).toBeVisible(); expect(screen.getByText('EUR')).toBeVisible();
  expect(screen.getByText(/Sesión regular/)).toBeVisible(); expect(request).toHaveBeenCalledTimes(1);
  await act(async () => {await vi.advanceTimersByTimeAsync(59999);}); expect(request).toHaveBeenCalledTimes(1);
  await act(async () => {await vi.advanceTimersByTimeAsync(1);}); expect(request).toHaveBeenCalledTimes(2);
  expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toEqual({panel: 'regularQuote', subject: 'REGULAR_TEST'});
});

it('shows the last close without pre/postmarket cards and does not poll every minute outside session', async () => {
  request.mockResolvedValue(Response.json(quote('CLOSE_TEST', 'close')));
  render(<ReportQuote symbol="CLOSE_TEST"/>); await flush();
  expect(screen.getByText(/Último cierre · 16 oct 2026/)).toBeVisible();
  expect(screen.queryByText(/PREMARKET|POSTMARKET|cada 60/)).toBeNull();
  await act(async () => {await vi.advanceTimersByTimeAsync(60000);}); expect(request).toHaveBeenCalledTimes(1);
});

it('pauses network calls while the document is hidden and refreshes when visible', async () => {
  render(<ReportQuote symbol="VISIBLE_TEST"/>); await flush();
  Object.defineProperty(document, 'visibilityState', {configurable: true, value: 'hidden'});
  act(() => {document.dispatchEvent(new Event('visibilitychange'));});
  await act(async () => {await vi.advanceTimersByTimeAsync(180000);}); expect(request).toHaveBeenCalledTimes(1);
  Object.defineProperty(document, 'visibilityState', {configurable: true, value: 'visible'});
  act(() => {document.dispatchEvent(new Event('visibilitychange'));}); await flush();
  expect(request).toHaveBeenCalledTimes(2);
});

it('stops polling when another terminal panel is selected and resumes only on return', async () => {
  const {rerender} = render(<KeepPanel active><ReportQuote symbol="PANEL_TEST"/></KeepPanel>); await flush();
  rerender(<KeepPanel active={false}><ReportQuote symbol="PANEL_TEST"/></KeepPanel>);
  await act(async () => {await vi.advanceTimersByTimeAsync(120000);}); expect(request).toHaveBeenCalledTimes(1);
  rerender(<KeepPanel active><ReportQuote symbol="PANEL_TEST"/></KeepPanel>); await flush();
  expect(request).toHaveBeenCalledTimes(2);
});

it('does not leak an old ticker price when a new ticker is loading', async () => {
  const {rerender} = render(<ReportQuote symbol="OLD_TEST"/>); await flush();
  request.mockImplementationOnce(() => new Promise(() => {}));
  rerender(<ReportQuote symbol="NEW_TEST"/>); await flush();
  expect(screen.queryByText('110,00')).toBeNull(); expect(screen.getByRole('status')).toHaveTextContent('Consultando cotización');
});

it('retains the dated last available quote on failure without calling it a current close after the bell', async () => {
  vi.setSystemTime('2026-10-16T19:59:50Z');
  const value = quote('BOUNDARY_TEST'); value.nextRefreshAt = '2026-10-16T20:00:01Z';
  request.mockResolvedValueOnce(Response.json(value)).mockRejectedValue(new Error('unavailable'));
  render(<ReportQuote symbol="BOUNDARY_TEST"/>); await flush();
  await act(async () => {await vi.advanceTimersByTimeAsync(11000);});
  expect(screen.getByText('110,00')).toBeVisible();
  expect(screen.queryByText(/Sesión regular|Último cierre/)).toBeNull();
  expect(screen.getByText(/Última cotización/)).toBeVisible();
  expect(screen.getByText('Actualización pendiente')).toBeVisible();
});

it('formats date-only closes without a timezone day shift and preserves the timestamp zone', () => {
  const close = {...quote('FORMAT_TEST', 'close'), timezone: 'America/New_York'};
  expect(reportQuoteTime(close)).toBe('16 oct 2026');
  const current = {...close, kind: 'regular' as const, at: '2026-10-16T18:00:00Z'};
  expect(reportQuoteTime(current)).toMatch(/14:00/);
  expect(reportQuoteRefreshDelay({...current, nextRefreshAt: 'invalid'})).toBe(60000);
  expect(reportQuoteRefreshDelay({...current, nextRefreshAt: new Date(Date.now() - 10000).toISOString()})).toBe(1000);
});
