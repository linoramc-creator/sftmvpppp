export type CandleViewport = { start: number; end: number };

export function boundViewport(total: number, start: number, count: number): CandleViewport {
  if (total <= 0) return { start: 0, end: 0 };
  const size = Math.max(1, Math.min(total, Math.round(count)));
  const first = Math.max(0, Math.min(total - size, Math.round(start)));
  return { start: first, end: first + size };
}

// The candle beneath the pointer remains anchored as the visible range changes.
export function zoomViewport(total: number, view: CandleViewport, factor: number, anchor = .5): CandleViewport {
  const ratio = Math.max(0, Math.min(1, anchor));
  const count = view.end - view.start;
  const nextCount = Math.max(Math.min(12, total), Math.min(total, Math.round(count / factor)));
  return boundViewport(total, view.start + count * ratio - nextCount * ratio, nextCount);
}

export function panViewport(total: number, view: CandleViewport, bars: number): CandleViewport {
  return boundViewport(total, view.start + bars, view.end - view.start);
}
