import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import AssetContext from '../components/AssetContext';
import KeepPanel from '../components/KeepPanel';

const state = vi.hoisted(() => ({api: vi.fn(), account: 'owner'}));
vi.mock('@/lib/beta-api', () => ({authenticatedFetch: state.api}));
vi.mock('../components/AuthGate', () => ({useProfile: () => ({id: state.account})}));
vi.mock('../components/AssetRisk', () => ({default: ({data, error}: {data?: {asOf: string}; error: string}) => <div>{data?.asOf}{error && <p role="alert">{error}</p>}</div>}));

const context = (symbol: string, benchmark: string | null) => ({
  symbol, sector: null, benchmark, series: [], missing: [], events: [],
  risk: {currency: 'USD', history: [], percentiles: {}, asOf: `loaded-${symbol}-${benchmark ?? 'auto'}`},
  fetchedAt: new Date().toISOString(),
});

beforeEach(() => {
  state.account = 'owner';
  state.api.mockReset();
  state.api.mockImplementation(async (_url: string, init: RequestInit) => {
    const {subject, benchmark} = JSON.parse(String(init.body));
    return {ok: true, json: async () => context(subject, benchmark ?? null)};
  });
});
afterEach(() => {cleanup(); vi.restoreAllMocks();});

it('reuses bounded-lifetime market context on remount and scopes cache to the current account', async () => {
  const first = render(<AssetContext symbol="CONTEXT_CACHE"/>);
  await screen.findByText('loaded-CONTEXT_CACHE-auto');
  expect(state.api).toHaveBeenCalledTimes(1);
  first.unmount();
  const next = render(<AssetContext symbol="CONTEXT_CACHE"/>);
  await screen.findByText('loaded-CONTEXT_CACHE-auto');
  expect(state.api).toHaveBeenCalledTimes(1);
  state.account = 'another-account';
  next.rerender(<AssetContext symbol="CONTEXT_CACHE"/>);
  await waitFor(() => expect(state.api).toHaveBeenCalledTimes(2));
});

it('defers requests while hidden and retains the selected period and benchmark on return', async () => {
  const view = (active: boolean) => <KeepPanel active={active}><AssetContext symbol="CONTEXT_HIDDEN"/></KeepPanel>;
  const page = render(view(true));
  await screen.findByText('loaded-CONTEXT_HIDDEN-auto');
  fireEvent.click(screen.getByRole('button', {name: '6 MESES'}));
  page.rerender(view(false));
  fireEvent.change(screen.getByLabelText('Referencia sectorial'), {target: {value: 'XLK'}});
  await act(async () => {});
  expect(state.api).toHaveBeenCalledTimes(1);
  page.rerender(view(true));
  await screen.findByText('loaded-CONTEXT_HIDDEN-XLK');
  expect(state.api).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('button', {name: '6 MESES'})).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByLabelText('Referencia sectorial')).toHaveValue('XLK');
  page.rerender(view(false));
  page.rerender(view(true));
  await act(async () => {});
  expect(state.api).toHaveBeenCalledTimes(2);
});

it('fetches fresh context after five minutes instead of indefinitely retaining stale market data', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
  const first = render(<AssetContext symbol="CONTEXT_EXPIRES"/>);
  await screen.findByText('loaded-CONTEXT_EXPIRES-auto');
  first.unmount();
  now.mockReturnValue(1_800_000_300_001);
  render(<AssetContext symbol="CONTEXT_EXPIRES"/>);
  await screen.findByText('loaded-CONTEXT_EXPIRES-auto');
  expect(state.api).toHaveBeenCalledTimes(2);
});

it('does not cache an unauthorized response or render it as market context', async () => {
  state.api.mockResolvedValueOnce({ok: false, status: 403});
  const first = render(<AssetContext symbol="CONTEXT_DENIED"/>);
  await screen.findByRole('alert');
  first.unmount();
  render(<AssetContext symbol="CONTEXT_DENIED"/>);
  await screen.findByText('loaded-CONTEXT_DENIED-auto');
  expect(state.api).toHaveBeenCalledTimes(2);
});
