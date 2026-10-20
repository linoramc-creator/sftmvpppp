import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import InteractivePriceChart from '../components/InteractivePriceChart';
import type { PriceBar } from '../lib/chart-indicators';

afterEach(() => cleanup());
const start = Date.parse('2026-10-01T12:00:00Z');
const history: PriceBar[] = Array.from({ length: 80 }, (_, i) => ({ time: start + i * 3600000, open: 100 + i, close: 101 + i, low: 98 + i, high: 103 + i, volume: 1000 + i }));
const common = { symbol: 'TEST', title: 'Pulso de la sesión', subtitle: 'USD', timezone: 'UTC', session: 'Sesión', intraday: true, datasetKey: 'test', allowVolume: true };

describe('consistent chart tools across clickable markets', () => {
  it('uses full historical warm-up for overlays and performs chart tools locally', () => {
    const request = vi.spyOn(globalThis, 'fetch');
    const { container } = render(<InteractivePriceChart {...common} candles={history.slice(-20)} history={history}/>);
    fireEvent.click(screen.getByRole('button', { name: 'SMA 50' }));
    expect(screen.getByLabelText('Valores de indicadores')).toHaveTextContent('155,50');
    expect(container.querySelector('[data-indicator="sma50"]')?.getAttribute('d')).toMatch(/^M/);
    fireEvent.click(screen.getByRole('button', { name: 'Evolución' }));
    expect(screen.getByTestId('price-line')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Escala del gráfico'), { target: { value: 'percent' } });
    expect(screen.getByText(/Base: cierre/)).toHaveTextContent('161,00');
    fireEvent.change(screen.getByLabelText('Escala del gráfico'), { target: { value: 'log' } });
    expect(screen.getByLabelText('Escala del gráfico')).toHaveValue('log');
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
    expect(request).not.toHaveBeenCalled(); request.mockRestore();
  });

  it('preserves five-decimal currency prices, omits unavailable volume and supports a real market modal', () => {
    const forex = history.map((c, i) => ({ ...c, open: 1.08 + i * .00001, high: 1.08004 + i * .00001, low: 1.07999 + i * .00001, close: 1.08002 + i * .00001 }));
    render(<InteractivePriceChart {...common} market symbol="EURUSD=X" priceDecimals={5} allowVolume={false} candles={forex}/>);
    expect(screen.getByLabelText('Cotización seleccionada en gráfico de mercado')).toHaveTextContent('1,08081');
    expect(screen.queryByRole('button', { name: 'Mostrar volumen' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Acercar gráfico de mercado' }));
    const chart = screen.getByRole('application');
    fireEvent.keyDown(chart, { key: 'Home' });
    expect(screen.getByRole('button', { name: 'Volver a las últimas velas' })).toBeVisible();
    expect(screen.getByTestId('market-pulse-crosshair')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Ampliar gráfico de mercado' }));
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).not.toBe('hidden');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Ampliar gráfico de mercado' }));
  });

  it('shows insufficient indicator history honestly and can hide real volume bars', () => {
    render(<InteractivePriceChart {...common} candles={history.slice(-5)}/>);
    fireEvent.click(screen.getByRole('button', { name: 'EMA 20' }));
    expect(screen.getByText('Requiere 20 velas')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Mostrar volumen' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar volumen' }));
    expect(screen.getByRole('button', { name: 'Mostrar volumen' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByText('VOLUMEN')).toBeNull();
  });
});
