import { buildOpinions, editBusiness, recentPartnerships, type OpinionsPanel, type BusinessSummary, type Partnership } from "./editorial.ts";
export type { OpinionsPanel } from "./editorial.ts";
// On-demand panels with bounded per-isolate cache and request coalescing.
type Row = Record<string, any>;
export type Point = { date: string; value: number };
export type Article = { title: string; url: string; source: string; date: string; excerpt?: string };
export type Series = { id: string; label: string; unit: string; source: string; points: Point[] };
export type BondFund = { symbol: string; label: string; price: number | null; change: number | null; date: string | null; currency: string; points: Point[]; distributionYield: number | null; expenseRatio: number | null; assets: number | null };
export type BondsPanel = { fetchedAt: string; series: Series[]; etfs: BondFund[] };
export type Holder = { name: string; shares: number | null; value: number | null; pct: number | null; date: string | null; source: string; url: string };
export type InstitutionalPanel = { fetchedAt: string; holders: Holder[]; institutionalPct: number | null; documents: Article[]; sources: string[] };
export type SegmentPeriod = { date: string; currency: string; segments: { name: string; value: number }[] };
export type Channel = { name: string; evidence: string; url: string };
export type BusinessPanel = { fetchedAt: string; description: string; products: SegmentPeriod[]; geography: SegmentPeriod[]; channels: Channel[]; documents: Article[]; source: string; summary: BusinessSummary | null; partnerships: Partnership[] };
export type NewsPanel = { fetchedAt: string; articles: Article[]; sectorArticles?: Article[]; sectorName?: string };
type Env = { FMP_KEY: string; FRED_KEY: string; TAVILY_KEY: string; FINNHUB_KEY: string; GEMINI_API_KEY?: string };
type Dependencies = { summary: (ticker: string, modules: string) => Promise<Row | null> };
const cache = new Map<string, { expires: number; value: unknown }>();
const pending = new Map<string, Promise<unknown>>();
export async function cached<T>(key: string, ttl: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  if (pending.has(key)) return pending.get(key) as Promise<T>;
  const promise = fn().then(value => {
    if (cache.size >= 150) cache.delete(cache.keys().next().value!);
    cache.set(key, { expires: Date.now() + (value === null ? Math.min(ttl, 60000) : ttl), value });
    return value;
  }).finally(() => pending.delete(key));
  pending.set(key, promise);
  return promise;
}
const HOUR = 3600000;
const NEWS_DOMAINS = ['reuters.com', 'apnews.com', 'bloomberg.com', 'ft.com', 'wsj.com', 'cnbc.com', 'marketwatch.com', 'barrons.com', 'finance.yahoo.com', 'federalreserve.gov'];
const num = (v: unknown): number | null => {
  if (v && typeof v === 'object' && 'raw' in v) return num((v as Row).raw);
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};
const day = (v: unknown): string | null => {
  const raw = v && typeof v === 'object' ? (v as Row).raw : v;
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const time = typeof raw === 'number' ? raw * 1000 : Date.parse(raw);
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : null;
};
async function get(url: string, init?: RequestInit): Promise<Row | Row[] | null> {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(12000) });
    return response.ok ? await response.json() : null;
  } catch { return null; }
}
export function curateNews(articles: Article[], subject: string, now = Date.now(), limit = 5, thematic = false, maxAgeDays = 14): Article[] {
  const stop = new Set(['news', 'latest', 'sector', 'etf', 'inc', 'corp', 'the', 'and', 'of', 'de', 'del', 'la', 'trust', 'fund', 'funds', 'large', 'blend', 'index', 'state', 'street']);
  const tokens = subject.toLowerCase().match(/[\p{L}\p{N}]+/gu)?.filter(t => t.length > 1 && !stop.has(t)) ?? [];
  const noise = /\b(stocks? to buy|should you buy|best stocks|millionaire|motley fool|sponsored|promoted|price prediction|top \d+ stocks|buy now|worth buying|stock alert|urgent message|emmy|oscars|what you give up|here.s exactly)\b/i;
  const catalyst = /\b(earnings|revenue|guidance|merger|acquisition|regulat\w*|tariff\w*|lawsuits?|approval|contracts?|dividends?|buybacks?|rates?|inflation|flows?|holdings?|launch\w*|unveil\w*|debut\w*|results?|profits?|sales|yields?|policy|outflows?|inflows?|resultados|ingresos|beneficios?|tipos|fusi[oó]n|arancel\w*|demanda\w*|contrato\w*|inversi[oó]n|recort\w*|crecimiento|producci[oó]n)\b/i;
  const seenUrls = new Set<string>();
  const launches = new Map<string, number>();
  const titles: Set<string>[] = [];
  return articles.filter(a => {
    const date = Date.parse(a.date);
    if (!a.title || !Number.isFinite(date) || date < now - maxAgeDays * 86400000 || date > now + 86400000 || noise.test(a.title) || /\/video\/|\/livecoverage\//i.test(a.url) || /^letter:/i.test(a.title)) return false;
    try { if (!['http:', 'https:'].includes(new URL(a.url).protocol)) return false; } catch { return false; }
    const content = `${a.title} ${(a.excerpt ?? '').slice(0, 300)}`.toLowerCase();
    // A passing mention in a market roundup is not direct coverage of the subject.
    const relevantText = thematic ? `${a.title} ${(a.excerpt ?? '').slice(0, 300)}` : a.title;
    const words = new Set(relevantText.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
    return tokens.some(t => words.has(t)) && catalyst.test(content);
  }).sort((a, b) => b.date.localeCompare(a.date) || Number(b.url.includes('reuters.com')) - Number(a.url.includes('reuters.com'))).filter(a => {
    const url = new URL(a.url); url.search = ''; url.hash = '';
    const words = new Set(a.title.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
    const duplicate = seenUrls.has(url.href) || titles.some(other => {
      const overlap = [...words].filter(word => other.has(word)).length;
      return overlap >= 5 && overlap / Math.max(1, Math.min(words.size, other.size)) >= 0.6;
    });
    const product = ['iphone', 'ipad', 'airpods', 'watch', 'foldable'].find(name => new RegExp(`\\b${name}\\b`, 'i').test(a.title));
    const launch = product && /launch|unveil|debut|lanzamiento/i.test(`${a.title} ${a.excerpt ?? ''}`);
    const time = Date.parse(a.date);
    if (duplicate || (launch && launches.has(product!) && Math.abs(time - launches.get(product!)!) < 4 * 86400000)) return false;
    if (launch) launches.set(product!, time);
    seenUrls.add(url.href); titles.push(words); return true;
  }).slice(0, limit).map(a => ({ ...a, excerpt: (a.excerpt ?? '').replace(/[#*_]/g, '').split(/(?<=[.!?])\s+/).filter(sentence => {
    const words = new Set(sentence.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
    return tokens.some(t => words.has(t)) && sentence.length > 40 && !noise.test(sentence);
  }).slice(0, 1).join('').slice(0, 360) }));
}
async function search(query: string, key: string, news = false, domains: string[] = [], days = 14, maxResults = news ? 5 : 3): Promise<Article[]> {
  if (!key) return [];
  return cached(`search:${news}:${query}:${domains.join(',')}:${days}:${maxResults}`, news ? HOUR : 24 * HOUR, async () => {
    const raw = await get('https://api.tavily.com/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: key, query, search_depth: 'basic', max_results: maxResults, include_answer: false, ...(news ? { topic: 'news', days } : {}), ...(domains.length ? { include_domains: domains } : {}) }) });
    const rows = (raw as Row)?.results;
    return Array.isArray(rows) ? rows.filter((r: Row) => /^https?:\/\//.test(r.url ?? '')).map((r: Row) => ({ title: String(r.title ?? ''), url: r.url, source: new URL(r.url).hostname, date: day(r.published_date) ?? '', excerpt: String(r.content ?? '').slice(0, 900) })) : [];
  });
}
export async function newsPanel(subject: string, sector: boolean, env: Env, deps?: Dependencies): Promise<NewsPanel> {
  return cached(`news:${sector}:${subject}`, HOUR, async () => {
    const aliases: Record<string, string> = { semiconductores: 'semiconductors semiconductor chips', 'inteligencia artificial': 'artificial intelligence AI', 'energía': 'energy oil gas', salud: 'healthcare pharmaceutical biotech', defensa: 'defense aerospace', consumo: 'consumer retail', 'tecnología': 'technology software', bancos: 'banks banking', 'inmobiliario': 'real estate REIT' };
    const topic = sector ? `${subject} ${aliases[subject.toLowerCase()] ?? ''}` : subject;
    const [raw, profile] = await Promise.all([
      get(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(topic)}&newsCount=15&quotesCount=${sector ? 0 : 1}`, { headers: { 'User-Agent': 'Mozilla/5.0' } }),
      !sector && deps ? cached(`news-name:${subject}`, 24 * HOUR, () => deps.summary(subject, 'quoteType,assetProfile,fundProfile')) : null,
    ]);
    const data = raw as Row;
    const company = sector ? topic : profile?.quoteType?.longName ?? profile?.quoteType?.shortName ?? data?.quotes?.[0]?.longname ?? data?.quotes?.[0]?.shortname ?? subject;
    const rows: Article[] = (data?.news ?? []).map((r: Row) => ({ title: r.title, url: r.link, source: r.publisher, date: day(r.providerPublishTime) ?? '' }));
    const trusted = (a: Article) => { try { return NEWS_DOMAINS.some(domain => new URL(a.url).hostname === domain || new URL(a.url).hostname.endsWith('.' + domain)); } catch { return false; } };
    const thematic = sector || profile?.quoteType?.quoteType === 'ETF';
    const category = profile?.fundProfile?.categoryName ?? '';
    const broadUsMarket = thematic && /^(SPY|VOO|IVV|VTI|ITOT|SCHB)$/.test(subject);
    const sectorName = sector ? subject : broadUsMarket ? 'Bolsa de EE. UU.' : profile?.assetProfile?.sector || category || (thematic ? company : '');
    const sectorContexts: Record<string, string> = { Technology: 'technology software semiconductor chips AI Nvidia Microsoft Apple cloud', 'Bolsa de EE. UU.': 'S&P 500 Nasdaq equities stocks market Fed inflation', Healthcare: 'healthcare pharmaceutical biotech FDA drugs', Financials: 'banks banking insurance financial', 'Financial Services': 'banks banking insurance financial', Energy: 'energy oil gas OPEC', 'Consumer Cyclical': 'consumer retail automotive sales', 'Consumer Defensive': 'consumer staples retail food', Industrials: 'industrial manufacturing aerospace transport', 'Real Estate': 'real estate REIT property housing', Utilities: 'utilities electricity power', 'Basic Materials': 'materials metals mining chemicals', 'Communication Services': 'telecom streaming advertising media' };
    async function selection(name: string, initial: Article[], theme: boolean, query = name, required?: RegExp) {
      let candidates = initial.filter(trusted);
      const choose = (days: number) => curateNews(required ? candidates.filter(a => required.test(a.title)) : candidates, name, Date.now(), 6, theme, days);
      let selected = choose(30);
      if (selected.length < 6) {
        candidates = [...candidates, ...await search(query + ' news', env.TAVILY_KEY, true, NEWS_DOMAINS, 30, 18)].filter(trusted);
        selected = choose(30);
      }
      if (selected.length < 6) {
        candidates = [...candidates, ...await search(query + ' earnings outlook', env.TAVILY_KEY, true, NEWS_DOMAINS, 90, 18)].filter(trusted);
        selected = choose(90);
      }
      return selected;
    }
    const [articles, sectorArticles] = await Promise.all([
      selection(`${subject} ${company}`, rows, thematic, broadUsMarket ? `${subject} S&P 500 ETF` : company, broadUsMarket ? /\bSPY\b|\bSPDR\b|\bVOO\b|\bIVV\b|\bVTI\b|S&P\s*500|S.P.500/i : undefined),
      !sector && sectorName ? selection(sectorContexts[sectorName] ?? sectorName, [], true, broadUsMarket ? 'US stock market' : sectorName + ' sector') : Promise.resolve([]),
    ]);
    return { fetchedAt: new Date().toISOString(), articles, sectorArticles, sectorName };
  });
}
const FRED_SERIES = [
  ['DGS1MO', '1 mes'], ['DGS3MO', '3 meses'], ['DGS6MO', '6 meses'], ['DGS1', '1 año'], ['DGS2', '2 años'], ['DGS5', '5 años'], ['DGS10', '10 años'], ['DGS30', '30 años'],
  ['DFII10', 'Tipo real a 10 años'], ['T10YIE', 'Inflación implícita a 10 años'], ['T10Y2Y', 'Diferencial 10–2 años'], ['BAMLC0A0CM', 'Crédito investment grade (OAS)'], ['BAMLH0A0HYM2', 'Crédito high yield (OAS)'], ['DFF', 'Fed Funds efectivo'],
];
const BOND_ETFS = [['BND', 'Mercado de bonos EE. UU.'], ['AGG', 'Bonos agregados EE. UU.'], ['SHY', 'Treasury 1–3 años'], ['IEF', 'Treasury 7–10 años'], ['TLT', 'Treasury más de 20 años'], ['TIP', 'Protección frente a inflación'], ['LQD', 'Corporativo investment grade'], ['HYG', 'Corporativo high yield']];
export async function bondsPanel(env: Env, deps?: Dependencies): Promise<BondsPanel> {
  // UTC date in the cache key guarantees a fresh request on each new day.
  return cached(`bonds:${new Date().toISOString().slice(0, 10)}`, HOUR, async () => {
    const start = new Date(Date.now() - 3660 * 86400000).toISOString().slice(0, 10);
    const series = await Promise.all(FRED_SERIES.map(async ([id, label]): Promise<Series> => {
      const raw = env.FRED_KEY ? await get(`https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${encodeURIComponent(env.FRED_KEY)}&file_type=json&observation_start=${id.startsWith("DGS") ? start : new Date(Date.now() - 370 * 86400000).toISOString().slice(0, 10)}`) : null;
      const points: Point[] = ((raw as Row)?.observations ?? []).filter((r: Row) => r.value !== '.' && r.value !== '' && Number.isFinite(Number(r.value))).map((r: Row) => ({ date: r.date, value: Number(r.value) }));
      return { id, label, unit: ['T10Y2Y', 'BAMLC0A0CM', 'BAMLH0A0HYM2'].includes(id) ? 'pp' : '%', source: `https://fred.stlouisfed.org/series/${id}`, points };
    }));
    const etfs = await Promise.all(BOND_ETFS.map(async ([symbol, label]): Promise<BondFund> => {
      const [raw, summary] = await Promise.all([
        get(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=5d&interval=1d`, { headers: { 'User-Agent': 'Mozilla/5.0' } }),
        null,
      ]);
      const chart = (raw as Row)?.chart?.result?.[0];
      const close = chart?.indicators?.quote?.[0]?.close ?? [];
      const points: Point[] = (chart?.timestamp ?? []).map((t: number, i: number) => ({ date: day(t)!, value: num(close[i]) })).filter((p: Point) => p.value !== null && p.date);
      const meta = chart?.meta ?? {};
      const price = num(meta.regularMarketPrice);
      const quoteDay = day(meta.regularMarketTime);
      const previous = points.filter(p => quoteDay && p.date < quoteDay).at(-1)?.value ?? null;
      const yieldValue = num(summary?.summaryDetail?.trailingAnnualDividendYield);
      const expense = num(summary?.fundProfile?.feesExpensesInvestment?.annualReportExpenseRatio);
      return { symbol, label, price, change: price !== null && previous && previous > 0 ? (price / previous - 1) * 100 : null, date: day(meta.regularMarketTime), currency: meta.currency ?? 'USD', points, distributionYield: yieldValue !== null ? yieldValue * 100 : null, expenseRatio: expense !== null ? expense * 100 : null, assets: num(summary?.summaryDetail?.totalAssets) };
    }));
    return { fetchedAt: new Date().toISOString(), series, etfs };
  });
}
export function fmpHolders(ticker: string, key: string) {
  return cached(`fmp-holders:${ticker}`, 24 * HOUR, () => key ? get(`https://financialmodelingprep.com/api/v3/institutional-holder/${encodeURIComponent(ticker)}?apikey=${encodeURIComponent(key)}`) : Promise.resolve(null));
}
export async function institutionalPanel(ticker: string, env: Env, deps: Dependencies): Promise<OpinionsPanel> {
  return cached(`opinions:${ticker}`, 24 * HOUR, async () => {
    const [summary, grades, targets] = await Promise.all([
      deps.summary(ticker, 'upgradeDowngradeHistory,financialData,quoteType,price'),
      env.FMP_KEY ? get(`https://financialmodelingprep.com/stable/grades?symbol=${encodeURIComponent(ticker)}&apikey=${encodeURIComponent(env.FMP_KEY)}`) : null,
      env.FMP_KEY ? get(`https://financialmodelingprep.com/stable/price-target-news?symbol=${encodeURIComponent(ticker)}&limit=50&apikey=${encodeURIComponent(env.FMP_KEY)}`) : null,
    ]);
    const isEtf = summary?.quoteType?.quoteType === 'ETF';
    return { holders: [], institutionalPct: null, documents: [], sources: [], fetchedAt: new Date().toISOString(), isEtf, opinions: buildOpinions(summary, grades, targets), currentPrice: num(summary?.price?.regularMarketPrice), consensusTarget: isEtf ? null : num(summary?.financialData?.targetMeanPrice), currency: summary?.price?.currency ?? 'USD' };
  });
}
export function segmentPeriods(raw: unknown): SegmentPeriod[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((row: Row) => {
    const date = day(row.date);
    if (!date || !row.data || typeof row.data !== 'object') return [];
    const segments = Object.entries(row.data).filter(([name, value]) => num(value) !== null && !/^(total|total revenue|revenue|net sales)$/i.test(name)).map(([name, value]) => ({ name, value: num(value)! }));
    return segments.length ? [{ date, currency: row.reportedCurrency ?? 'N/D', segments }] : [];
  }).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4);
}
export function extractChannels(documents: Article[]): Channel[] {
  const patterns: [string, RegExp][] = [
    ['Venta directa', /\bdirect sales|\bdirect distribution|\bdirect-to-consumer|venta directa/i],
    ['Tiendas y comercio minorista', /retail (?:and online )?stores|retail outlets|tiendas|retail distribution/i],
    ['Distribuidores y socios', /resellers|distributors|channel partners|distribuidores|intermediarios/i],
    ['Canal digital', /online stores|online sales|e-commerce|ecommerce|venta online/i],
    ['Suscripciones', /subscription services|subscription revenue|suscripciones/i],
    ['Licencias', /licensing revenue|license sales|licensing agreements|licencias/i],
  ];
  return patterns.flatMap(([name, pattern]) => {
    for (const doc of documents) {
      const sentence = (doc.excerpt ?? '').split(/(?<=[.!?])\s+|\n/).find(s => pattern.test(s));
      if (sentence) return [{ name, evidence: sentence.trim().slice(0, 700), url: doc.url }];
    }
    return [];
  });
}
export async function businessPanel(ticker: string, env: Env, deps: Dependencies): Promise<BusinessPanel> {
  return cached(`business:${ticker}`, 24 * HOUR, async () => {
    const [summary, products, geography, profileRaw] = await Promise.all([
      deps.summary(ticker, 'assetProfile'),
      env.FMP_KEY ? get(`https://financialmodelingprep.com/stable/revenue-product-segmentation?symbol=${encodeURIComponent(ticker)}&period=annual&apikey=${encodeURIComponent(env.FMP_KEY)}`) : null,
      env.FMP_KEY ? get(`https://financialmodelingprep.com/stable/revenue-geographic-segmentation?symbol=${encodeURIComponent(ticker)}&period=annual&apikey=${encodeURIComponent(env.FMP_KEY)}`) : null,
      env.FMP_KEY ? get(`https://financialmodelingprep.com/stable/profile?symbol=${encodeURIComponent(ticker)}&apikey=${encodeURIComponent(env.FMP_KEY)}`) : null,
    ]);
    const profile = Array.isArray(profileRaw) ? profileRaw[0] : null;
    const company = profile?.companyName ?? ticker;
    const description = summary?.assetProfile?.longBusinessSummary ?? profile?.description ?? '';
    const shortCompany = company.replace(/ (inc\.?|corporation|corp\.?)$/i, '');
    const partnershipDomains = [...NEWS_DOMAINS];
    try { if (profile?.website) partnershipDomains.push(new URL(profile.website).hostname); } catch { /* optional company website */ }
    let candidates = await search(`${shortCompany} partnership`, env.TAVILY_KEY, true, partnershipDomains, 365, 18);
    if (recentPartnerships(candidates).length < 3) candidates = [...candidates, ...await search(`${shortCompany} collaboration agreement`, env.TAVILY_KEY, true, partnershipDomains, 365, 18)];
    const documents = recentPartnerships(candidates).filter(doc => {
      const text = `${doc.title} ${doc.excerpt ?? ''}`.toLowerCase();
      return text.includes(ticker.toLowerCase()) || text.includes(company.toLowerCase().replace(/ (inc\.?|corporation|corp\.?)$/i, ''));
    });
    const editorial = await editBusiness(description, company, documents, env.GEMINI_API_KEY ?? '');
    return { fetchedAt: new Date().toISOString(), description: '', products: segmentPeriods(products), geography: segmentPeriods(geography), channels: [], documents, source: '', summary: editorial.summary, partnerships: editorial.partnerships };
  });
}
