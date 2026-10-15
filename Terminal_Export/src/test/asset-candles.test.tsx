import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AssetCandles from '../components/AssetCandles';
import { boundViewport, panViewport, zoomViewport } from '../lib/candle-viewport';
import type { AssetSnapshot } from '../../../supabase/functions/analyze-ticker/asset-snapshot';

afterEach(() => cleanup());
const start = Date.parse('2026-10-01T12:00:00Z');
const candles = Array.from({ length: 100 }, (_, i) => ({ time: start + i * 3600000, open: 100 + i, close: 101 + i, low: 98 + i, high: 103 + i, volume: 1000 + i }));
const data: AssetSnapshot = { symbol: 'TEST', name: 'Test', description: '', currency: 'USD', exchange: 'NASDAQ', timezone: 'America/New_York', price: 200, change: 1, quoteAt: null, candles, session: 'Sesión de prueba', news: [], newsSince: '', fetchedAt: '', series: { '1d': { candles: candles.slice(0, 4), session: 'Sesión diaria', timezone: 'America/New_York' } } };

describe('bounded candle navigation', () => {
  it('keeps zoom anchored and panning within real available candles', () => {
    const anchorRight = zoomViewport(100, { start: 0, end: 100 }, 2, 1);
    expect(anchorRight).toEqual({ start: 50, end: 100 });
    expect(zoomViewport(100, { start: 0, end: 100 }, 2, 0)).toEqual({ start: 0, end: 50 });
    expect(panViewport(100, anchorRight, -500)).toEqual({ start: 0, end: 50 });
    expect(panViewport(100, anchorRight, 500)).toEqual({ start: 50, end: 100 });
    expect(zoomViewport(100, anchorRight, 50)).toEqual({ start: 69, end: 81 });
    expect(boundViewport(0, 100, 20)).toEqual({ start: 0, end: 0 });
    expect(zoomViewport(3, { start: 0, end: 3 }, 2)).toEqual({ start: 0, end: 3 });
  });
});

describe('professional candlestick interactions', () => {
  it('uses a single keyboard focus plot and clears thin crosshair on leave or blur', () => {
    const { container } = render(<AssetCandles data={data}/>);
    const plot = screen.getByRole('application');
    fireEvent.keyDown(plot, { key: 'ArrowLeft' });
    expect(screen.getByTestId('candle-crosshair')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-candle-time][tabindex]')).toHaveLength(0);
    expect(container.querySelector('[fill="#ffffff08"]')).toBeNull();
    fireEvent.pointerLeave(plot);
    expect(screen.queryByTestId('candle-crosshair')).not.toBeInTheDocument();
    fireEvent.keyDown(plot, { key: 'ArrowLeft' });
    expect(screen.getByTestId('candle-crosshair')).toBeInTheDocument();
    fireEvent.blur(plot);
    expect(screen.queryByTestId('candle-crosshair')).not.toBeInTheDocument();
    expect(plot.getAttribute('class')).not.toContain('min-w');
  });

  it('zooms, pans with keyboard, and restores latest real candle range without a request', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { container } = render(<AssetCandles data={data}/>);
    const count = () => container.querySelectorAll('[data-candle-time]').length;
    expect(count()).toBe(100);
    fireEvent.click(screen.getByRole('button', { name: 'Acercar velas' }));
    expect(count()).toBe(71);
    const plot = screen.getByRole('application');
    fireEvent.keyDown(plot, { key: 'Home' });
    expect(container.querySelector('[data-candle-time]')).toHaveAttribute('data-candle-time', String(start));
    expect(screen.getByRole('button', { name: 'Volver a las últimas velas' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Volver a las últimas velas' }));
    expect(container.querySelectorAll('[data-candle-time]').item(70)).toHaveAttribute('data-candle-time', String(candles[99].time));
    fireEvent.click(screen.getByRole('button', { name: 'Restablecer gráfico' }));
    expect(count()).toBe(100);
    fireEvent.click(screen.getByRole('button', { name: 'Velas 1 DÍA' }));
    expect(count()).toBe(4);
    expect(screen.queryByTestId('candle-crosshair')).not.toBeInTheDocument();
    expect(screen.getByText('Sesión diaria · 4 velas')).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('zooms around the pointer with wheel and clears hover after drag', () => {
    const original = window.PointerEvent;
    window.PointerEvent = MouseEvent as typeof PointerEvent;
    try {
      const { container } = render(<AssetCandles data={data}/>);
      const plot = screen.getByRole('application');
      vi.spyOn(plot, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 960, bottom: 390, width: 960, height: 390, toJSON: () => ({}) });
      fireEvent.pointerMove(plot, { clientX: 450, clientY: 150 });
      expect(screen.getByTestId('candle-crosshair')).toBeInTheDocument();
      fireEvent.wheel(plot, { clientX: 870, deltaY: -100 });
      expect(container.querySelectorAll('[data-candle-time]')).toHaveLength(83);
      expect(screen.queryByTestId('candle-crosshair')).not.toBeInTheDocument();
      fireEvent.pointerDown(plot, { button: 0, clientX: 450 });
      fireEvent.pointerMove(plot, { clientX: 900, clientY: 150 });
      fireEvent.pointerUp(plot, { clientX: 900 });
      expect(container.querySelector('[data-candle-time]')).toHaveAttribute('data-candle-time', String(start));
      expect(screen.queryByTestId('candle-crosshair')).not.toBeInTheDocument();
    } finally { window.PointerEvent = original; }
  });

  it('expands and restores body scrolling with Escape', () => {
    document.body.style.overflow = '';
    render(<AssetCandles data={data}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Ampliar gráfico' }));
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    expect(document.body.style.overflow).toBe('hidden');
    const plot = screen.getByRole('application');
    plot.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Velas 1H' }));
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(plot);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe('');
  });
});
