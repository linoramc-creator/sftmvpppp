import {fireEvent, render, screen, within} from '@testing-library/react';
import {expect, it, vi} from 'vitest';
import AssetOverview, {assetQuoteTime, extendedQuoteTime} from '../components/AssetOverview';
import type {AssetSnapshot} from '../../../supabase/functions/analyze-ticker/asset-snapshot';

const snapshot: AssetSnapshot = {
  symbol: 'VST', name: 'Vistra Corp.', description: 'Generación y suministro de electricidad.',
  exchange: 'NYQ', currency: 'USD', price: 152.23, change: .29,
  timezone: 'America/New_York', quoteAt: '2026-10-15T17:11:24Z',
  candles: [], session: 'Sesión regular', news: [], newsSince: '2026-10-14T17:11:24Z', fetchedAt: '2026-10-15T17:11:24Z',
  extendedHours: {symbol: 'VST', currency: 'USD', fetchedAt: '2026-10-15T17:11:24Z', quotes: [
    {session: 'pre', price: 148.25, change: -2.35, date: '2026-10-15', at: '2026-10-15T13:29:57Z'},
    {session: 'post', price: 147.54, change: -2.8, date: '2026-10-14', at: null},
  ]},
};

it('keeps premarket and previous postmarket dates explicit and opens analysis', () => {
  const analyze = vi.fn();
  render(<AssetOverview symbol="VST" data={snapshot} onAnalyze={analyze}/>);
  expect(screen.getByRole('heading', {name: 'Vistra Corp.'})).toBeVisible();
  expect(screen.getByText('Generación y suministro de electricidad.')).toBeVisible();
  const hours = screen.getByLabelText('Negociación fuera de horario');
  expect(within(hours).getByText(/15 oct 2026 · 09:29 ET/)).toBeVisible();
  expect(within(hours).getByText(/14 oct 2026 · último precio de sesión/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', {name: 'Analizar VST'}));
  expect(analyze).toHaveBeenCalledOnce();
});

it('does not invent returns or an extended session when values are absent', () => {
  const {container} = render(<AssetOverview symbol="VST" data={{...snapshot, price: null, change: null, quoteAt: null, extendedHours: undefined}} onAnalyze={vi.fn()}/>);
  expect(screen.getByText('—')).toBeVisible();
  expect(container.textContent).not.toContain('%');
  expect(screen.queryByLabelText('Negociación fuera de horario')).toBeNull();
  expect(screen.queryByText(/Mercado abierto|En directo/)).toBeNull();
});

it('supports a loading snapshot without a large placeholder body or fake quote', () => {
  render(<AssetOverview symbol="VST" data={null} busy onAnalyze={vi.fn()}/>);
  expect(screen.getByRole('status')).toHaveTextContent('Actualizando…');
  expect(screen.getByLabelText('Resumen de VST')).toHaveAttribute('aria-busy', 'true');
  expect(screen.getByRole('button',{name:'Analizar VST'})).toBeDisabled();
  expect(screen.queryByRole('heading', {name: 'Actividad'})).toBeNull();
  expect(screen.getByText('—')).toBeVisible();
});

it('formats quote instants in the market zone and does not shift date-only sessions', () => {
  expect(assetQuoteTime('2026-10-15T01:15:00Z', 'America/New_York')).toBe('14 oct 2026 · 21:15 ET');
  expect(extendedQuoteTime({...snapshot.extendedHours!.quotes[1], date: '2026-10-14'})).toBe('14 oct 2026 · último precio de sesión');
  expect(assetQuoteTime('invalid')).toBeNull();
});
