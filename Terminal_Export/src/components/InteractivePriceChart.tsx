import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, Download, Maximize2, Minimize2, Minus, Plus, RotateCcw } from 'lucide-react';
import { boundViewport, panViewport, zoomViewport, type CandleViewport } from '@/lib/candle-viewport';
import { averageTrueRange, bollingerBands, chartIndicators, chartPriceDigits, chartScaleBounds, movingAverage, type ChartIndicator, type ChartScale, type PriceBar } from '@/lib/chart-indicators';

type Props = {
  symbol: string; title: string; subtitle: ReactNode; candles: PriceBar[]; history?: PriceBar[];
  datasetKey: string; timezone: string; session: string; intervals?: ReactNode; periods?: ReactNode;
  volumeLabel?: string; allowVolume: boolean; priceDecimals?: number; intraday: boolean;
  market?: boolean; emptyText?: string;
};
const priceText = (value: number, digits: number) => value.toLocaleString('es-ES', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const compact = (value: number | null | undefined) => value == null ? '—' : value.toLocaleString('es-ES', { notation: 'compact', maximumFractionDigits: 1 });
const green = '#34d399', red = '#fb7185', blue = '#60a5fa';
const buttonClass = 'inline-flex h-8 items-center justify-center rounded-lg border border-slate-700/50 px-2.5 text-slate-400 transition-colors hover:border-slate-500 hover:bg-slate-800/80 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70 disabled:opacity-30';

export default function InteractivePriceChart({ symbol, title, subtitle, candles: rows, history, datasetKey, timezone, session, intervals, periods, volumeLabel = 'VOLUMEN', allowVolume, priceDecimals, intraday, market = false, emptyText = 'No hay velas disponibles para este intervalo en este momento.' }: Props) {
  const [viewport, setViewport] = useState<CandleViewport | null>(null);
  const [hover, setHover] = useState<{ index: number; value: number | null } | null>(null);
  const [expanded, setExpanded] = useState(false), [width, setWidth] = useState(960), [dragging, setDragging] = useState(false);
  const [style, setStyle] = useState<'candles' | 'line'>('candles');
  const [scale, setScale] = useState<ChartScale>('linear');
  const [indicators, setIndicators] = useState<ChartIndicator[]>([]), [volumeVisible, setVolumeVisible] = useState(true);
  const [bandsVisible, setBandsVisible] = useState(false);
  const holder = useRef<HTMLDivElement>(null), section = useRef<HTMLElement>(null), plot = useRef<SVGSVGElement>(null), expandButton = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ x: number; view: CandleViewport } | null>(null);
  const clip = `candles-${useId().replace(/:/g, '')}`, helpId = `${clip}-help`;
  const view = viewport ? boundViewport(rows.length, viewport.start, viewport.end - viewport.start) : { start: 0, end: rows.length };
  const shown = rows.slice(view.start, view.end), selected = hover ? rows[hover.index] : shown.at(-1);
  const hasVolume = volumeVisible && allowVolume && shown.some(c => c.volume != null && c.volume > 0);
  const decimals = priceDecimals ?? chartPriceDigits(symbol, selected?.close ?? 1);
  const format = (value: number) => priceText(value, decimals);
  const chartHeight = expanded ? market ? 550 : Math.max(360, Math.min(680, window.innerHeight - 320)) : width < 600 ? 330 : 390;
  const left = 12, right = Math.max(left + 60, width - (decimals > 3 ? 92 : 82)), top = 22, bottom = Math.round(chartHeight * (hasVolume ? .67 : .85));
  const volumeTop = bottom + 29, volumeBottom = chartHeight - 37, step = (right - left) / Math.max(1, shown.length), candleWidth = Math.max(1, Math.min(13, step * .64));
  const averages = useMemo(() => {
    const source = history ?? rows, byTime = new Map(source.map((c, i) => [c.time, i]));
    return Object.fromEntries(indicators.map(key => {
      const setting = chartIndicators[key], values = movingAverage(source, setting.period, setting.exponential);
      return [key, rows.map(c => values[byTime.get(c.time) ?? -1] ?? null)];
    })) as Partial<Record<ChartIndicator, Array<number | null>>>;
  }, [history, rows, indicators]);
  const technical = useMemo(() => {
    const source = history ?? rows, byTime = new Map(source.map((c, i) => [c.time, i]));
    const bands = bandsVisible ? bollingerBands(source) : [], atr = averageTrueRange(source);
    return { bands: rows.map(c => bands[byTime.get(c.time) ?? -1] ?? null), atr: rows.map(c => atr[byTime.get(c.time) ?? -1] ?? null) };
  }, [history, rows, bandsVisible]);
  const extraValues = [...indicators.flatMap(key => (averages[key] ?? []).slice(view.start, view.end).filter((v): v is number => v != null && Number.isFinite(v))), ...technical.bands.slice(view.start, view.end).flatMap(point => point ? [point.lower, point.upper] : [])];
  const hasPositivePrices = rows.length > 0 && rows.every(c => c.low > 0) && extraValues.every(value => value > 0);
  const effectiveScale = scale === 'log' && !hasPositivePrices ? 'linear' : scale;
  const minimum = shown.length ? Math.min(...shown.map(c => c.low), ...extraValues) : 0, maximum = shown.length ? Math.max(...shown.map(c => c.high), ...extraValues) : 1;
  const bounds = chartScaleBounds(minimum, maximum, effectiveScale), { low, high, transform, inverse } = bounds;
  const y = (value: number) => top + (high - transform(value)) / (high - low) * (bottom - top), x = (index: number) => left + step * (index + .5);
  const base = rows[0]?.close ?? 0;
  const axisText = (value: number) => effectiveScale === 'percent' && base !== 0 ? `${priceText((value / base - 1) * 100, 2)}%` : format(value);
  const maxVolume = Math.max(1, ...shown.map(c => c.volume ?? 0));
  const time = (timestamp: number, full = true) => new Date(timestamp).toLocaleString('es-ES', { timeZone: timezone || 'UTC', day: '2-digit', month: 'short', ...(rows.length && rows.at(-1)!.time - rows[0].time > 90 * 86400000 ? { year: '2-digit' as const } : {}), ...(full && intraday ? { hour: '2-digit' as const, minute: '2-digit' as const } : {}) });
  const change = selected && selected.open !== 0 ? (selected.close / selected.open - 1) * 100 : null;
  const reset = () => { setViewport(null); setHover(null); drag.current = null; setDragging(false); };
  useEffect(reset, [datasetKey]);
  useEffect(() => {
    const node = holder.current;
    if (!node) return;
    const measure = () => { if (node.clientWidth > 0) setWidth(Math.max(240, node.clientWidth)); };
    measure();
    if (typeof ResizeObserver === 'undefined') { window.addEventListener('resize', measure); return () => window.removeEventListener('resize', measure); }
    const observer = new ResizeObserver(measure); observer.observe(node); return () => observer.disconnect();
  }, [expanded]);
  useEffect(() => {
    if (!expanded) return;
    const previous = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false);
      if (event.key !== 'Tab') return;
      const focusable = section.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), [tabindex="0"]');
      if (!focusable?.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    section.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
    document.addEventListener('keydown', escape);
    return () => { document.body.style.overflow = previous; document.removeEventListener('keydown', escape); expandButton.current?.focus(); };
  }, [expanded]);
  const zoom = useCallback((factor: number, anchor = .5) => { setViewport(zoomViewport(rows.length, view, factor, anchor)); setHover(null); }, [rows.length, view.start, view.end]);
  useEffect(() => {
    const node = plot.current; if (!node || !shown.length) return;
    const wheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) < .5) return;
      event.preventDefault();
      const rect = node.getBoundingClientRect(), point = (event.clientX - rect.left) / Math.max(1, rect.width) * width;
      zoom(event.deltaY < 0 ? 1.2 : 1 / 1.2, (point - left) / (right - left));
    };
    node.addEventListener('wheel', wheel, { passive: false }); return () => node.removeEventListener('wheel', wheel);
  }, [zoom, shown.length, width, right]);
  const movePointer = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect(), px = (event.clientX - rect.left) / Math.max(1, rect.width) * width, py = (event.clientY - rect.top) / Math.max(1, rect.height) * chartHeight;
    if (drag.current) { setViewport(panViewport(rows.length, drag.current.view, (drag.current.x - event.clientX) / Math.max(1, rect.width) * width / step)); setHover(null); return; }
    if (px < left || px > right || py < top || py > volumeBottom) { setHover(null); return; }
    setHover({ index: view.start + Math.min(shown.length - 1, Math.max(0, Math.floor((px - left) / step))), value: py > bottom ? null : inverse(high - (Math.min(bottom, Math.max(top, py)) - top) / (bottom - top) * (high - low)) });
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
  const tickCount = width < 500 ? 3 : width < 850 ? 4 : 6, tickIndices = [...new Set(Array.from({ length: Math.min(tickCount, shown.length) }, (_, i) => Math.round(i * (shown.length - 1) / Math.max(1, Math.min(tickCount, shown.length) - 1))))];
  const crossIndex = hover ? hover.index - view.start : -1, crossVisible = crossIndex >= 0 && crossIndex < shown.length;
  const path = (values: Array<number | null>) => { let drawing = false; return values.map((value, index) => { if (value == null) { drawing = false; return ''; } const command = drawing ? 'L' : 'M'; drawing = true; return `${command}${x(index)},${y(value)}`; }).join(' '); };
  const download = () => {
    if (!plot.current) return;
    const copy = plot.current.cloneNode(true) as SVGSVGElement; copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); copy.setAttribute('width', String(width)); copy.setAttribute('height', String(chartHeight)); copy.style.background = '#0b111b';
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `${symbol.replace(/[^A-Za-z0-9_-]/g, '-')}-${new Date().toISOString().slice(0, 10)}.svg`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const indicatorValue = (key: ChartIndicator) => averages[key]?.[hover?.index ?? view.end - 1];
  const selectedBands = technical.bands[hover?.index ?? view.end - 1];
  const selectedAtr = technical.atr[hover?.index ?? view.end - 1];
  const visibleReturn = shown.length > 1 && shown[0].close !== 0 ? (shown.at(-1)!.close / shown[0].close - 1) * 100 : null;
  const clockTick = intraday && shown.length > 0 && shown.at(-1)!.time - shown[0].time < 36 * 3600000;

  return <section ref={section} aria-label={market ? 'Gráfico de contexto de mercado' : 'Gráfico del activo'} role={expanded ? 'dialog' : undefined} aria-modal={expanded || undefined} className={`${expanded ? 'fixed inset-2 z-50 overflow-y-auto shadow-2xl sm:inset-5' : 'relative'} min-w-0 rounded-2xl border border-slate-800 bg-[#0b111b] p-4 font-sans sm:p-5`}>
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold tracking-wide text-slate-100">{title}</h2><p className="mt-1 text-xs text-slate-500">{subtitle}</p></div><div className="flex flex-wrap items-center gap-1.5">{intervals}<button ref={expandButton} aria-label={market ? expanded ? 'Reducir gráfico de mercado' : 'Ampliar gráfico de mercado' : expanded ? 'Reducir gráfico' : 'Ampliar gráfico'} aria-expanded={expanded} className={`${buttonClass} ml-1 h-10 w-10`} onClick={() => { setHover(null); setExpanded(value => !value); }}>{expanded ? <Minimize2 size={16}/> : <Maximize2 size={16}/>}</button></div></div>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3"><div className="flex flex-wrap items-center gap-3">{periods}<div className="flex gap-1 rounded-lg bg-slate-950/60 p-1">{(['candles', 'line'] as const).map(value => <button key={value} aria-pressed={style === value} onClick={() => setStyle(value)} className={`rounded-md px-2.5 py-1.5 text-[10px] font-medium ${style === value ? 'bg-blue-400/15 text-blue-300' : 'text-slate-500 hover:text-slate-200'}`}>{value === 'candles' ? 'Velas' : 'Evolución'}</button>)}</div></div><div className="flex items-center gap-1.5"><button aria-label={market ? 'Alejar gráfico de mercado' : 'Alejar velas'} className={buttonClass} disabled={shown.length >= rows.length} onClick={() => zoom(1 / 1.4)}><Minus size={14}/></button><button aria-label={market ? 'Acercar gráfico de mercado' : 'Acercar velas'} className={buttonClass} disabled={shown.length <= Math.min(12, rows.length)} onClick={() => zoom(1.4)}><Plus size={14}/></button><button aria-label={market ? 'Restablecer gráfico de mercado' : 'Restablecer gráfico'} className={buttonClass} disabled={!viewport} onClick={reset}><RotateCcw size={13}/></button>{view.end < rows.length && <button aria-label="Volver a las últimas velas" className={`${buttonClass} gap-1.5 text-[10px]`} onClick={() => { setViewport(boundViewport(rows.length, rows.length, shown.length)); setHover(null); }}>Últimas<ArrowRight size={12}/></button>}<button aria-label="Descargar gráfico" title="Descargar gráfico SVG" disabled={!shown.length} className={buttonClass} onClick={download}><Download size={13}/></button></div></div>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><div aria-label="Indicadores técnicos" className="flex flex-wrap items-center gap-1.5">{(Object.keys(chartIndicators) as ChartIndicator[]).map(key => <button key={key} aria-pressed={indicators.includes(key)} title={`${key.startsWith('ema') ? 'Media exponencial' : 'Media simple'} de ${chartIndicators[key].period} velas`} onClick={() => setIndicators(current => current.includes(key) ? current.filter(i => i !== key) : [...current, key])} className={`${buttonClass} gap-1.5 text-[10px] ${indicators.includes(key) ? 'border-blue-400/40 bg-blue-400/5 text-slate-100' : ''}`}><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ background: chartIndicators[key].color }}/>{chartIndicators[key].label}</button>)}<button aria-label="Bandas Bollinger 20" aria-pressed={bandsVisible} title="Media de 20 cierres y bandas de dos desviaciones típicas; calculadas sobre las velas del intervalo seleccionado." onClick={() => setBandsVisible(value => !value)} className={`${buttonClass} gap-1.5 text-[10px] ${bandsVisible ? 'border-blue-400/40 bg-blue-400/5 text-slate-100' : ''}`}><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-sky-400"/>BB 20 · 2σ</button>{allowVolume && rows.some(c => c.volume != null && c.volume > 0) && <button aria-label="Mostrar volumen" aria-pressed={volumeVisible} className={`${buttonClass} text-[10px] ${volumeVisible ? 'text-blue-300' : ''}`} onClick={() => setVolumeVisible(value => !value)}>Volumen</button>}</div><label className="flex items-center gap-2 text-[10px] text-slate-500">Escala<select aria-label="Escala del gráfico" value={effectiveScale} onChange={event => { setScale(event.target.value as ChartScale); setHover(null); }} className="h-8 rounded-lg border border-slate-700/50 bg-[#0b111b] px-2 text-slate-300 outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70"><option value="linear">Lineal</option><option value="log" disabled={!hasPositivePrices}>Logarítmica</option><option value="percent" disabled={!base}>Variación %</option></select></label></div>
    {selected && <div aria-label={market ? 'Cotización seleccionada en gráfico de mercado' : 'Datos de la vela seleccionada'} className="mt-4 flex min-h-12 flex-wrap items-center gap-x-4 gap-y-2 text-[11px] tabular-nums"><span className="min-w-[130px] text-slate-500">{time(selected.time)}{selected.partial && <span className="ml-1.5 text-blue-300">Parcial</span>}</span>{[['A', selected.open], ['Máx', selected.high], ['Mín', selected.low], ['C', selected.close]].map(([label, value]) => <span key={label} className="text-slate-500">{label} <strong className="ml-1 font-medium text-slate-200">{format(value as number)}</strong></span>)}{change != null && <span className={change >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{change >= 0 ? '+' : ''}{priceText(change, 2)}%</span>}{allowVolume && <span className="text-slate-500">Vol. <strong className="ml-1 font-medium text-slate-300">{compact(selected.volume)}</strong></span>}</div>}
    {indicators.length > 0 && <div aria-label="Valores de indicadores" className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] tabular-nums">{indicators.map(key => <span key={key} style={{ color: chartIndicators[key].color }}>{chartIndicators[key].label} <span className="ml-1">{indicatorValue(key) == null ? `Requiere ${chartIndicators[key].period} velas` : format(indicatorValue(key)!)}</span></span>)}</div>}
    {bandsVisible && <p aria-label="Valores Bollinger" className="mt-2 text-[10px] tabular-nums text-sky-300/80">{selectedBands ? `BB 20 · Inferior ${format(selectedBands.lower)} · Media ${format(selectedBands.middle)} · Superior ${format(selectedBands.upper)}` : 'Bollinger: requiere 20 velas'}</p>}
    {scale === 'log' && effectiveScale !== 'log' && <p className="mt-2 text-[10px] text-slate-500">Escala lineal: hay precios o bandas que no son positivos.</p>}
    {effectiveScale === 'percent' && base !== 0 && <p className="mt-2 text-[10px] text-slate-500">Base: cierre de {time(rows[0].time)} · {format(base)}</p>}
    <div ref={holder} className="mt-2 min-w-0">{shown.length ? <svg ref={plot} role="application" tabIndex={0} aria-label={market ? `Gráfico interactivo de ${symbol}` : `Velas japonesas ${title.split('VELAS ')[1] ?? ''} de ${symbol}`} aria-describedby={helpId} viewBox={`0 0 ${width} ${chartHeight}`} style={{ width: '100%', height: chartHeight, touchAction: 'pan-y', cursor: dragging ? 'grabbing' : 'crosshair' }} className="block select-none rounded-xl outline-none focus-visible:ring-1 focus-visible:ring-blue-400/60" onPointerMove={movePointer} onPointerLeave={() => setHover(null)} onBlur={() => setHover(null)} onDoubleClick={reset} onPointerDown={event => { if (event.button !== 0) return; event.currentTarget.focus({ preventScroll: true }); drag.current = { x: event.clientX, view }; setDragging(true); event.currentTarget.setPointerCapture?.(event.pointerId); }} onPointerUp={event => { stopDragging(); if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={stopDragging} onKeyDown={keyboard}>
      <defs><clipPath id={clip}><rect x={left} y={top} width={right - left} height={volumeBottom - top}/></clipPath><linearGradient id={`${clip}-area`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={blue} stopOpacity=".14"/><stop offset="100%" stopColor={blue} stopOpacity="0"/></linearGradient></defs>
      {[0, .25, .5, .75, 1].map(fraction => { const value = inverse(low + (high - low) * fraction); return <g key={fraction}><line x1={left} x2={right} y1={y(value)} y2={y(value)} stroke="#233044" strokeWidth=".7" strokeDasharray="2 5"/><text x={right + 10} y={y(value) + 4} fill="#718096" fontSize="10">{axisText(value)}</text></g>; })}
      {hasVolume && <><line x1={left} x2={right} y1={volumeTop - 12} y2={volumeTop - 12} stroke="#233044" strokeWidth=".7"/><text x={left + 2} y={volumeTop - 18} fill="#718096" fontSize="9" letterSpacing="1.2">{volumeLabel}</text><text x={right + 10} y={volumeTop + 5} fill="#718096" fontSize="9">{compact(maxVolume)}</text></>}
      <g clipPath={`url(#${clip})`} aria-hidden="true">{style === 'line' && <><path data-testid="price-line-area" d={`${path(shown.map(c => c.close))} L${x(shown.length - 1)},${bottom} L${x(0)},${bottom}Z`} fill={`url(#${clip}-area)`}/><path data-testid="price-line" d={path(shown.map(c => c.close))} fill="none" stroke={blue} strokeWidth="1.8" strokeLinejoin="round"/></>}{shown.map((candle, index) => { const color = candle.close >= candle.open ? green : red; return <g key={candle.time} data-candle-time={candle.time} opacity={candle.partial ? .68 : 1}>{style === 'candles' && <><line x1={x(index)} x2={x(index)} y1={y(candle.high)} y2={y(candle.low)} stroke={color} strokeWidth="1"/><rect x={x(index) - candleWidth / 2} y={y(Math.max(candle.open, candle.close))} width={candleWidth} height={Math.max(1.25, Math.abs(y(candle.open) - y(candle.close)))} rx={Math.min(1, candleWidth / 4)} fill={color}/></>}{hasVolume && candle.volume != null && candle.volume >= 0 && <rect x={x(index) - candleWidth / 2} y={volumeBottom - candle.volume / maxVolume * (volumeBottom - volumeTop)} width={candleWidth} height={candle.volume / maxVolume * (volumeBottom - volumeTop)} fill={color} opacity=".26"/>}</g>; })}{bandsVisible && (['upper', 'middle', 'lower'] as const).map(boundary => <path key={boundary} data-bollinger={boundary} d={path(technical.bands.slice(view.start, view.end).map(point => point?.[boundary] ?? null))} fill="none" stroke="#38bdf8" strokeWidth={boundary === 'middle' ? '1' : '1.2'} strokeDasharray={boundary === 'middle' ? '3 4' : undefined} opacity={boundary === 'middle' ? '.45' : '.75'}/>)}{indicators.map(key => <path key={key} data-indicator={key} d={path((averages[key] ?? []).slice(view.start, view.end))} fill="none" stroke={chartIndicators[key].color} strokeWidth="1.4" strokeLinejoin="round"/>)}</g>
      {shown.at(-1) && !crossVisible && <g aria-hidden="true"><line x1={left} x2={right} y1={y(shown.at(-1)!.close)} y2={y(shown.at(-1)!.close)} stroke={shown.at(-1)!.close >= shown.at(-1)!.open ? green : red} opacity=".35" strokeDasharray="4 5"/><rect x={right + 4} y={y(shown.at(-1)!.close) - 10} width={width - right - 7} height={20} rx={4} fill={shown.at(-1)!.close >= shown.at(-1)!.open ? '#123c32' : '#44212e'}/><text x={right + (width - right) / 2} y={y(shown.at(-1)!.close) + 4} fill={shown.at(-1)!.close >= shown.at(-1)!.open ? green : red} fontSize="10" textAnchor="middle">{axisText(shown.at(-1)!.close)}</text></g>}
      {tickIndices.map(index => <text key={shown[index].time} x={Math.max(28, Math.min(right - 20, x(index)))} y={chartHeight - 15} fill="#718096" fontSize="10" textAnchor="middle">{clockTick ? new Date(shown[index].time).toLocaleTimeString('es-ES', { timeZone: timezone, hour: '2-digit', minute: '2-digit' }) : time(shown[index].time, false)}</text>)}
      {crossVisible && hover && <g data-testid={market ? 'market-pulse-crosshair' : 'candle-crosshair'} pointerEvents="none" aria-hidden="true"><line x1={x(crossIndex)} x2={x(crossIndex)} y1={top} y2={volumeBottom} stroke={blue} strokeWidth=".8" strokeDasharray="3 4" opacity=".65"/>{hover.value != null && <><line data-testid="price-crosshair-line" x1={left} x2={right} y1={y(hover.value)} y2={y(hover.value)} stroke={blue} strokeWidth=".8" strokeDasharray="3 4" opacity=".65"/><rect x={right + 4} y={y(hover.value) - 10} width={width - right - 7} height={20} rx={4} fill="#19304f"/><text x={right + (width - right) / 2} y={y(hover.value) + 4} fill="#bfdbfe" textAnchor="middle" fontSize="10">{axisText(hover.value)}</text></>}<rect x={Math.max(left, Math.min(right - 120, x(crossIndex) - 60))} y={chartHeight - 31} width={120} height={23} rx={5} fill="#19304f"/><text x={Math.max(left + 60, Math.min(right - 60, x(crossIndex)))} y={chartHeight - 16} fill="#bfdbfe" textAnchor="middle" fontSize="10">{time(rows[hover.index].time)}</text></g>}
    </svg> : <p className="py-20 text-center text-sm text-slate-500">{emptyText}</p>}</div>
    {shown.length > 0 && <div aria-label="Resumen del tramo visible" className="mt-3 grid grid-cols-2 gap-3 rounded-xl border border-slate-800/70 bg-slate-950/25 px-3 py-3 text-[10px] sm:grid-cols-3"><div className="col-span-2 sm:col-span-1"><span className="text-slate-500">Tramo visible</span><p className="mt-1 text-slate-300">{time(shown[0].time)} — {time(shown.at(-1)!.time)}</p></div><div><span className="text-slate-500" title="Variación entre el primer y el último cierre de las velas visibles.">Variación entre cierres</span><p className={`mt-1 font-semibold tabular-nums ${visibleReturn == null ? 'text-slate-400' : visibleReturn >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{visibleReturn == null ? '—' : `${visibleReturn >= 0 ? '+' : ''}${priceText(visibleReturn, 2)}%`}</p></div><div><span className="text-slate-500" title="Rango verdadero medio de Wilder en 14 velas del intervalo seleccionado. Incluye diferencias frente al cierre previo. No es volatilidad anualizada.">ATR · 14 velas</span><p className="mt-1 font-semibold tabular-nums text-slate-300">{selectedAtr == null ? 'Requiere 14 velas' : format(selectedAtr)}</p></div></div>}
    <div className="mt-3 flex flex-wrap justify-between gap-x-5 gap-y-2 border-t border-slate-800/70 pt-3 text-[10px] leading-relaxed text-slate-500"><span>{session}{shown.length > 0 && ` · ${shown.length} velas`}</span><span aria-hidden="true" className="hidden sm:inline">Arrastra para explorar · Rueda para ampliar · Doble clic para restablecer</span></div><p id={helpId} className="sr-only">Gráfico interactivo. Usa las flechas izquierda y derecha para consultar velas, Inicio y Fin para ir a los extremos, más y menos para ampliar o reducir. Escape retira el cursor y cierra el modo ampliado. También puedes arrastrar el gráfico y usar la rueda del ratón. Las medias se calculan con los cierres de las velas disponibles.</p>
  </section>;
}
