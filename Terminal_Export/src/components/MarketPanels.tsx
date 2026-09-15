import { useEffect, useState, type ReactNode } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, BarChart, Bar } from 'recharts';
import type { Article, BondsPanel, BusinessPanel, InstitutionalPanel, NewsPanel, Point, SegmentPeriod, Series } from '../../../supabase/functions/analyze-ticker/panels';

const cache = new Map<string, { at: number; data: unknown }>();
const pending = new Map<string, Promise<unknown>>();
function request<T>(panel: string, subject: string, sector: boolean, ttl: number): Promise<T> {
  const key = `${panel}:${subject}:${sector}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return Promise.resolve(hit.data as T);
  if (pending.has(key)) return pending.get(key) as Promise<T>;
  const promise = fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-ticker`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
    body: JSON.stringify({ panel, subject, sector }), signal: AbortSignal.timeout(55000),
  }).then(async response => {
    if (!response.ok) throw new Error('No se ha podido consultar este apartado.');
    const data = await response.json();
    if (cache.size >= 100) cache.delete(cache.keys().next().value!);
    cache.set(key, { at: Date.now(), data }); return data;
  }).finally(() => pending.delete(key));
  pending.set(key, promise);
  return promise;
}
function usePanel<T>(panel: string, subject = '', sector = false) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setData(null); setError('');
    const load = () => request<T>(panel, subject, sector, ['business', 'institutional'].includes(panel) ? 86400000 : 3600000)
      .then(value => { if (!cancelled) { setData(value); setError(''); } })
      .catch(() => { if (!cancelled) setError('No se ha podido actualizar. Inténtalo de nuevo.'); });
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 60000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [panel, subject, sector, retry]);
  return { data, error, retry: () => setRetry(n => n + 1) };
}
const fmt = (n: number | null | undefined, digits = 2) => n == null ? 'N/D' : n.toLocaleString('es-ES', { maximumFractionDigits: digits });
const compact = (n: number) => Intl.NumberFormat('es-ES', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
const safeLink = (url: string) => /^https?:\/\//i.test(url) ? url : undefined;
function Status({ error, retry }: { error: string; retry: () => void }) {
  return <div className="border border-border p-8 text-sm text-muted-foreground" role="status">{error || 'Consultando fuentes…'}{error && <button className="ml-4 text-primary underline" onClick={retry}>Reintentar</button>}</div>;
}
function Box({ title, children }: { title: string; children: ReactNode }) {
  return <section className="border border-border bg-card p-4 min-w-0"><h3 className="text-xs font-semibold tracking-wider text-primary mb-4">{title}</h3>{children}</section>;
}
function Stamp({ at }: { at: string }) {
  return <p className="text-xs text-muted-foreground">Consulta: {new Date(at).toLocaleString('es-ES')} · Las fechas de cada dato indican su publicación u observación, no la hora de consulta.</p>;
}
function Documents({ articles }: { articles: Article[] }) {
  return <div className="space-y-4">{articles.map(a => <article key={a.url} className="border-b border-border pb-3 last:border-0">
    <a className="text-sm text-primary hover:underline" href={safeLink(a.url)} target="_blank" rel="noopener noreferrer">{a.title}</a>
    <p className="text-xs text-muted-foreground mt-1">{a.source} · {a.date || 'Fecha no informada por la fuente'}</p>
    {a.excerpt && <p className="text-sm text-foreground/80 leading-relaxed mt-2">{a.excerpt}</p>}
  </article>)}</div>;
}
export function NewsView({ subject, sector = false }: { subject: string; sector?: boolean }) {
  const state = usePanel<NewsPanel>('news', subject, sector);
  if (!state.data) return <Status {...state} />;
  return <div className="space-y-4 py-3"><h3 className="text-sm font-semibold">Noticias relevantes · {subject}</h3><p className="text-xs text-muted-foreground">Hasta 5 noticias de los últimos 14 días. Selección por relación con el activo o sector y hechos financieros; sin duplicados, publicidad ni listas de compra.</p>
    {state.error && <Status {...state} />}
    {state.data.articles.length ? <Documents articles={state.data.articles} /> : <p className="text-sm py-6">No se han encontrado noticias que cumplan los filtros. No se añaden titulares de relleno.</p>}<Stamp at={state.data.fetchedAt} /></div>;
}
const colors = ['#60a5fa', '#a78bfa', '#34d399', '#fb923c'];
function History({ series, unit = '%' }: { series: Series[]; unit?: string }) {
  const rows = new Map<string, Record<string, string | number>>();
  series.forEach(s => s.points.forEach(p => { const row = rows.get(p.date) ?? { date: p.date }; row[s.id] = p.value; rows.set(p.date, row); }));
  if (!rows.size) return <p className="text-sm text-muted-foreground py-8">La fuente no ha devuelto observaciones para este gráfico.</p>;
  return <><div className="h-72 w-full min-w-0"><ResponsiveContainer width="100%" height="100%"><LineChart data={[...rows.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)))} margin={{ top: 8, right: 12, bottom: 5, left: 8 }}>
    <CartesianGrid stroke="#253044" strokeDasharray="3 3" /><XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={40} tickFormatter={v => String(v).slice(5)} /><YAxis width={65} tick={{ fontSize: 10 }} tickFormatter={v => `${fmt(v, 1)} ${unit}`} domain={['auto', 'auto']} /><Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0' }} formatter={(v: number) => `${fmt(v)} ${unit}`} /><Legend wrapperStyle={{ fontSize: 11 }} /><ReferenceLine y={0} stroke="#475569" />
    {series.map((s, i) => <Line key={s.id} dataKey={s.id} name={s.label} stroke={colors[i % colors.length]} dot={false} connectNulls={false} isAnimationActive={false} strokeWidth={2} type="linear" />)}
  </LineChart></ResponsiveContainer></div><div className="text-xs text-muted-foreground space-y-1 mt-3">{series.map(s => <p key={s.id}><a href={s.source} target="_blank" rel="noopener noreferrer" className="hover:text-primary">{s.label}</a>: {s.points.at(-1)?.date ?? 'sin datos'}</p>)}</div></>;
}
export function BondsView() {
  const state = usePanel<BondsPanel>('bonds');
  const [selected, setSelected] = useState('BND');
  if (!state.data) return <Status {...state} />;
  const { series, etfs } = state.data;
  const choose = (...ids: string[]) => ids.flatMap(id => series.find(s => s.id === id) ?? []);
  // Same observation date for every maturity: never mix points from different days.
  const treasury = series.filter(s => s.id.startsWith('DGS'));
  const common = treasury.length && treasury.every(s => s.points.length) ? treasury[0].points.map(p => p.date).filter(d => treasury.every(s => s.points.some(p => p.date === d))).sort().at(-1) : null;
  const curve = treasury.map(s => ({ maturity: s.label, yield: common ? s.points.find(p => p.date === common)?.value ?? null : null }));
  const fund = etfs.find(e => e.symbol === selected);
  const rebased: Point[] = fund?.points.length && fund.points[0].value > 0 ? fund.points.map(p => ({ date: p.date, value: p.value / fund.points[0].value * 100 })) : [];
  return <div className="space-y-6"><div><h1 className="text-xl font-semibold tracking-wide text-primary">BONOS · EE. UU.</h1><p className="text-sm text-muted-foreground mt-2">Treasuries, tipos reales, inflación implícita, riesgo de crédito y ETF de renta fija. Actualización automática durante la consulta; las fuentes pueden publicar con retraso.</p></div>
    {state.error && <Status {...state} />}
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{choose('DGS2', 'DGS10', 'T10Y2Y', 'DFF').map(s => <Box key={s.id} title={s.label}><p className="text-2xl font-mono">{fmt(s.points.at(-1)?.value)} {s.unit}</p><p className="text-xs text-muted-foreground mt-2">{s.points.at(-1)?.date ?? 'Sin observaciones'}</p></Box>)}</div>
    <div className="grid lg:grid-cols-2 gap-4">
      <Box title={`CURVA DEL TESORO · ${common ?? 'sin fecha común disponible'}`}>
        {common ? <div className="h-72"><ResponsiveContainer width="100%" height="100%"><LineChart data={curve}><CartesianGrid stroke="#253044" /><XAxis dataKey="maturity" tick={{ fontSize: 10 }} /><YAxis unit="%" domain={['auto', 'auto']} tick={{ fontSize: 10 }} /><Tooltip contentStyle={{ background: '#0f172a', color: '#e2e8f0' }} formatter={(v: number) => `${fmt(v)}%`} /><Line dataKey="yield" name="Rendimiento" stroke="#60a5fa" strokeWidth={2} type="linear" /></LineChart></ResponsiveContainer></div> : <p className="text-sm">No hay una fecha común para todas las duraciones. Consulta los datos individuales de FRED más abajo.</p>}
        <div className="flex flex-wrap gap-3 text-xs mt-3">{treasury.map(s => <a key={s.id} className="text-muted-foreground hover:text-primary" href={s.source} target="_blank" rel="noopener noreferrer">{s.label}: {fmt(s.points.at(-1)?.value)}% ({s.points.at(-1)?.date ?? 'N/D'})</a>)}</div>
      </Box>
      <Box title="TESORO · HISTÓRICO DE UN AÑO"><History series={choose('DGS2', 'DGS10', 'DGS30')} /></Box>
      <Box title="TIPO REAL E INFLACIÓN IMPLÍCITA · 10 AÑOS"><History series={choose('DFII10', 'T10YIE')} /></Box>
      <Box title="DIFERENCIALES DE CRÉDITO · OAS"><History series={choose('BAMLC0A0CM', 'BAMLH0A0HYM2')} unit="pp" /><p className="text-xs text-muted-foreground mt-2">1 punto porcentual (pp) = 100 puntos básicos.</p></Box>
      <Box title="PENDIENTE DE LA CURVA · 10 MENOS 2 AÑOS"><History series={choose('T10Y2Y')} unit="pp" /></Box>
      <Box title="ETF · EVOLUCIÓN DEL PRECIO"><select aria-label="ETF de bonos" className="bg-background border border-border p-2 text-sm mb-3 w-full" value={selected} onChange={e => setSelected(e.target.value)}>{etfs.map(e => <option key={e.symbol} value={e.symbol}>{e.symbol} · {e.label}</option>)}</select><History series={[{ id: selected, label: selected, unit: '', source: `https://finance.yahoo.com/quote/${selected}/`, points: rebased }]} unit="" /><p className="text-xs text-muted-foreground mt-2">Base 100 desde la primera cotización del período. Variación del precio, sin reinversión de distribuciones.</p></Box>
    </div>
    {fund && <Box title={`${fund.symbol} · DATOS DEL FONDO`}><div className="grid sm:grid-cols-3 gap-4 text-sm"><div><p className="text-muted-foreground">Distribuciones últimos 12 meses / precio</p><p className="text-xl mt-2">{fmt(fund.distributionYield)}%</p></div><div><p className="text-muted-foreground">Gastos anuales declarados</p><p className="text-xl mt-2">{fmt(fund.expenseRatio, 3)}%</p></div><div><p className="text-muted-foreground">Patrimonio gestionado</p><p className="text-xl mt-2">{fund.assets == null ? 'N/D' : compact(fund.assets)} {fund.currency}</p></div></div><p className="text-xs text-muted-foreground mt-3">Yahoo Finance · ficha consultada con el panel; el proveedor no informa fecha individual para estas métricas. La tasa de distribuciones no es el yield SEC ni el rendimiento a vencimiento. Duración efectiva y yield SEC: no disponibles en esta fuente.</p></Box>}
    <Box title="ETF DE BONOS · COTIZACIONES"><div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead className="text-muted-foreground"><tr>{['ETF', 'Exposición', 'Precio', 'Variación diaria', 'Fecha'].map(h => <th className="p-2" key={h}>{h}</th>)}</tr></thead><tbody>{etfs.map(e => <tr key={e.symbol} className="border-t border-border"><td className="p-2"><button className="text-primary" onClick={() => setSelected(e.symbol)}>{e.symbol}</button></td><td className="p-2">{e.label}</td><td className="p-2 whitespace-nowrap">{fmt(e.price)} {e.currency}</td><td className="p-2">{fmt(e.change)}%</td><td className="p-2 whitespace-nowrap">{e.date ?? 'N/D'}</td></tr>)}</tbody></table></div><p className="text-xs text-muted-foreground mt-3">Fuente: Yahoo Finance. Los ETF tienen riesgo de tipos, crédito y fluctuación de precio; su cotización no es el rendimiento a vencimiento de un bono.</p></Box>
    <Stamp at={state.data.fetchedAt} />
  </div>;
}
export function InstitutionalView({ ticker }: { ticker: string }) {
  const state = usePanel<InstitutionalPanel>('institutional', ticker);
  if (!state.data) return <Status {...state} />;
  const data = state.data;
  return <div className="space-y-5 py-3"><Box title="PROPIEDAD INSTITUCIONAL"><p className="text-2xl font-mono">{fmt(data.institutionalPct)}%</p><p className="text-xs text-muted-foreground mt-2">Participación agregada informada por Yahoo Finance; no se calcula sumando esta tabla. Los fondos pueden estar incluidos en las gestoras y las posiciones se publican con retraso.</p></Box>
    {state.error && <Status {...state} />}
    <Box title="GESTORAS Y FONDOS · POSICIONES DECLARADAS">{data.holders.length ? <div className="overflow-x-auto"><table className="w-full text-xs text-left"><thead><tr>{['Titular', 'Acciones', 'Valor declarado (USD)', '%', 'Fecha de posición', 'Fuente'].map(h => <th className="p-2" key={h}>{h}</th>)}</tr></thead><tbody>{data.holders.map((h, i) => <tr key={`${h.name}:${i}`} className="border-t border-border"><td className="p-2">{h.name}</td><td className="p-2">{fmt(h.shares, 0)}</td><td className="p-2">{fmt(h.value, 0)}</td><td className="p-2">{fmt(h.pct)}</td><td className="p-2 whitespace-nowrap">{h.date ?? 'No informada'}</td><td className="p-2"><a className="text-primary" href={safeLink(h.url)} target="_blank" rel="noopener noreferrer">{h.source}</a></td></tr>)}</tbody></table></div> : <p className="text-sm text-muted-foreground">Los proveedores no han devuelto posiciones estructuradas para este activo. Consulta los documentos disponibles debajo.</p>}</Box>
    <Box title="DOCUMENTOS Y FUENTES COMPLEMENTARIAS">{data.documents.length ? <Documents articles={data.documents} /> : <p className="text-sm">Sin documentos adicionales disponibles.</p>}<p className="text-xs text-muted-foreground mt-3">Extractos de búsqueda para contrastar con el documento original; no se incorporan como posiciones verificadas a la tabla.</p></Box>
    <p className="text-xs text-muted-foreground">Fuentes con datos: {data.sources.join(' · ') || 'ninguna'} · Caché de 24 horas para limitar consultas.</p><Stamp at={data.fetchedAt} /></div>;
}
function Segments({ title, periods }: { title: string; periods: SegmentPeriod[] }) {
  const [selected, setSelected] = useState('');
  const current = periods.find(p => p.date === selected) ?? periods[0];
  const sum = current?.segments.reduce((total, s) => total + s.value, 0) ?? 0;
  return <Box title={title}>{!current ? <p className="text-sm text-muted-foreground">No hay desglose estructurado disponible con la cobertura actual del proveedor. Consulta los informes enlazados; no se estiman importes.</p> : <>
    <select className="bg-background border border-border p-2 text-sm mb-3" aria-label={`Período de ${title}`} value={current.date} onChange={e => setSelected(e.target.value)}>{periods.map(p => <option key={p.date} value={p.date}>Ejercicio cerrado: {p.date} · {p.currency}</option>)}</select>
    <div style={{ height: Math.max(250, current.segments.length * 32) }}><ResponsiveContainer width="100%" height="100%"><BarChart data={current.segments} layout="vertical" margin={{ right: 20 }}><CartesianGrid stroke="#253044" /><XAxis type="number" tickFormatter={compact} tick={{ fontSize: 10 }} /><YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 10 }} /><Tooltip formatter={(v: number) => `${fmt(v, 0)} ${current.currency}`} contentStyle={{ background: '#0f172a', color: '#e2e8f0' }} /><Bar dataKey="value" name="Ingresos" fill="#60a5fa" /></BarChart></ResponsiveContainer></div>
    <div className="overflow-x-auto"><table className="w-full text-xs text-left"><thead><tr><th className="p-2">Segmento</th><th className="p-2">Ingresos ({current.currency})</th><th className="p-2">% de la suma presentada</th></tr></thead><tbody>{current.segments.map(s => <tr key={s.name} className="border-t border-border"><td className="p-2">{s.name}</td><td className="p-2">{fmt(s.value, 0)}</td><td className="p-2">{sum > 0 ? fmt(s.value / sum * 100) + '%' : 'N/D'}</td></tr>)}</tbody></table></div><p className="text-xs text-muted-foreground mt-3">Las categorías pueden solaparse o incluir eliminaciones contables. La suma presentada no equivale necesariamente a los ingresos consolidados.</p>
  </>}</Box>;
}
export function BusinessView({ ticker }: { ticker: string }) {
  const state = usePanel<BusinessPanel>('business', ticker);
  if (!state.data) return <Status {...state} />;
  const data = state.data;
  return <div className="space-y-5 py-3">{state.error && <Status {...state} />}
    <Box title="MODELO DE NEGOCIO"><p className="text-sm leading-relaxed">{data.description || 'Descripción no disponible en Yahoo Finance. Consulta las fuentes del negocio más abajo.'}</p><a className="text-xs text-primary" href={`https://finance.yahoo.com/quote/${ticker}/profile/`} target="_blank" rel="noopener noreferrer">Perfil · Yahoo Finance</a></Box>
    <div className="grid xl:grid-cols-2 gap-4"><Segments title="INGRESOS POR PRODUCTO O NEGOCIO" periods={data.products} /><Segments title="INGRESOS POR REGIÓN" periods={data.geography} /></div>
    <p className="text-xs text-muted-foreground">{data.source}. Productos y regiones son vistas distintas de los mismos ingresos: no se suman entre sí. Se muestran todos los segmentos que devuelve la fuente y hasta cuatro ejercicios.</p>
    <Box title="CANALES DE VENTA Y DISTRIBUCIÓN"><p className="text-sm text-muted-foreground mb-4">Canales mencionados en las fuentes consultadas. Las empresas no siempre publican ingresos por canal; no se asignan porcentajes sin datos declarados.</p>
      <div className="grid md:grid-cols-2 gap-4 mb-5">{data.channels.map(c => <article key={c.name} className="border border-border p-3"><h4 className="text-sm text-primary mb-2">{c.name}</h4><p className="text-sm leading-relaxed">{c.evidence}</p><a href={safeLink(c.url)} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline">Ver fuente</a></article>)}</div>
      {!data.channels.length && <p className="text-sm mb-4">Las fuentes consultadas no describen canales con suficiente detalle.</p>}
      <details><summary className="text-sm text-primary cursor-pointer">Documentos del negocio</summary><div className="mt-4">{data.documents.length ? <Documents articles={data.documents} /> : <p className="text-sm">No se han obtenido documentos adicionales para este activo.</p>}</div></details>
    </Box><Stamp at={data.fetchedAt} /></div>;
}
