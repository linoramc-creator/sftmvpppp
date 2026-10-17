import {usePanelActive} from './KeepPanel';
import { WatchlistCard } from "./WatchlistCard";
import type { MarketData } from "@/lib/analyze";
import {NewsCards,TreasuryCard,EarningsList,FeedQuoteStamp} from './FeedCards';
import { authenticatedFetch } from "@/lib/beta-api";
import { useEffect, useState, useRef, type ReactNode } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, BarChart, Bar } from 'recharts';
import type { Article, BondsPanel, BusinessPanel, OpinionsPanel, NewsPanel, MarketFeed, FeedQuote, Point, SegmentPeriod, Series } from '../../../supabase/functions/analyze-ticker/panels';

const cache = new Map<string, { at: number; data: unknown }>();
const pending = new Map<string, Promise<unknown>>();
function request<T>(panel: string, subject: string, sector: boolean, ttl: number): Promise<T> {
  const key = `${panel}:${subject}:${sector}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return Promise.resolve(hit.data as T);
  if (pending.has(key)) return pending.get(key) as Promise<T>;
  const promise = authenticatedFetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-ticker`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', },
    body: JSON.stringify({ panel, subject, sector }), signal: AbortSignal.timeout(panel === 'business' ? 145000 : 75000),
  }).then(async response => {
    if (!response.ok) throw new Error('No se ha podido consultar este apartado.');
    const data = await response.json();
    if (cache.size >= 100) cache.delete(cache.keys().next().value!);
    const incomplete = panel === 'business' && (!data.products?.length || !data.geography?.length);
    if (!incomplete) cache.set(key, { at: Date.now(), data }); return data;
  }).finally(() => pending.delete(key));
  pending.set(key, promise);
  return promise;
}
function usePanel<T>(panel: string, subject = '', sector = false) {
  const active=usePanelActive();
  const previousKey=useRef(`${panel}:${subject}:${sector}`);
  const [data, setData] = useState<T | null>(() => (cache.get(`${panel}:${subject}:${sector}`)?.data as T) ?? null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if(!active)return;
    let cancelled = false;
    const previous=cache.get(`${panel}:${subject}:${sector}`);
    const key=`${panel}:${subject}:${sector}`;
    if(previous&&Date.now()-previous.at<86400000)setData(previous.data as T);else if(previousKey.current!==key)setData(null);
    previousKey.current=key;setError('');
    const ttl = panel==='feedMarkets'?60000:panel.startsWith('feed') ? 300000 : panel==='news'?600000: ['business', 'institutional'].includes(panel) ? 86400000 : 3600000;
    const load = () => request<T>(panel, subject, sector, ttl)
      .then(value => { if (!cancelled) { setData(value); setError(''); } })
      .catch(() => { if (!cancelled) setError('No se ha podido actualizar. Inténtalo de nuevo.'); });
    void load();
    const visible=()=>{if(document.visibilityState==='visible')void load();};
    const timer = window.setInterval(visible, ttl);
    document.addEventListener('visibilitychange',visible);
    return () => { cancelled = true; window.clearInterval(timer); document.removeEventListener('visibilitychange',visible); };
  }, [panel, subject, sector, retry,active]);
  return { data, error, retry: () => { cache.delete(`${panel}:${subject}:${sector}`); setRetry(n => n + 1); } };
}
const fmt = (n: number | null | undefined, digits = 2) => n == null ? 'N/D' : n.toLocaleString('es-ES', { maximumFractionDigits: digits });
const compact = (n: number) => Intl.NumberFormat('es-ES', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
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
  return <NewsCards articles={articles} compact />;
}
export function NewsView({ subject, sector = false }: { subject: string; sector?: boolean }) {
  const state = usePanel<NewsPanel>('news', subject, sector);
  if (!state.data) return <Status {...state} />;
  const list = (articles: Article[]) => articles.length ? <Documents articles={articles} /> : <p className="text-sm py-4">No hay noticias relevantes disponibles en este período.</p>;
  return <div className="space-y-5 py-3">{state.error && <Status {...state} />}<Box title={sector ? 'NOTICIAS DEL SECTOR' : 'NOTICIAS · ' + subject}>{list(state.data.articles)}</Box>
    {!sector && state.data.sectorName && <Box title={'NOTICIAS DEL SECTOR · ' + state.data.sectorName}>{list(state.data.sectorArticles ?? [])}</Box>}<Stamp at={state.data.fetchedAt} /></div>;
}
function feedPrice(price: number | null, currency: string) {
  if (price === null) return 'N/D';
  const digits = Math.abs(price) < 10 ? 4 : 2;
  return `${fmt(price, digits)} ${currency}`;
}
function FeedInstrument({item,onSelect}:{item:FeedQuote;onSelect?: (symbol:string)=>void}){
  const content=<><div className="min-w-0"><p className="text-sm group-hover:text-sky-300 transition-colors">{item.label}</p><FeedQuoteStamp quote={item}/></div><div className="text-right shrink-0"><p className="text-xs sm:text-sm tabular-nums whitespace-nowrap">{feedPrice(item.price,item.symbol.startsWith('^')||item.symbol==='NQ=F'?'pts':item.unit??item.currency)}</p><p className={`text-xs tabular-nums ${item.change===null?'text-muted-foreground':item.change>=0?'text-emerald-400':'text-red-400'}`}>{item.change===null?'N/D':`${item.change>=0?'+':''}${fmt(item.change)}%`}</p></div></>;
  const classes='flex w-full items-center justify-between gap-3 border-b border-border/70 pb-2 last:border-0 last:pb-0';
  return onSelect?<button type="button" aria-label={`Abrir ficha de ${item.label}`} onClick={()=>onSelect(item.symbol)} className={`${classes} group text-left rounded px-1 -mx-1 hover:bg-sky-400/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60`}>{content}</button>:<div className={classes}>{content}</div>;
}
export function FeedView({stocks,data:quotes,onChange,onSelect}:{stocks:string[];data:MarketData|null;onChange:(stocks:string[])=>void;onSelect:(symbol:string)=>void}) {
  const market=usePanel<MarketFeed>('feedMarkets',stocks.join(','));
  const state = usePanel<MarketFeed>('feedNews');
  const data = market.data ?? {groups:[],treasury:[],earnings:[],fetchedAt:''};
  return <div className="space-y-6">
    {(!market.data||market.error) && <Status {...market} />}
    <div className="grid gap-4 xl:grid-cols-3">{data.groups.map(group => <Box key={group.label} title={group.label}><div className="space-y-2">{group.items.map(item=><FeedInstrument key={item.symbol} item={item} onSelect={group.label==='ÍNDICES'||group.label==='ETF PRINCIPALES'?onSelect:undefined}/>)}</div></Box>)}<Box title="TESORO EE. UU. · CURVA Y RENDIMIENTOS"><TreasuryCard points={data.treasury??[]}/></Box><Box title="MI WATCHLIST"><WatchlistCard stocks={stocks} data={quotes} liveQuotes={market.data?.watchlist} onChange={onChange} onSelect={onSelect}/></Box></div>
    <div className="grid xl:grid-cols-[minmax(0,1fr)_20rem] gap-4">
      <div className="space-y-4"><Box title="PORTADAS DEL DÍA">{state.data&&<div className="mb-3"><Stamp at={state.data.fetchedAt}/></div>}{state.data?<NewsCards articles={state.data.headlines}/>:<Status {...state}/>}</Box><Box title="GEOPOLÍTICA · ÚLTIMAS NOTICIAS">{state.data?<NewsCards articles={state.data.geopolitics??[]} geo/>:<Status {...state}/>}</Box></div>
      <Box title="RESULTADOS · PRÓXIMOS 7 DÍAS"><EarningsList events={data.earnings??[]} onSelect={onSelect}/></Box>
    </div>
    {state.error&&state.data&&<Status {...state}/>}
    {data.fetchedAt&&<Stamp at={data.fetchedAt} />}
  </div>;
}
const colors = ['#60a5fa', '#a78bfa', '#34d399', '#fb923c'];
function History({ series, unit = '%' }: { series: Series[]; unit?: string }) {
  const rows = new Map<string, Record<string, string | number>>();
  series.forEach(s => s.points.forEach(p => { const row = rows.get(p.date) ?? { date: p.date }; row[s.id] = p.value; rows.set(p.date, row); }));
  if (!rows.size) return <p className="text-sm text-muted-foreground py-8">No hay observaciones disponibles para este gráfico.</p>;
  return <><div className="h-72 w-full min-w-0"><ResponsiveContainer width="100%" height="100%"><LineChart data={[...rows.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)))} margin={{ top: 8, right: 12, bottom: 5, left: 8 }}>
    <CartesianGrid stroke="#253044" strokeDasharray="3 3" /><XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={40} tickFormatter={v => String(v).slice(0, 7)} /><YAxis width={65} tick={{ fontSize: 10 }} tickFormatter={v => `${fmt(v, 1)} ${unit}`} domain={['auto', 'auto']} /><Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0' }} formatter={(v: number) => `${fmt(v)} ${unit}`} /><Legend wrapperStyle={{ fontSize: 11 }} /><ReferenceLine y={0} stroke="#475569" />
    {series.map((s, i) => <Line key={s.id} dataKey={s.id} name={s.label} stroke={colors[i % colors.length]} dot={false} connectNulls={false} isAnimationActive={false} strokeWidth={2} type="linear" />)}
  </LineChart></ResponsiveContainer></div><div className="text-xs text-muted-foreground space-y-1 mt-3">{series.map(s => <p key={s.id}><span>{s.label}</span>: {s.points.at(-1)?.date ?? 'sin datos'}</p>)}</div></>;
}
export function BondsView() {
  const state = usePanel<BondsPanel>('bonds');
  const [years, setYears] = useState(1);
  if (!state.data) return <Status {...state} />;
  const { series, etfs } = state.data;
  const choose = (...ids: string[]) => ids.flatMap(id => series.find(s => s.id === id) ?? []);
  // Same observation date for every maturity: never mix points from different days.
  const treasury = series.filter(s => s.id.startsWith('DGS'));
  const dateSets = treasury.map(s => new Set(s.points.map(p => p.date)));
  const common = treasury.length ? treasury[0].points.map(p => p.date).sort().reverse().find(d => dateSets.every(dates => dates.has(d))) : null;
  const curve = treasury.map(s => ({ maturity: s.label, yield: common ? s.points.find(p => p.date === common)?.value ?? null : null }));
  const historyStart = new Date(Date.now() - years * 365.25 * 86400000).toISOString().slice(0,10);
  return <div className="space-y-6"><div><h1 className="text-xl font-semibold tracking-wide text-primary">BONOS · EE. UU.</h1><p className="text-sm text-muted-foreground mt-2">Treasuries, tipos reales, inflación implícita, riesgo de crédito y ETF de renta fija. Datos actualizados con la última fecha disponible.</p></div>
    {state.error && <Status {...state} />}
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{choose('DGS2', 'DGS10', 'T10Y2Y', 'DFF').map(s => <Box key={s.id} title={s.label}><p className="text-2xl font-mono">{fmt(s.points.at(-1)?.value)} {s.unit}</p><p className="text-xs text-muted-foreground mt-2">{s.points.at(-1)?.date ?? 'Sin observaciones'}</p></Box>)}</div>
    <div className="grid lg:grid-cols-2 gap-4">
      <Box title={`CURVA DEL TESORO · ${common ?? 'sin fecha común disponible'}`}>
        {common ? <div className="h-72"><ResponsiveContainer width="100%" height="100%"><LineChart data={curve}><CartesianGrid stroke="#253044" /><XAxis dataKey="maturity" tick={{ fontSize: 10 }} /><YAxis unit="%" domain={['auto', 'auto']} tick={{ fontSize: 10 }} /><Tooltip contentStyle={{ background: '#0f172a', color: '#e2e8f0' }} formatter={(v: number) => `${fmt(v)}%`} /><Line dataKey="yield" name="Rendimiento" stroke="#60a5fa" strokeWidth={2} type="linear" /></LineChart></ResponsiveContainer></div> : <p className="text-sm">No hay una fecha común para todas las duraciones. Consulta las fechas de cada vencimiento.</p>}
        <div className="flex flex-wrap gap-3 text-xs mt-3">{treasury.map(s => <span key={s.id} className="text-muted-foreground">{s.label}: {fmt(s.points.at(-1)?.value)}% ({s.points.at(-1)?.date ?? 'N/D'})</span>)}</div>
      </Box>
      <Box title="TESORO · EVOLUCIÓN DE LOS TIPOS"><div className="flex gap-2 mb-4" role="group" aria-label="Horizonte del histórico del Tesoro">{[1,5,10].map(y=><button key={y} aria-pressed={years===y} onClick={()=>setYears(y)} className={`px-3 py-2 text-xs border ${years===y?'border-primary text-primary':'border-border'}`}>{y} {y===1?'año':'años'}</button>)}</div><History series={choose('DGS1', 'DGS5', 'DGS10').map(s=>({...s,points:s.points.filter(p=>p.date>=historyStart)}))} /></Box>
      <Box title="TIPO REAL E INFLACIÓN IMPLÍCITA · 10 AÑOS"><History series={choose('DFII10', 'T10YIE')} /></Box>
      <Box title="DIFERENCIALES DE CRÉDITO · OAS"><History series={choose('BAMLC0A0CM', 'BAMLH0A0HYM2')} unit="pp" /><p className="text-xs text-muted-foreground mt-2">1 punto porcentual (pp) = 100 puntos básicos.</p></Box>
    </div>
    <Box title="ETF DE BONOS · COTIZACIONES"><div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead className="text-muted-foreground"><tr>{['ETF', 'Exposición', 'Precio', 'Variación diaria', 'Fecha'].map(h => <th className="p-2" key={h}>{h}</th>)}</tr></thead><tbody>{etfs.map(e => <tr key={e.symbol} className="border-t border-border"><td className="p-2"><span className="text-primary">{e.symbol}</span></td><td className="p-2">{e.label}</td><td className="p-2 whitespace-nowrap">{fmt(e.price)} {e.currency}</td><td className="p-2">{fmt(e.change)}%</td><td className="p-2 whitespace-nowrap">{e.date ?? 'N/D'}</td></tr>)}</tbody></table></div><p className="text-xs text-muted-foreground mt-3">Los ETF tienen riesgo de tipos, crédito y fluctuación de precio; su cotización no es el rendimiento a vencimiento de un bono.</p></Box>
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
function Segments({ title, periods, disclosure }: { title: string; periods: SegmentPeriod[]; disclosure?: string }) {
  const [selected, setSelected] = useState('');
  const current = periods.find(p => p.date === selected) ?? periods[0];
  const sum = current?.segments.reduce((total, s) => total + s.value, 0) ?? 0;
  return <Box title={title}>{!current ? <p className="text-sm text-muted-foreground leading-relaxed">{disclosure || 'No se ha publicado un desglose comparable para el período más reciente.'}</p> : <>
    <select className="bg-background border border-border p-2 text-sm mb-3" aria-label={`Período de ${title}`} value={current.date} onChange={e => setSelected(e.target.value)}>{periods.map(p => <option key={p.date} value={p.date}>{p.period === 'quarterly' ? 'Trimestre cerrado' : 'Ejercicio cerrado'}: {p.date} · {p.currency}</option>)}</select>
    <div style={{ height: Math.max(250, current.segments.length * 32) }}><ResponsiveContainer width="100%" height="100%"><BarChart data={current.segments} layout="vertical" margin={{ right: 20 }}><CartesianGrid stroke="#253044" /><XAxis type="number" tickFormatter={compact} tick={{ fontSize: 10 }} /><YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 10 }} /><Tooltip formatter={(v: number) => `${fmt(v, 0)} ${current.currency}`} contentStyle={{ background: '#0f172a', color: '#e2e8f0' }} /><Bar dataKey="value" name="Ingresos" fill="#60a5fa" /></BarChart></ResponsiveContainer></div>
    <div className="overflow-x-auto"><table className="w-full text-xs text-left"><thead><tr><th className="p-2">Segmento</th><th className="p-2">{current.currency === '%' ? 'Distribución publicada (%)' : 'Ingresos (' + current.currency + ')' }</th><th className="p-2">% de la suma presentada</th></tr></thead><tbody>{current.segments.map(s => <tr key={s.name} className="border-t border-border"><td className="p-2">{s.name}</td><td className="p-2">{fmt(s.value, 0)}</td><td className="p-2">{sum > 0 ? fmt(s.value / sum * 100) + '%' : 'N/D'}</td></tr>)}</tbody></table></div><p className="text-xs text-muted-foreground mt-3">{current.currency === '%' ? 'Porcentajes publicados, sujetos a redondeo. El resto de mercados se calcula como diferencia hasta el 100 %; no se estima su importe.' : 'Importes del período indicado. Las eliminaciones contables se muestran cuando están publicadas.'}</p>
  </>}</Box>;
}
export function BusinessView({ ticker }: { ticker: string }) {
  const state = usePanel<BusinessPanel>('business', ticker);
  if (!state.data) return <Status {...state} />;
  const data = state.data;
  return <div className="space-y-5 py-3">{state.error && <Status {...state} />}
    <Box title="MODELO DE NEGOCIO">{data.summary ? <dl className="grid md:grid-cols-3 gap-5 text-sm">{[['Actividad', data.summary.activity], ['Clientes', data.summary.customers], ['Cómo genera ingresos', data.summary.revenueModel]].map(([label, value]) => <div key={label}><dt className="text-primary text-xs font-semibold mb-2">{label}</dt><dd className="leading-relaxed">{value}</dd></div>)}</dl> : <p className="text-sm leading-relaxed">{data.description || 'Resumen operativo no disponible.'}</p>}</Box>
    <div className="grid xl:grid-cols-2 gap-4"><Segments title="INGRESOS POR PRODUCTO O NEGOCIO" periods={data.products} disclosure={data.productDisclosure} /><Segments title="INGRESOS POR REGIÓN" periods={data.geography} disclosure={data.geographyDisclosure} /></div>
    <p className="text-xs text-muted-foreground">Productos y regiones son vistas distintas de los mismos ingresos; no se suman entre sí.</p>
    <Box title="SOCIOS Y COLABORACIONES · ÚLTIMOS 12 MESES">{data.partnerships?.length ? <div className="grid md:grid-cols-2 gap-4">{data.partnerships.map(p => <article key={p.partner + p.date} className="border border-border p-4"><h4 className="text-sm text-primary font-semibold">{p.partner}</h4><p className="text-xs text-muted-foreground mt-1">{p.date}</p><p className="text-sm leading-relaxed mt-3">{p.summary}</p></article>)}</div> : <p className="text-sm">No hay acuerdos anunciados disponibles para los últimos 12 meses.</p>}</Box><Stamp at={data.fetchedAt} /></div>;
}
