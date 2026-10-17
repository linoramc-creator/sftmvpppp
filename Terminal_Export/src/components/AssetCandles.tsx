import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowRight, Maximize2, Minimize2, Minus, Plus, RotateCcw } from 'lucide-react';
import type { AssetSnapshot, Candle, CandleInterval } from '../../../supabase/functions/analyze-ticker/asset-snapshot';
import { boundViewport, panViewport, zoomViewport, type CandleViewport } from '@/lib/candle-viewport';

const intervals: Record<CandleInterval, string> = { '1h': '1H', '4h': '4H', '1d': '1 DÍA', '1w': '1 SEMANA' };
const rangeLabels: Record<number, string> = { 7: '1 SEM', 30: '1 MES', 90: '3 MESES', 365: '1 AÑO', 730: '2 AÑOS', 1825: '5 AÑOS' };
const format = (n: number | null | undefined, digits = 2) => n == null ? '—' : n.toLocaleString('es-ES', { maximumFractionDigits: digits, minimumFractionDigits: digits });
const volume = (n: number | null | undefined) => n == null ? '—' : n.toLocaleString('es-ES', { notation: 'compact', maximumFractionDigits: 1 });
const green = '#34d399', red = '#fb7185', blue = '#60a5fa';

export default function AssetCandles({ data }: { data: AssetSnapshot }) {
  const [interval, setInterval] = useState<CandleInterval>('4h');
  const [days, setDays] = useState(30);
  const [viewport, setViewport] = useState<CandleViewport | null>(null);
  const [hover, setHover] = useState<{ index: number; value: number } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [width, setWidth] = useState(960);
  const [dragging, setDragging] = useState(false);
  const holder = useRef<HTMLDivElement>(null);
  const section = useRef<HTMLElement>(null);
  const plot = useRef<SVGSVGElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ x: number; view: CandleViewport } | null>(null);
  const clip = `candles-${useId().replace(/:/g, '')}`;
  const helpId = `${clip}-help`;
  const source = data.series?.[interval] ?? { candles: interval === '4h' ? data.candles : [], timezone: data.timezone, session: data.session };
  const rows = useMemo(() => {
    const end = source.candles.at(-1)?.time ?? Date.now();
    return source.candles.filter(c => c.time >= end - days * 86400000);
  }, [source.candles, days]);
  const view = viewport ? boundViewport(rows.length, viewport.start, viewport.end - viewport.start) : { start: 0, end: rows.length };
  const shown = rows.slice(view.start, view.end);
  const selected = hover ? rows[hover.index] : shown.at(-1);
  const rangeOptions = interval === '1w' ? [365, 730, 1825] : interval === '1d' ? [90, 365, 730] : [7, 30];
  const hasVolume=data.instrument?.volumeUnit!=='unavailable'&&shown.some(c=>c.volume!==null&&c.volume>0);
  const chartHeight = expanded ? Math.max(360, Math.min(680, window.innerHeight - 265)) : width < 600 ? 330 : 390;
  const left = 12, right = Math.max(left + 60, width - 78), top = 22, bottom = Math.round(chartHeight * (hasVolume ? .67 : .85));
  const volumeTop = bottom + 29, volumeBottom = chartHeight - 37;
  const step = (right - left) / Math.max(1, shown.length);
  const candleWidth = Math.max(1, Math.min(13, step * .64));
  const minimum = shown.length ? Math.min(...shown.map(c => c.low)) : 0;
  const maximum = shown.length ? Math.max(...shown.map(c => c.high)) : 1;
  const padding = Math.max((maximum - minimum) * .1, maximum * .0015, .01);
  const low = minimum - padding, high = maximum + padding;
  const y = (value: number) => top + (high - value) / (high - low) * (bottom - top);
  const x = (index: number) => left + step * (index + .5);
  const maxVolume = Math.max(1, ...shown.map(c => c.volume ?? 0));
  const time = (timestamp: number, full = true) => new Date(timestamp).toLocaleString('es-ES', {
    timeZone: source.timezone || 'UTC', day: '2-digit', month: 'short',
    ...(days > 90 ? { year: '2-digit' as const } : {}),
    ...(full && (interval === '1h' || interval === '4h') ? { hour: '2-digit' as const, minute: '2-digit' as const } : {}),
  });
  const change = selected && selected.open !== 0 ? (selected.close / selected.open - 1) * 100 : null;

  useEffect(() => {
    const node = holder.current;
    if (!node) return;
    const measure = () => { if (node.clientWidth > 0) setWidth(Math.max(240, node.clientWidth)); };
    measure();
    if (typeof ResizeObserver === 'undefined') { window.addEventListener('resize', measure); return () => window.removeEventListener('resize', measure); }
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [expanded]);
  useEffect(() => {
    if (!expanded) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false);
      if (event.key !== 'Tab') return;
      const focusable = section.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]');
      if (!focusable?.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', escape);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', escape);
      expandButton.current?.focus();
    };
  }, [expanded]);

  const zoom = useCallback((factor: number, anchor = .5) => {
    setViewport(zoomViewport(rows.length, view, factor, anchor));
    setHover(null);
  }, [rows.length, view.start, view.end]);
  useEffect(() => {
    const node = plot.current;
    if (!node || !shown.length) return;
    const wheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) < .5) return;
      event.preventDefault();
      const rect = node.getBoundingClientRect();
      const point = (event.clientX - rect.left) / Math.max(1, rect.width) * width;
      zoom(event.deltaY < 0 ? 1.2 : 1 / 1.2, (point - left) / (right - left));
    };
    node.addEventListener('wheel', wheel, { passive: false });
    return () => node.removeEventListener('wheel', wheel);
  }, [zoom, shown.length, width, right]);

  const reset = () => { setViewport(null); setHover(null); };
  const movePointer = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = (event.clientX - rect.left) / Math.max(1, rect.width) * width;
    const py = (event.clientY - rect.top) / Math.max(1, rect.height) * chartHeight;
    if (drag.current) {
      const distance = (drag.current.x - event.clientX) / Math.max(1, rect.width) * width;
      setViewport(panViewport(rows.length, drag.current.view, distance / step));
      setHover(null);
      return;
    }
    if (px < left || px > right || py < top || py > volumeBottom) { setHover(null); return; }
    const index = view.start + Math.min(shown.length - 1, Math.max(0, Math.floor((px - left) / step)));
    const value = high - (Math.min(bottom, Math.max(top, py)) - top) / (bottom - top) * (high - low);
    setHover({ index, value });
  };
  const stopDragging = () => { drag.current = null; setDragging(false); setHover(null); };
  const keyboard = (event: React.KeyboardEvent<SVGSVGElement>) => {
    if (!shown.length) return;
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, (hover?.index ?? view.end - 1) + (event.key === 'ArrowLeft' ? -1 : 1)));
      if (next < view.start) setViewport(panViewport(rows.length, view, next - view.start));
      else if (next >= view.end) setViewport(panViewport(rows.length, view, next - view.end + 1));
      setHover({ index: next, value: rows[next].close });
    } else if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(1.4); }
    else if (event.key === '-') { event.preventDefault(); zoom(1 / 1.4); }
    else if (event.key === 'Escape') setHover(null);
  };
  const tickCount = width < 500 ? 3 : width < 850 ? 4 : 6;
  const tickIndices = [...new Set(Array.from({ length: Math.min(tickCount, shown.length) }, (_, i) => Math.round(i * (shown.length - 1) / Math.max(1, Math.min(tickCount, shown.length) - 1))))];
  const crossIndex = hover ? hover.index - view.start : -1;
  const crossVisible = crossIndex >= 0 && crossIndex < shown.length;
  const buttonClass = 'inline-flex h-8 items-center justify-center rounded-lg border border-slate-700/50 px-2.5 text-slate-400 transition-colors hover:border-slate-500 hover:bg-slate-800/80 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70 disabled:opacity-30';

  return <section ref={section} aria-label="Gráfico del activo" role={expanded ? 'dialog' : undefined} aria-modal={expanded || undefined} className={`${expanded ? 'fixed inset-2 z-50 overflow-y-auto shadow-2xl sm:inset-5' : 'relative'} rounded-2xl border border-slate-800 bg-[#0b111b] p-4 font-sans sm:p-5`}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-sm font-semibold tracking-wide text-slate-100">PRECIO · VELAS {intervals[interval]}</h2><p className="mt-1 text-xs text-slate-500">{data.symbol} <span className="mx-1.5 text-slate-700">/</span> {data.instrument?.priceUnit||data.currency} <span className="mx-1.5 text-slate-700">/</span> {source.timezone}</p></div>
      <div className="flex flex-wrap items-center gap-1.5"><div className="flex rounded-xl border border-slate-800 bg-slate-950/50 p-1">{(Object.keys(intervals) as CandleInterval[]).map(value => <button key={value} aria-label={`Velas ${intervals[value]}`} aria-pressed={interval === value} onClick={() => { setInterval(value); setDays(value === '1w' ? 1825 : value === '1d' ? 365 : 30); reset(); }} className={`rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-colors ${interval === value ? 'bg-blue-400/15 text-blue-300 shadow-sm' : 'text-slate-500 hover:bg-slate-800 hover:text-slate-200'}`}>{intervals[value]}</button>)}</div><button ref={expandButton} aria-label={expanded ? 'Reducir gráfico' : 'Ampliar gráfico'} aria-expanded={expanded} className={`${buttonClass} h-10 w-10 ml-1`} onClick={() => { setHover(null); setExpanded(value => !value); }}>{expanded ? <Minimize2 size={16}/> : <Maximize2 size={16}/>}</button></div>
    </div>
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3"><div className="flex gap-1">{rangeOptions.map(value => <button key={value} aria-label={`Período ${rangeLabels[value]}`} aria-pressed={days === value} className={`rounded-lg px-2.5 py-1.5 text-[10px] font-semibold transition-colors ${days === value ? 'bg-slate-800 text-slate-200' : 'text-slate-500 hover:bg-slate-800/60 hover:text-slate-300'}`} onClick={() => { setDays(value); reset(); }}>{rangeLabels[value]}</button>)}</div><div className="flex items-center gap-1.5"><button aria-label="Alejar velas" className={buttonClass} disabled={shown.length >= rows.length} onClick={() => zoom(1 / 1.4)}><Minus size={14}/></button><button aria-label="Acercar velas" className={buttonClass} disabled={shown.length <= Math.min(12, rows.length)} onClick={() => zoom(1.4)}><Plus size={14}/></button><button aria-label="Restablecer gráfico" className={buttonClass} disabled={!viewport} onClick={reset}><RotateCcw size={13}/></button>{view.end < rows.length && <button aria-label="Volver a las últimas velas" className={`${buttonClass} gap-1.5 text-[10px]`} onClick={() => { setViewport(boundViewport(rows.length, rows.length, shown.length)); setHover(null); }}>Últimas<ArrowRight size={12}/></button>}</div></div>
    {selected && <div aria-label="Datos de la vela seleccionada" className="mt-4 flex min-h-12 flex-wrap items-center gap-x-4 gap-y-2 text-[11px] tabular-nums"><span className="min-w-[130px] text-slate-500">{time(selected.time)}{selected.partial && <span className="ml-1.5 text-blue-300">Parcial</span>}</span>{[['A', selected.open], ['Máx', selected.high], ['Mín', selected.low], ['C', selected.close]].map(([label, value]) => <span key={label} className="text-slate-500">{label} <strong className="ml-1 font-medium text-slate-200">{format(value as number)}</strong></span>)}{change != null && <span className={change >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{change >= 0 ? '+' : ''}{format(change)}%</span>}{data.instrument?.volumeUnit!=='unavailable'&&<span className="text-slate-500">Vol. <strong className="ml-1 font-medium text-slate-300">{volume(selected.volume)}</strong></span>}</div>}
    <div ref={holder} className="mt-2 min-w-0">
      {shown.length ? <svg ref={plot} role="application" tabIndex={0} aria-label={`Velas japonesas ${intervals[interval]} de ${data.symbol}`} aria-describedby={helpId} viewBox={`0 0 ${width} ${chartHeight}`} style={{ width: '100%', height: chartHeight, touchAction: 'pan-y', cursor: dragging ? 'grabbing' : 'crosshair' }} className="block select-none rounded-xl outline-none focus-visible:ring-1 focus-visible:ring-blue-400/60" onPointerMove={movePointer} onPointerLeave={() => setHover(null)} onBlur={() => setHover(null)} onPointerDown={event => { if (event.button !== 0) return; event.currentTarget.focus({ preventScroll: true }); drag.current = { x: event.clientX, view }; setDragging(true); event.currentTarget.setPointerCapture?.(event.pointerId); }} onPointerUp={event => { stopDragging(); if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={stopDragging} onKeyDown={keyboard}>
        <defs><clipPath id={clip}><rect x={left} y={top} width={right - left} height={volumeBottom - top}/></clipPath></defs>
        {[0, .25, .5, .75, 1].map(fraction => { const value = low + (high - low) * fraction; return <g key={fraction}><line x1={left} x2={right} y1={y(value)} y2={y(value)} stroke="#233044" strokeWidth=".7" strokeDasharray="2 5"/><text x={right + 12} y={y(value) + 4} fill="#718096" fontSize="10">{format(value)}</text></g>; })}
        {hasVolume&&<><line x1={left} x2={right} y1={volumeTop - 12} y2={volumeTop - 12} stroke="#233044" strokeWidth=".7"/>
        <text x={left + 2} y={volumeTop - 18} fill="#718096" fontSize="9" letterSpacing="1.2">VOLUMEN</text><text x={right + 12} y={volumeTop + 5} fill="#718096" fontSize="9">{volume(maxVolume)}</text></>}
        <g clipPath={`url(#${clip})`} aria-hidden="true">{shown.map((candle: Candle, index) => { const color = candle.close >= candle.open ? green : red; return <g key={candle.time} data-candle-time={candle.time} opacity={candle.partial ? .68 : 1}><line x1={x(index)} x2={x(index)} y1={y(candle.high)} y2={y(candle.low)} stroke={color} strokeWidth="1"/><rect x={x(index) - candleWidth / 2} y={y(Math.max(candle.open, candle.close))} width={candleWidth} height={Math.max(1.25, Math.abs(y(candle.open) - y(candle.close)))} rx={Math.min(1, candleWidth / 4)} fill={color}/>{hasVolume && candle.volume != null && <rect x={x(index) - candleWidth / 2} y={volumeBottom - candle.volume / maxVolume * (volumeBottom - volumeTop)} width={candleWidth} height={candle.volume / maxVolume * (volumeBottom - volumeTop)} fill={color} opacity=".26"/>}</g>; })}</g>
        {shown.at(-1) && !crossVisible && <g aria-hidden="true"><line x1={left} x2={right} y1={y(shown.at(-1)!.close)} y2={y(shown.at(-1)!.close)} stroke={shown.at(-1)!.close >= shown.at(-1)!.open ? green : red} opacity=".35" strokeDasharray="4 5"/><rect x={right + 4} y={y(shown.at(-1)!.close) - 10} width={70} height={20} rx={4} fill={shown.at(-1)!.close >= shown.at(-1)!.open ? '#123c32' : '#44212e'}/><text x={right + 39} y={y(shown.at(-1)!.close) + 4} fill={shown.at(-1)!.close >= shown.at(-1)!.open ? green : red} fontSize="10" textAnchor="middle">{format(shown.at(-1)!.close)}</text></g>}
        {tickIndices.map(index => <text key={shown[index].time} x={Math.max(28, Math.min(right - 20, x(index)))} y={chartHeight - 15} fill="#718096" fontSize="10" textAnchor="middle">{time(shown[index].time, false)}</text>)}
        {crossVisible && hover && <g data-testid="candle-crosshair" pointerEvents="none" aria-hidden="true"><line x1={x(crossIndex)} x2={x(crossIndex)} y1={top} y2={volumeBottom} stroke={blue} strokeWidth=".8" strokeDasharray="3 4" opacity=".65"/><line x1={left} x2={right} y1={y(hover.value)} y2={y(hover.value)} stroke={blue} strokeWidth=".8" strokeDasharray="3 4" opacity=".65"/><rect x={right + 4} y={y(hover.value) - 10} width={70} height={20} rx={4} fill="#19304f"/><text x={right + 39} y={y(hover.value) + 4} fill="#bfdbfe" textAnchor="middle" fontSize="10">{format(hover.value)}</text><rect x={Math.max(left, Math.min(right - 120, x(crossIndex) - 60))} y={chartHeight - 31} width={120} height={23} rx={5} fill="#19304f"/><text x={Math.max(left + 60, Math.min(right - 60, x(crossIndex)))} y={chartHeight - 16} fill="#bfdbfe" textAnchor="middle" fontSize="10">{time(rows[hover.index].time)}</text></g>}
      </svg> : <p className="py-20 text-center text-sm text-slate-500">No hay velas disponibles para este intervalo en este momento.</p>}
    </div>
    <div className="mt-3 flex flex-wrap justify-between gap-x-5 gap-y-2 border-t border-slate-800/70 pt-3 text-[10px] leading-relaxed text-slate-500"><span>{source.session}{shown.length > 0 && ` · ${shown.length} velas`}</span><span aria-hidden="true" className="hidden sm:inline">Desliza para explorar · Rueda para ampliar</span></div><p id={helpId} className="sr-only">Gráfico interactivo. Usa las flechas izquierda y derecha para consultar velas, Inicio y Fin para ir a los extremos, más y menos para ampliar o reducir. Escape retira el cursor. También puedes arrastrar el gráfico y usar la rueda del ratón.</p>
  </section>;
}
