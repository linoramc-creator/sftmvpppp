import { cleanHeadline, cleanNewsExcerpt } from "@/lib/editorial";
import { useEffect, useState, type ReactNode } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, BarChart, Bar } from 'recharts';
import type { Article, BondsPanel, BusinessPanel, OpinionsPanel, NewsPanel, Point, SegmentPeriod, Series } from '../../../supabase/functions/analyze-ticker/panels';

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
  return <div className="border border-border p-8 text-sm text-muted-foreground" role="status">{error || 'Cargando…'}{error && <button className="ml-4 text-primary underline" onClick={retry}>Reintentar</button>}</div>;
}
function Box({ title, children }: { title: string; children: ReactNode }) {
  return <section className="border border-border bg-card p-4 min-w-0"><h3 className="text-xs font-semibold tracking-wider text-primary mb-4">{title}</h3>{children}</section>;
}
function Stamp({ at }: { at: string }) {
  return <p className="text-xs text-muted-foreground">Actualizado: {new Date(at).toLocaleString('es-ES')}</p>;
}
function Documents({ articles }: { articles: Article[] }) {
  return <div className="space-y-4">{articles.map(a => <article key={a.url} className="border-b border-border pb-3 last:border-0">
    <a className="text-sm text-primary hover:underline" href={safeLink(a.url)} target="_blank" rel="noopener noreferrer">{cleanHeadline(a.title)}</a>
    <p className="text-xs text-muted-foreground mt-1">{a.date || 'Fecha no disponible'}</p>
    {a.excerpt && <p className="text-sm text-foreground/80 leading-relaxed mt-2">{cleanNewsExcerpt(a.excerpt)}</p>}
  </article>)}</div>;
}
export function NewsView({ subject, sector = false }: { subject: string; sector?: boolean }) {
  const state = usePanel<NewsPanel>('news', subject, sector);
  if (!state.data) return <Status {...state} />;
  const list = (articles: Article[]) => articles.length ? <Documents articles={articles} /> : <p className="text-sm py-4">No hay noticias relevantes disponibles en este período.</p>;
  return <div className="space-y-5 py-3">{state.error && <Status {...state} />}<Box title={sector ? 'NOTICIAS DEL SECTOR' : 'NOTICIAS · ' + subject}>{list(state.data.articles)}</Box>
    {!sector && state.data.sectorName && <Box title={'NOTICIAS DEL SECTOR · ' + state.data.sectorName}>{list(state.data.sectorArticles ?? [])}</Box>}<Stamp at={state.data.fetchedAt} /></div>;
}
const colors = ['#60a5fa', '#a78bfa', '#34d399', '#fb923c'];
function History({ series, unit = '%' }: { series: Series[]; unit?: string }) {
  const rows = new Map<string, Record<string, string | number>>();
  series.forEach(s => s.points.forEach(p => { const row = rows.get(p.date) ?? { date: p.date }; row[s.id] = p.value; rows.set(p.date, row); }));
  if (!rows.size) return <p className="text-sm text-muted-foreground py-8">No hay observaciones disponibles para este gráfico.</p>;
  return <><div className="h-72 w-full min-w-0"><ResponsiveContainer width="100%" height="100%"><LineChart data={[...rows.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)))} margin={{ top: 8, right: 12, bottom: 5, left: 8 }}>
    <CartesianGrid stroke="#253044" strokeDasharray="3 3" /><XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={40} tickFormatter={v => String(v).slice(5)} /><YAxis width={65} tick={{ fontSize: 10 }} tickFormatter={v => `${fmt(v, 1)} ${unit}`} domain={['auto', 'auto']} /><Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0' }} formatter={(v: number) => `${fmt(v)} ${unit}`} /><Legend wrapperStyle={{ fontSize: 11 }} /><ReferenceLine y={0} stroke="#475569" />
    {series.map((s, i) => <Line key={s.id} dataKey={s.id} name={s.label} stroke={colors[i % colors.length]} dot={false} connectNulls={false} isAnimationActive={false} strokeWidth={2} type="linear" />)}
  </LineChart></ResponsiveContainer></div><div className="text-xs text-muted-foreground space-y-1 mt-3">{series.map(s => <p key={s.id}><span>{s.label}</span>: {s.points.at(-1)?.date ?? 'sin datos'}</p>)}</div></>;
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
  return <div className="space-y-6"><div><h1 className="text-xl font-semibold tracking-wide text-primary">BONOS · EE. UU.</h1><p className="text-sm text-muted-foreground mt-2">Treasuries, tipos reales, inflación implícita, riesgo de crédito y ETF de renta fija. Datos actualizados con la última fecha disponible.</p></div>
    {state.error && <Status {...state} />}
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{choose('DGS2', 'DGS10', 'T10Y2Y', 'DFF').map(s => <Box key={s.id} title={s.label}><p className="text-2xl font-mono">{fmt(s.points.at(-1)?.value)} {s.unit}</p><p className="text-xs text-muted-foreground mt-2">{s.points.at(-1)?.date ?? 'Sin observaciones'}</p></Box>)}</div>
    <div className="grid lg:grid-cols-2 gap-4">
      <Box title={`CURVA DEL TESORO · ${common ?? 'sin fecha común disponible'}`}>
        {common ? <div className="h-72"><ResponsiveContainer width="100%" height="100%"><LineChart data={curve}><CartesianGrid stroke="#253044" /><XAxis dataKey="maturity" tick={{ fontSize: 10 }} /><YAxis unit="%" domain={['auto', 'auto']} tick={{ fontSize: 10 }} /><Tooltip contentStyle={{ background: '#0f172a', color: '#e2e8f0' }} formatter={(v: number) => `${fmt(v)}%`} /><Line dataKey="yield" name="Rendimiento" stroke="#60a5fa" strokeWidth={2} type="linear" /></LineChart></ResponsiveContainer></div> : <p className="text-sm">No hay una fecha común para todas las duraciones. Consulta las fechas de cada vencimiento.</p>}
        <div className="flex flex-wrap gap-3 text-xs mt-3">{treasury.map(s => <span key={s.id} className="text-muted-foreground">{s.label}: {fmt(s.points.at(-1)?.value)}% ({s.points.at(-1)?.date ?? 'N/D'})</span>)}</div>
      </Box>
      <Box title="TESORO · HISTÓRICO DE UN AÑO"><History series={choose('DGS2', 'DGS10', 'DGS30')} /></Box>
      <Box title="TIPO REAL E INFLACIÓN IMPLÍCITA · 10 AÑOS"><History series={choose('DFII10', 'T10YIE')} /></Box>
      <Box title="DIFERENCIALES DE CRÉDITO · OAS"><History series={choose('BAMLC0A0CM', 'BAMLH0A0HYM2')} unit="pp" /><p className="text-xs text-muted-foreground mt-2">1 punto porcentual (pp) = 100 puntos básicos.</p></Box>
      <Box title="PENDIENTE DE LA CURVA · 10 MENOS 2 AÑOS"><History series={choose('T10Y2Y')} unit="pp" /></Box>
      <Box title="ETF · EVOLUCIÓN DEL PRECIO"><select aria-label="ETF de bonos" className="bg-background border border-border p-2 text-sm mb-3 w-full" value={selected} onChange={e => setSelected(e.target.value)}>{etfs.map(e => <option key={e.symbol} value={e.symbol}>{e.symbol} · {e.label}</option>)}</select><History series={[{ id: selected, label: selected, unit: '', source: `https://finance.yahoo.com/quote/${selected}/`, points: rebased }]} unit="" /><p className="text-xs text-muted-foreground mt-2">Base 100 desde la primera cotización del período. Variación del precio, sin reinversión de distribuciones.</p></Box>
    </div>
    {fund && <Box title={`${fund.symbol} · DATOS DEL FONDO`}><div className="grid sm:grid-cols-3 gap-4 text-sm"><div><p className="text-muted-foreground">Distribuciones últimos 12 meses / precio</p><p className="text-xl mt-2">{fmt(fund.distributionYield)}%</p></div><div><p className="text-muted-foreground">Gastos anuales declarados</p><p className="text-xl mt-2">{fmt(fund.expenseRatio, 3)}%</p></div><div><p className="text-muted-foreground">Patrimonio gestionado</p><p className="text-xl mt-2">{fund.assets == null ? 'N/D' : compact(fund.assets)} {fund.currency}</p></div></div><p className="text-xs text-muted-foreground mt-3">La tasa de distribuciones no es el yield SEC ni el rendimiento a vencimiento. Duración efectiva y yield SEC: no disponibles.</p></Box>}
    <Box title="ETF DE BONOS · COTIZACIONES"><div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead className="text-muted-foreground"><tr>{['ETF', 'Exposición', 'Precio', 'Variación diaria', 'Fecha'].map(h => <th className="p-2" key={h}>{h}</th>)}</tr></thead><tbody>{etfs.map(e => <tr key={e.symbol} className="border-t border-border"><td className="p-2"><button className="text-primary" onClick={() => setSelected(e.symbol)}>{e.symbol}</button></td><td className="p-2">{e.label}</td><td className="p-2 whitespace-nowrap">{fmt(e.price)} {e.currency}</td><td className="p-2">{fmt(e.change)}%</td><td className="p-2 whitespace-nowrap">{e.date ?? 'N/D'}</td></tr>)}</tbody></table></div><p className="text-xs text-muted-foreground mt-3">Los ETF tienen riesgo de tipos, crédito y fluctuación de precio; su cotización no es el rendimiento a vencimiento de un bono.</p></Box>
    <Stamp at={state.data.fetchedAt} />
  </div>;
}
export function InstitutionalView({ ticker }: { ticker: string }) {
  const state = usePanel<OpinionsPanel>('institutional', ticker);
  if (!state.data) return <Status {...state} />;
  const data = state.data;
  const opinions = data.opinions ?? [];
  return <div className="space-y-5 py-3">{state.error && <Status {...state} />}
    <div className="grid sm:grid-cols-2 gap-4"><Box title="PRECIO ACTUAL"><p className="text-2xl">{fmt(data.currentPrice)} {data.currency}</p></Box>{data.consensusTarget !== null && <Box title="PRECIO OBJETIVO · CONSENSO"><p className="text-2xl">{fmt(data.consensusTarget)} {data.currency}</p></Box>}</div>
    <Box title="OPINIÓN DE BANCOS Y ENTIDADES DE ANÁLISIS">{opinions.length ? <div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead><tr>{['Institución', 'Recomendación', 'Revisión', 'Precio objetivo', 'Fecha del objetivo', 'Fecha de opinión'].map(h => <th key={h} className="p-3 whitespace-nowrap">{h}</th>)}</tr></thead><tbody>{opinions.map((o, i) => <tr key={o.institution + i} className="border-t border-border"><td className="p-3 font-semibold">{o.institution}</td><td className={'p-3 ' + (o.recommendation === 'Comprar' ? 'text-emerald-400' : o.recommendation === 'Vender' ? 'text-red-400' : 'text-amber-300')}><div>{o.recommendation}</div>{o.originalRating && <div className="text-xs text-muted-foreground">{o.originalRating}</div>}</td><td className="p-3">{o.action}</td><td className="p-3 whitespace-nowrap">{o.target === null ? 'No publicado' : fmt(o.target) + ' ' + o.currency}{o.previousTarget !== null && <div className="text-xs text-muted-foreground">Anterior: {fmt(o.previousTarget)}</div>}</td><td className="p-3 whitespace-nowrap">{o.targetDate ?? '—'}</td><td className="p-3 whitespace-nowrap">{o.date}</td></tr>)}</tbody></table></div> : <p className="text-sm">No hay recomendaciones o precios objetivo publicados disponibles para este {data.isEtf ? 'ETF' : 'activo'} en el último año.</p>}<p className="text-xs text-muted-foreground mt-3">Las recomendaciones expresan la opinión de cada entidad; no representan operaciones ejecutadas ni garantizan alcanzar un precio.</p></Box><Stamp at={data.fetchedAt} /></div>;
}
function Segments({ title, periods }: { title: string; periods: SegmentPeriod[] }) {
  const [selected, setSelected] = useState('');
  const current = periods.find(p => p.date === selected) ?? periods[0];
  const sum = current?.segments.reduce((total, s) => total + s.value, 0) ?? 0;
  return <Box title={title}>{!current ? <p className="text-sm text-muted-foreground">Desglose de ingresos no disponible.</p> : <>
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
    <Box title="MODELO DE NEGOCIO">{data.summary ? <dl className="grid md:grid-cols-3 gap-5 text-sm">{[['Actividad', data.summary.activity], ['Clientes', data.summary.customers], ['Cómo genera ingresos', data.summary.revenueModel]].map(([label, value]) => <div key={label}><dt className="text-primary text-xs font-semibold mb-2">{label}</dt><dd className="leading-relaxed">{value}</dd></div>)}</dl> : <p className="text-sm">Resumen no disponible.</p>}</Box>
    <div className="grid xl:grid-cols-2 gap-4"><Segments title="INGRESOS POR PRODUCTO O NEGOCIO" periods={data.products} /><Segments title="INGRESOS POR REGIÓN" periods={data.geography} /></div>
    <p className="text-xs text-muted-foreground">Productos y regiones son vistas distintas de los mismos ingresos; no se suman entre sí.</p>
    <Box title="SOCIOS Y COLABORACIONES · ÚLTIMOS 12 MESES">{data.partnerships?.length ? <div className="grid md:grid-cols-2 gap-4">{data.partnerships.map(p => <article key={p.partner + p.date} className="border border-border p-4"><h4 className="text-sm text-primary font-semibold">{p.partner}</h4><p className="text-xs text-muted-foreground mt-1">{p.date}</p><p className="text-sm leading-relaxed mt-3">{p.summary}</p></article>)}</div> : <p className="text-sm">No hay acuerdos anunciados disponibles para los últimos 12 meses.</p>}</Box><Stamp at={data.fetchedAt} /></div>;
}
