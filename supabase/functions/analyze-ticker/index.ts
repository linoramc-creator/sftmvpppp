// ============================================================
// UNIFIED ANALYZE FUNCTION
// Handles both TICKER analysis (body: { ticker: "AAPL" })
// and    SECTOR analysis  (body: { sector: "Semiconductores" })
// ============================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// =====================================================
// SHARED HELPERS
// =====================================================

async function fetchTavilySearch(
  query: string,
  key: string,
  maxResults = 5,
  days?: number,
  topic?: string,
  contentLen = 150,
) {
  try {
    const body: Record<string, unknown> = {
      api_key: key,
      query,
      search_depth: "basic",
      max_results: maxResults,
      include_answer: true,
    };
    if (days) body.days = days;
    if (topic) body.topic = topic;

    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { answer: "", results: [] };
    const data = await res.json();
    return {
      answer: (data.answer ?? "").slice(0, 300),
      results: (data.results ?? []).map((r: any) => ({
        title: r.title,
        content: (r.content ?? "").slice(0, contentLen),
        published_date: r.published_date ?? "",
        url: r.url ?? "",
      })),
    };
  } catch (_) { return { answer: "", results: [] }; }
}

async function fetchFredData(key: string): Promise<string> {
  if (!key) return "";
  try {
    const series = [
      { id: "FEDFUNDS", label: "Fed Funds Rate" },
      { id: "DGS10",    label: "10Y Treasury Yield" },
      { id: "UNRATE",   label: "Unemployment Rate" },
    ];

    const results = await Promise.all(
      series.map(async (s) => {
        const res = await fetch(
          `https://api.stlouisfed.org/fred/series/observations?series_id=${s.id}&apikey=${key}&limit=1&sort_order=desc&file_type=json`
        ).catch(() => null);
        if (!res?.ok) return null;
        const data = await res.json().catch(() => null);
        const obs = data?.observations?.[0];
        return obs ? `${s.label}: ${obs.value}% (${obs.date})` : null;
      })
    );

    const cpiRes = await fetch(
      `https://api.stlouisfed.org/fred/series/observations?series_id=CPIAUCSL&apikey=${key}&limit=14&sort_order=desc&file_type=json`
    ).catch(() => null);
    let cpiLine: string | null = null;
    if (cpiRes?.ok) {
      const cpiData = await cpiRes.json().catch(() => null);
      const obs: any[] = cpiData?.observations ?? [];
      if (obs.length >= 13) {
        const cur = parseFloat(obs[0].value);
        const prev = parseFloat(obs[12].value);
        if (!isNaN(cur) && !isNaN(prev) && prev > 0) {
          cpiLine = `CPI Inflation YoY: ${((cur - prev) / prev * 100).toFixed(2)}% (${obs[0].date})`;
        }
      }
    }

    const valid = [...results.filter(Boolean), cpiLine].filter(Boolean);
    if (!valid.length) return "";
    return ["--- INDICADORES MACRO USA (FRED / RESERVA FEDERAL) ---", ...valid].join("\n");
  } catch (_) { return ""; }
}

function fmt(val: number | null | undefined, unit: "M" | "B" | "pct" | "x" | "raw" = "M"): string {
  if (val == null || isNaN(val)) return "N/D";
  if (unit === "pct") return `${val >= 0 ? "+" : ""}${val.toFixed(1)}%`;
  if (unit === "B") return `$${(val / 1_000_000_000).toFixed(2)}B`;
  if (unit === "M") return `$${(val / 1_000_000).toFixed(0)}M`;
  if (unit === "x") return `${val.toFixed(2)}x`;
  return val.toFixed(2);
}

function n2(v: number | null | undefined): string {
  if (v == null || isNaN(Number(v))) return "N/D";
  return Number(v).toFixed(2);
}

// =====================================================
// DATA-CLEANING UTILITIES  (anti-empty-charts)
// Yahoo (and others) return NaN / null / undefined for missing periods and
// ratios. These helpers guarantee the JSON shape never breaks the frontend
// charts and that "NaN is not valid JSON" can never be thrown.
// =====================================================

// Coerce any value to a JSON-safe finite number or null. Strings like "" or
// "Infinity" and Pandas-style NaN all collapse to null.
function jsonSafeNum(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : null;
}

// Forward-fill a numeric series: gaps (null/NaN) take the last valid value.
// Leading gaps (before the first valid value) are back-filled from the first
// valid value, so a chart line never starts on a hole. If the whole series is
// empty it stays all-null (the chart simply renders nothing for that metric).
function forwardFill(series: (number | null | undefined)[]): (number | null)[] {
  const out: (number | null)[] = [];
  let last: number | null = null;
  for (const raw of series) {
    const v = jsonSafeNum(raw);
    if (v != null) { last = v; out.push(v); }
    else out.push(last);
  }
  const firstValid = out.find((v) => v != null) ?? null;
  for (let i = 0; i < out.length && out[i] == null; i++) out[i] = firstValid;
  return out;
}

// Recursively replace every NaN/Infinity inside a value with null so the whole
// object is guaranteed JSON-serializable.
function deepJsonSafe<T>(value: T): T {
  if (typeof value === "number") return (Number.isFinite(value) ? value : null) as unknown as T;
  if (Array.isArray(value)) return value.map(deepJsonSafe) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = deepJsonSafe(v);
    return out as T;
  }
  return value;
}

// =====================================================
// YAHOO FINANCE  (primary fundamentals + history source)
//   · native fetch — no library (Deno edge runtime)
//   · in-memory TTL cache to avoid IP rate-limits / blocks
//   · cookie + crumb auth handled manually (required since 2024)
// =====================================================

const YF_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

interface YfCacheEntry { ts: number; data: unknown; }
const YF_CACHE = new Map<string, YfCacheEntry>();
const YF_TTL_MS = 10 * 60 * 1000; // fundamentals barely move intraday

function yfCacheGet(key: string): unknown | undefined {
  const e = YF_CACHE.get(key);
  if (!e) return undefined;
  if (Date.now() - e.ts > YF_TTL_MS) { YF_CACHE.delete(key); return undefined; }
  return e.data;
}
function yfCacheSet(key: string, data: unknown): void {
  YF_CACHE.set(key, { ts: Date.now(), data });
  if (YF_CACHE.size > 250) {
    let oldestKey: string | null = null;
    let oldestTs = Infinity;
    for (const [k, v] of YF_CACHE) if (v.ts < oldestTs) { oldestTs = v.ts; oldestKey = k; }
    if (oldestKey) YF_CACHE.delete(oldestKey);
  }
}

let yfAuth: { cookie: string; crumb: string; ts: number } | null = null;
const YF_AUTH_TTL = 25 * 60 * 1000;

async function yfGetAuth(): Promise<{ cookie: string; crumb: string } | null> {
  if (yfAuth && Date.now() - yfAuth.ts < YF_AUTH_TTL) return yfAuth;
  try {
    const readCookies = (r: Response | null): string => {
      if (!r) return "";
      const multi = (r.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
      if (multi.length) return multi.map((c) => c.split(";")[0]).join("; ");
      const one = r.headers.get("set-cookie");
      return one ? one.split(";")[0] : "";
    };

    let cookie = readCookies(
      await fetch("https://fc.yahoo.com/", { headers: { "User-Agent": YF_UA }, signal: AbortSignal.timeout(8_000) }).catch(() => null),
    );
    if (!cookie) {
      cookie = readCookies(
        await fetch("https://finance.yahoo.com/quote/AAPL", { headers: { "User-Agent": YF_UA }, signal: AbortSignal.timeout(8_000) }).catch(() => null),
      );
    }

    const r2 = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
      headers: { "User-Agent": YF_UA, ...(cookie ? { Cookie: cookie } : {}) },
      signal: AbortSignal.timeout(8_000),
    }).catch(() => null);
    const crumb = r2 && r2.ok ? (await r2.text()).trim() : "";
    // Some regions still serve quoteSummary/timeseries without a crumb; only
    // cache auth when we actually have one, but don't hard-fail without it.
    if (crumb) { yfAuth = { cookie, crumb, ts: Date.now() }; return yfAuth; }
    return cookie ? { cookie, crumb: "" } : null;
  } catch (_) { return null; }
}

// Daily price history via the public v8 chart endpoint (no crumb required).
async function fetchYahooChart(
  symbol: string,
  range = "3mo",
  interval = "1d",
): Promise<{ t: number[]; c: number[] } | null> {
  const cacheKey = `yf-chart-${symbol}-${range}-${interval}`;
  const cached = yfCacheGet(cacheKey);
  if (cached !== undefined) return cached as { t: number[]; c: number[] } | null;
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
    const r = await fetch(url, { headers: { "User-Agent": YF_UA }, signal: AbortSignal.timeout(9_000) });
    if (!r.ok) { yfCacheSet(cacheKey, null); return null; }
    const j = await r.json();
    const res = j?.chart?.result?.[0];
    const ts: number[] | undefined = res?.timestamp;
    const closes: Array<number | null> | undefined = res?.indicators?.quote?.[0]?.close;
    if (!ts || !closes || ts.length === 0) { yfCacheSet(cacheKey, null); return null; }
    // Forward-fill close gaps so the line never breaks, keep timestamps aligned.
    const filled = forwardFill(closes);
    const t: number[] = [];
    const c: number[] = [];
    for (let i = 0; i < ts.length; i++) {
      if (filled[i] != null) { t.push(ts[i]); c.push(filled[i] as number); }
    }
    const out = c.length > 1 ? { t, c } : null;
    yfCacheSet(cacheKey, out);
    return out;
  } catch (_) { yfCacheSet(cacheKey, null); return null; }
}

// Quarterly fundamentals via the fundamentals-timeseries endpoint. Returns the
// raw `timeseries.result` array (one entry per requested metric) or null.
async function yfFundamentalsTimeseries(symbol: string): Promise<any[] | null> {
  const cacheKey = `yf-fund-${symbol}`;
  const cached = yfCacheGet(cacheKey);
  if (cached !== undefined) return cached as any[] | null;

  const auth = await yfGetAuth();
  const types = [
    "quarterlyTotalRevenue", "quarterlyNetIncome", "quarterlyGrossProfit",
    "quarterlyOperatingIncome", "quarterlyEBITDA", "quarterlyNormalizedEBITDA",
    "quarterlyDilutedEPS", "quarterlyBasicEPS",
    "quarterlyOperatingCashFlow", "quarterlyFreeCashFlow", "quarterlyCapitalExpenditure",
    "quarterlyInvestingCashFlow", "quarterlyFinancingCashFlow",
    "quarterlyCashAndCashEquivalents", "quarterlyCashCashEquivalentsAndShortTermInvestments",
    "quarterlyTotalDebt", "quarterlyStockholdersEquity", "quarterlyTotalAssets",
  ];
  const now = Math.floor(Date.now() / 1000);
  const start = now - 6 * 365 * 24 * 3600; // ~6 years → up to 24 quarters
  const base = "https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries";
  const url =
    `${base}/${encodeURIComponent(symbol)}?symbol=${encodeURIComponent(symbol)}` +
    `&type=${types.join(",")}&period1=${start}&period2=${now}&merge=false` +
    (auth?.crumb ? `&crumb=${encodeURIComponent(auth.crumb)}` : "");
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": YF_UA, ...(auth?.cookie ? { Cookie: auth.cookie } : {}) },
      signal: AbortSignal.timeout(12_000),
    });
    if (!r.ok) { console.log(`Yahoo ${symbol} timeseries HTTP ${r.status}`); yfCacheSet(cacheKey, null); return null; }
    const j = await r.json();
    const result = j?.timeseries?.result;
    const out = Array.isArray(result) ? result : null;
    yfCacheSet(cacheKey, out);
    return out;
  } catch (_) { yfCacheSet(cacheKey, null); return null; }
}

// Convert Yahoo's timeseries into the same row shape every other source emits,
// so it slots straight into mergeQuarterlyData() as the highest-priority source.
async function fetchYahooQuarterlyFinancials(ticker: string): Promise<any[]> {
  const result = await yfFundamentalsTimeseries(ticker);
  if (!result) { console.log(`Yahoo ${ticker}: no fundamentals`); return []; }

  // type -> Map<asOfDate, rawNumber|null>
  const byType = new Map<string, Map<string, number | null>>();
  for (const series of result) {
    const type: string | undefined = series?.meta?.type?.[0];
    if (!type) continue;
    const arr = series[type];
    if (!Array.isArray(arr)) continue;
    const m = new Map<string, number | null>();
    for (const pt of arr) {
      if (!pt?.asOfDate) continue;
      m.set(pt.asOfDate, jsonSafeNum(pt?.reportedValue?.raw));
    }
    byType.set(type, m);
  }

  const dates = new Set<string>();
  for (const m of byType.values()) for (const d of m.keys()) dates.add(d);
  const allDates = [...dates].sort((a, b) => b.localeCompare(a)); // newest first
  const pick = (type: string, date: string) => byType.get(type)?.get(date) ?? null;

  const rows = allDates.map((date, idx) => {
    const rev         = pick("quarterlyTotalRevenue", date);
    const grossProfit = pick("quarterlyGrossProfit", date);
    const ebitda      = pick("quarterlyEBITDA", date) ?? pick("quarterlyNormalizedEBITDA", date);
    const netIncome   = pick("quarterlyNetIncome", date);
    const eps         = pick("quarterlyDilutedEPS", date) ?? pick("quarterlyBasicEPS", date);

    const opCF        = pick("quarterlyOperatingCashFlow", date);
    const capexRaw    = pick("quarterlyCapitalExpenditure", date); // negative outflow
    const capex       = capexRaw != null ? Math.abs(capexRaw) : null;
    const fcf         = pick("quarterlyFreeCashFlow", date)
                      ?? (opCF != null && capexRaw != null ? opCF + capexRaw : null);
    const investingCF = pick("quarterlyInvestingCashFlow", date);
    const financingCF = pick("quarterlyFinancingCashFlow", date);

    const cash        = pick("quarterlyCashAndCashEquivalents", date)
                      ?? pick("quarterlyCashCashEquivalentsAndShortTermInvestments", date);
    const totalDebt   = pick("quarterlyTotalDebt", date);
    const equity      = pick("quarterlyStockholdersEquity", date);
    const totalAssets = pick("quarterlyTotalAssets", date);
    const netDebt     = (totalDebt != null && cash != null) ? totalDebt - cash : null;

    const prevDate = allDates[idx + 4];
    const prevRev  = prevDate ? pick("quarterlyTotalRevenue", prevDate) : null;
    const revGrowth = (rev != null && prevRev != null && Math.abs(prevRev) > 0)
      ? `${((rev - prevRev) / Math.abs(prevRev) * 100) >= 0 ? "+" : ""}${((rev - prevRev) / Math.abs(prevRev) * 100).toFixed(1)}%`
      : "N/D";

    return {
      period:        date,
      revenue:       fmt(rev, "B"),
      revenueGrowth: revGrowth,
      grossMargin:   (rev != null && rev !== 0 && grossProfit != null) ? `${((grossProfit / rev) * 100).toFixed(1)}%` : "N/D",
      ebitda:        fmt(ebitda, "B"),
      netIncome:     fmt(netIncome, "B"),
      netMargin:     (rev != null && rev !== 0 && netIncome != null) ? `${((netIncome / rev) * 100).toFixed(1)}%` : "N/D",
      eps:           eps != null ? `$${Number(eps).toFixed(2)}` : "N/D",
      operatingCF:   fmt(opCF, "B"),
      freeCashFlow:  fmt(fcf, "B"),
      capex:         capex != null ? fmt(capex, "B") : "N/D",
      investingCF:   fmt(investingCF, "B"),
      financingCF:   fmt(financingCF, "B"),
      cash:          fmt(cash, "B"),
      totalDebt:     fmt(totalDebt, "B"),
      netDebt:       fmt(netDebt, "B"),
      equity:        fmt(equity, "B"),
      totalAssets:   fmt(totalAssets, "B"),
    };
  }).filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.period)).slice(0, 16);

  console.log(`Yahoo ${ticker}: ${rows.length} quarters`);
  return rows;
}

// =====================================================
// GEMINI (shared fallback chain)
// =====================================================

type GeminiResult =
  | { ok: true;  response: Response; model: string }
  | { ok: false; status: number; error: string };

async function callGeminiStream(messages: any[], apiKey: string): Promise<GeminiResult> {
  const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
  // Pro first for best analysis quality. Flash as fast fallback.
  // Keepalives in the response stream prevent Supabase's idle timeout
  // so Pro's 60-90s generation time is no longer a problem.
  const GEMINI_MODELS = [
    "gemini-2.5-pro",
    "gemini-2.5-pro-latest",
    "gemini-2.5-flash",
    "gemini-2.5-flash-latest",
    "gemini-2.0-flash",
    "gemini-3.1-pro-preview",
    "gemini-3-pro-preview",
    "gemini-3-pro-latest",
    "gemini-3.0-pro",
    "gemini-3-pro",
  ];

  for (const model of GEMINI_MODELS) {
    let res: Response;
    try {
      res = await fetch(GEMINI_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messages, stream: true, model }),
        signal: AbortSignal.timeout(100_000),
      });
    } catch (e: any) {
      if (e?.name === "TimeoutError") { console.warn(`Gemini [${model}] timed out, trying next`); continue; }
      throw e;
    }
    console.log(`Gemini [${model}] status:`, res.status);
    if (res.ok) return { ok: true, response: res, model };

    if (res.status === 401 || res.status === 403) {
      return { ok: false, status: 403, error: "API key de Gemini inválida o sin permisos." };
    }
    if (res.status === 429) {
      return { ok: false, status: 429, error: "Límite de solicitudes Gemini. Inténtalo en unos segundos." };
    }
    const errBody = await res.text();
    console.warn(`Model ${model} unavailable (${res.status}): ${errBody.substring(0, 150)}. Trying next...`);
  }

  return { ok: false, status: 503, error: "Todos los modelos Gemini están saturados. Inténtalo en unos segundos." };
}

function jsonError(error: string, status: number): Response {
  return new Response(
    JSON.stringify({ error }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// =====================================================
// TICKER: FINNHUB
// =====================================================

async function finnhubGet(path: string, key: string) {
  try {
    const res = await fetch(`https://finnhub.io/api/v1${path}&token=${key}`, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    return res.json();
  } catch (_) { return null; }
}

async function fetchFinnhubData(ticker: string, key: string) {
  const t = encodeURIComponent(ticker);
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  const [quote, profile, metrics, recs, news, peers] = await Promise.all([
    finnhubGet(`/quote?symbol=${t}`, key),
    finnhubGet(`/stock/profile2?symbol=${t}`, key),
    finnhubGet(`/stock/metric?symbol=${t}&metric=all`, key),
    finnhubGet(`/stock/recommendation?symbol=${t}`, key),
    finnhubGet(`/company-news?symbol=${t}&from=${monthAgo}&to=${today}`, key),
    finnhubGet(`/stock/peers?symbol=${t}`, key),
  ]);

  return {
    quote: quote ?? null,
    profile: profile ?? null,
    metrics: metrics?.metric ?? null,
    recommendations: Array.isArray(recs) && recs.length > 0 ? recs[0] : null,
    allRecommendations: Array.isArray(recs) ? recs.slice(0, 6) : [],
    news: Array.isArray(news)
      ? news.slice(0, 6).map((n: any) => ({ headline: n.headline, source: n.source, url: n.url ?? "" }))
      : [],
    peers: Array.isArray(peers) ? peers.filter((p: string) => p !== ticker).slice(0, 4) : [],
  };
}

async function fetchPeerData(peers: string[], key: string) {
  if (!peers.length || !key) return [];
  const results = await Promise.all(
    peers.slice(0, 5).map(async (peer) => {
      const t = encodeURIComponent(peer);
      const [quote, profile, metrics] = await Promise.all([
        finnhubGet(`/quote?symbol=${t}`, key),
        finnhubGet(`/stock/profile2?symbol=${t}`, key),
        finnhubGet(`/stock/metric?symbol=${t}&metric=all`, key),
      ]);
      const m = metrics?.metric ?? null;
      const mc = profile?.marketCapitalization ?? null;

      const currentEv = m?.currentEv;
      const ebitdPerShare = m?.ebitdPerShareTTM;
      const sharesOut = profile?.shareOutstanding;
      let evEbitda: string | number = "N/D";
      if (currentEv && ebitdPerShare && sharesOut && ebitdPerShare > 0) {
        const ebitda = ebitdPerShare * sharesOut;
        if (ebitda > 0) evEbitda = (currentEv / ebitda).toFixed(1);
      }

      return {
        ticker: peer,
        name: profile?.name ?? peer,
        price: quote?.c != null ? `$${Number(quote.c).toFixed(2)}` : "N/D",
        marketCap: mc ? `$${(mc / 1000).toFixed(1)}B` : "N/D",
        pe: m?.peBasicExclExtraTTM ?? m?.peTTM ?? "N/D",
        pb: m?.pbAnnual ?? m?.pbQuarterly ?? "N/D",
        evEbitda,
        roe: m?.roeTTM != null ? `${Number(m.roeTTM).toFixed(1)}%` : "N/D",
        netMargin: m?.netProfitMarginTTM != null ? `${Number(m.netProfitMarginTTM).toFixed(1)}%` : "N/D",
        revenueGrowth: m?.revenueGrowthTTMYoy != null ? `${Number(m.revenueGrowthTTMYoy).toFixed(1)}%` : "N/D",
        weekReturn52: m?.["52WeekPriceReturnDaily"] != null ? `${Number(m["52WeekPriceReturnDaily"]).toFixed(1)}%` : "N/D",
        beta: m?.beta != null ? Number(m.beta).toFixed(2) : "N/D",
      };
    })
  );
  return results;
}

// =====================================================
// TICKER: QUARTERLY FINANCIALS (Finnhub + FMP)
// =====================================================

async function fetchQuarterlyFinancials(ticker: string, key: string) {
  const t = encodeURIComponent(ticker);
  const [icRaw, cfRaw, bsRaw] = await Promise.all([
    finnhubGet(`/stock/financials?symbol=${t}&statement=ic&freq=quarterly`, key),
    finnhubGet(`/stock/financials?symbol=${t}&statement=cf&freq=quarterly`, key),
    finnhubGet(`/stock/financials?symbol=${t}&statement=bs&freq=quarterly`, key),
  ]);

  const icList: any[] = icRaw?.data?.financials ?? icRaw?.financials ?? [];
  const cfList: any[] = cfRaw?.data?.financials ?? cfRaw?.financials ?? [];
  const bsList: any[] = bsRaw?.data?.financials ?? bsRaw?.financials ?? [];

  if (!icList.length) return [];

  const cfByPeriod = new Map<string, any>(cfList.map((q: any) => [q.period, q]));
  const bsByPeriod = new Map<string, any>(bsList.map((q: any) => [q.period, q]));

  return icList.slice(0, 16).map((q: any) => {
    const cf = cfByPeriod.get(q.period) ?? {};
    const bs = bsByPeriod.get(q.period) ?? {};

    const rev      = q.revenue ?? null;
    const revGrowth = q.revenueGrowth ?? null;
    const grossProfit = q.grossProfit ?? null;
    const ebitda   = q.ebitda ?? null;
    const netIncome = q.netIncome ?? null;
    const eps      = q.eps ?? null;
    const opCF     = cf.operatingCashFlow ?? null;
    const fcf      = cf.freeCashFlow ?? null;
    const capex    = cf.capitalExpenditures ?? cf.capex ?? null;
    const investingCF = cf.netInvestingCashFlow ?? cf.investingCashFlow ?? null;
    const financingCF = cf.netFinancingCashFlow ?? cf.financingCashFlow ?? null;

    const cash     = bs.cashAndEquivalents ?? bs.cash ?? bs.cashEquivalents ?? null;
    const totalDebt = bs.totalDebt ?? bs.longTermDebt ?? null;
    const netDebt  = (totalDebt != null && cash != null) ? totalDebt - cash : null;
    const equity   = bs.totalEquity ?? bs.stockholdersEquity ?? bs.totalStockholdersEquity ?? null;
    const totalAssets = bs.totalAssets ?? null;

    return {
      period: q.period ?? "",
      revenue: fmt(rev, "B"),
      revenueGrowth: revGrowth != null ? `${revGrowth >= 0 ? "+" : ""}${(revGrowth * 100).toFixed(1)}%` : "N/D",
      grossMargin: (rev != null && rev !== 0 && grossProfit != null) ? `${((grossProfit / rev) * 100).toFixed(1)}%` : "N/D",
      ebitda: fmt(ebitda, "B"),
      netIncome: fmt(netIncome, "B"),
      netMargin: (rev != null && rev !== 0 && netIncome != null) ? `${((netIncome / rev) * 100).toFixed(1)}%` : "N/D",
      eps: eps != null ? `$${Number(eps).toFixed(2)}` : "N/D",
      operatingCF: fmt(opCF, "B"),
      freeCashFlow: fmt(fcf, "B"),
      capex: capex != null ? fmt(capex, "B") : "N/D",
      investingCF: fmt(investingCF, "B"),
      financingCF: fmt(financingCF, "B"),
      cash: fmt(cash, "B"),
      totalDebt: fmt(totalDebt, "B"),
      netDebt: fmt(netDebt, "B"),
      equity: fmt(equity, "B"),
      totalAssets: fmt(totalAssets, "B"),
    };
  });
}

async function fetchFmpQuarterlyFinancials(ticker: string, key: string): Promise<any[]> {
  if (!key) return [];
  const t = encodeURIComponent(ticker);
  const base = "https://financialmodelingprep.com/api/v3";
  const normDate = (d: any): string => {
    if (typeof d !== "string") return "";
    const m = d.match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : "";
  };
  // Fuzzy date lookup: exact match first, then ±7 days closest match.
  // Needed because FMP sometimes returns slightly different dates across statement types.
  const fuzzyGet = (byDate: Map<string, any>, targetDate: string): any => {
    const exact = byDate.get(targetDate);
    if (exact) return exact;
    const target = new Date(targetDate + "T00:00:00Z").getTime();
    if (isNaN(target)) return {};
    let best: any = null;
    let bestDiff = Infinity;
    for (const [d, obj] of byDate.entries()) {
      const t2 = new Date(d + "T00:00:00Z").getTime();
      if (isNaN(t2)) continue;
      const diff = Math.abs(t2 - target);
      if (diff <= 45 * 86400_000 && diff < bestDiff) { bestDiff = diff; best = obj; }
    }
    return best ?? {};
  };

  try {
    const incomeUrl  = `${base}/income-statement/${t}?period=quarter&limit=16&apikey=${key}`;
    const cashUrl    = `${base}/cash-flow-statement/${t}?period=quarter&limit=16&apikey=${key}`;
    const balanceUrl = `${base}/balance-sheet-statement/${t}?period=quarter&limit=16&apikey=${key}`;
    const [incomeRaw, cashRaw, balanceRaw] = await Promise.all([
      fetch(incomeUrl, { signal: AbortSignal.timeout(12_000) }).then(r => r.ok ? r.json() : { __status: r.status }).catch(() => []),
      fetch(cashUrl, { signal: AbortSignal.timeout(12_000) }).then(r => r.ok ? r.json() : { __status: r.status }).catch(() => []),
      fetch(balanceUrl, { signal: AbortSignal.timeout(12_000) }).then(r => r.ok ? r.json() : { __status: r.status }).catch(() => []),
    ]);

    const incomeList: any[] = Array.isArray(incomeRaw) ? incomeRaw : [];
    let cfList: any[]       = Array.isArray(cashRaw)    ? cashRaw    : [];
    let bsList: any[]       = Array.isArray(balanceRaw) ? balanceRaw : [];
    console.log(`FMP ${ticker} quarter: income=${incomeList.length} cf=${cfList.length} bs=${bsList.length}${!Array.isArray(incomeRaw) ? " incomeErr=" + JSON.stringify(incomeRaw).slice(0, 100) : ""}${!Array.isArray(cashRaw) ? " cfErr=" + JSON.stringify(cashRaw).slice(0, 100) : ""}${!Array.isArray(balanceRaw) ? " bsErr=" + JSON.stringify(balanceRaw).slice(0, 100) : ""}`);
    if (!incomeList.length) return [];

    // If quarterly CF or BS returned empty (common for international/non-US stocks on FMP free
    // tier), fall back to annual statements. Q4 of each year will get a direct date match;
    // other quarters get matched via the ±45d fuzzyGet below, giving at least partial coverage.
    if (cfList.length === 0 || bsList.length === 0) {
      const [cfAnn, bsAnn] = await Promise.all([
        cfList.length === 0
          ? fetch(`${base}/cash-flow-statement/${t}?period=annual&limit=8&apikey=${key}`, { signal: AbortSignal.timeout(10_000) }).then(r => r.ok ? r.json() : []).catch(() => [])
          : Promise.resolve(cfList),
        bsList.length === 0
          ? fetch(`${base}/balance-sheet-statement/${t}?period=annual&limit=8&apikey=${key}`, { signal: AbortSignal.timeout(10_000) }).then(r => r.ok ? r.json() : []).catch(() => [])
          : Promise.resolve(bsList),
      ]);
      if (cfList.length === 0) cfList = Array.isArray(cfAnn) ? cfAnn : [];
      if (bsList.length === 0) bsList = Array.isArray(bsAnn) ? bsAnn : [];
      console.log(`FMP ${ticker} annual fallback: cf=${cfList.length} bs=${bsList.length}`);
    }

    const cashByDate = new Map<string, any>(cfList.map((q: any) => [normDate(q.date), q]));
    const balByDate  = new Map<string, any>(bsList.map((q: any) => [normDate(q.date), q]));
    console.log(`FMP ${ticker} CF dates: [${[...cashByDate.keys()].slice(0,4).join(",")}] BS dates: [${[...balByDate.keys()].slice(0,4).join(",")}]`);

    return incomeList.map((q: any, idx: number) => {
      const period = normDate(q.date);
      // fuzzyGet first (±45d); fall back to index-aligned statement if no match has key fields
      const cfFuzzy = fuzzyGet(cashByDate, period);
      const bsFuzzy = fuzzyGet(balByDate, period);
      const cf = (cfFuzzy.operatingCashFlow != null || cfFuzzy.netCashProvidedByOperatingActivities != null)
        ? cfFuzzy : (cfList[idx] ?? {});
      const bs = (bsFuzzy.totalAssets != null || bsFuzzy.cashAndCashEquivalents != null || bsFuzzy.totalDebt != null || bsFuzzy.totalStockholdersEquity != null)
        ? bsFuzzy : (bsList[idx] ?? {});

      const rev         = q.revenue ?? null;
      const grossProfit = q.grossProfit ?? null;
      const opIncome    = q.operatingIncome ?? null;
      // D&A: FMP sometimes leaves it null in income statement; fall back to cash flow statement
      const dna         = q.depreciationAndAmortization
                         ?? cf.depreciationAndAmortization
                         ?? null;
      const ebitdaRaw   = q.ebitda ?? null;
      const ebitda      = ebitdaRaw != null ? ebitdaRaw
                        : (opIncome != null && dna != null ? opIncome + dna : null);
      const netIncome   = q.netIncome ?? null;
      const eps         = q.epsdiluted ?? q.eps ?? null;

      const opCF      = cf.operatingCashFlow ?? cf.netCashProvidedByOperatingActivities ?? null;
      // FMP reports capitalExpenditure as a negative number (cash outflow)
      const capexRaw  = cf.capitalExpenditure ?? null;
      const capex     = capexRaw != null ? Math.abs(capexRaw) : null;
      // Use FMP's freeCashFlow if present; otherwise compute opCF + capexRaw (capex is negative)
      const fcfRaw    = cf.freeCashFlow ?? null;
      const fcf       = fcfRaw != null ? fcfRaw
                      : (opCF != null && capexRaw != null ? opCF + capexRaw : null);
      // Investing/Financing CF — needed for the CashFlowChart visual breakdown
      const investingCF = cf.netCashUsedForInvestingActivites
                        ?? cf.netCashUsedForInvestingActivities
                        ?? cf.netCashFromInvestingActivities
                        ?? null;
      const financingCF = cf.netCashUsedProvidedByFinancingActivities
                        ?? cf.netCashProvidedByFinancingActivities
                        ?? cf.netCashFromFinancingActivities
                        ?? null;

      const cash      = bs.cashAndCashEquivalents ?? bs.cashAndShortTermInvestments ?? null;
      const totalDebt = bs.totalDebt ?? null;
      const netDebt   = (totalDebt != null && cash != null) ? totalDebt - cash : null;
      const equity    = bs.totalStockholdersEquity ?? bs.totalEquity ?? bs.stockholdersEquity ?? null;
      const totalAssets = bs.totalAssets ?? null;

      const prevQ = incomeList[idx + 4] as any;
      const revGrowth = (rev && prevQ?.revenue && Math.abs(prevQ.revenue) > 0)
        ? `${((rev - prevQ.revenue) / Math.abs(prevQ.revenue) * 100) >= 0 ? "+" : ""}${((rev - prevQ.revenue) / Math.abs(prevQ.revenue) * 100).toFixed(1)}%`
        : "N/D";

      // Use strict non-zero checks for percentage computations to avoid divide-by-zero
      // and false "0%" readings when fields come back as 0 from the API.
      const grossMarginStr = (rev != null && rev !== 0 && grossProfit != null)
        ? `${((grossProfit / rev) * 100).toFixed(1)}%` : "N/D";
      const netMarginStr   = (rev != null && rev !== 0 && netIncome != null)
        ? `${((netIncome / rev) * 100).toFixed(1)}%`   : "N/D";

      return {
        period,
        revenue:      fmt(rev, "B"),
        revenueGrowth: revGrowth,
        grossMargin:  grossMarginStr,
        ebitda:       fmt(ebitda, "B"),
        netIncome:    fmt(netIncome, "B"),
        netMargin:    netMarginStr,
        eps:          eps != null ? `$${Number(eps).toFixed(2)}` : "N/D",
        operatingCF:  fmt(opCF, "B"),
        freeCashFlow: fmt(fcf, "B"),
        capex:        capex != null ? fmt(capex, "B") : "N/D",
        investingCF:  fmt(investingCF, "B"),
        financingCF:  fmt(financingCF, "B"),
        cash:         fmt(cash, "B"),
        totalDebt:    fmt(totalDebt, "B"),
        netDebt:      fmt(netDebt, "B"),
        equity:       fmt(equity, "B"),
        totalAssets:  fmt(totalAssets, "B"),
      };
    }).filter(q => /^\d{4}-\d{2}-\d{2}$/.test(q.period)).slice(0, 16);
  } catch (e) {
    console.log(`FMP ${ticker} threw:`, e);
    return [];
  }
}

async function fetchTwelveDataQuarterlyFinancials(ticker: string, key: string): Promise<any[]> {
  if (!key) return [];
  const t = encodeURIComponent(ticker);
  const base = "https://api.twelvedata.com";
  try {
    const [incomeRaw, cashRaw, balanceRaw] = await Promise.all([
      fetch(`${base}/income_statement?symbol=${t}&period=quarterly&apikey=${key}`, { signal: AbortSignal.timeout(12_000) })
        .then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${base}/cash_flow?symbol=${t}&period=quarterly&apikey=${key}`, { signal: AbortSignal.timeout(12_000) })
        .then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${base}/balance_sheet?symbol=${t}&period=quarterly&apikey=${key}`, { signal: AbortSignal.timeout(12_000) })
        .then(r => r.ok ? r.json() : null).catch(() => null),
    ]);

    const incomeList: any[] = Array.isArray(incomeRaw?.income_statement) ? incomeRaw.income_statement : [];
    console.log(`TwelveData ${ticker}: income=${incomeList.length} status=${incomeRaw?.status ?? "ok"} code=${incomeRaw?.code ?? ""}`);
    if (!incomeList.length) return [];

    const cashList:    any[] = Array.isArray(cashRaw?.cash_flow)        ? cashRaw.cash_flow        : [];
    const balanceList: any[] = Array.isArray(balanceRaw?.balance_sheet) ? balanceRaw.balance_sheet : [];
    console.log(`TwelveData ${ticker}: cf=${cashList.length} bs=${balanceList.length}`);

    const cashByDate = new Map<string, any>(cashList   .map((q: any) => [q.fiscal_date, q]));
    const balByDate  = new Map<string, any>(balanceList.map((q: any) => [q.fiscal_date, q]));

    // Fuzzy date lookup ±30d — European and non-standard fiscal years often have CF/BS dates
    // that differ from income statement dates by days or weeks.
    const tdFuzzy = (byDate: Map<string, any>, dateStr: string): any => {
      if (!dateStr) return {};
      const direct = byDate.get(dateStr);
      if (direct) return direct;
      const target = new Date(dateStr + "T00:00:00Z").getTime();
      if (isNaN(target)) return {};
      let best: any = null;
      let bestDiff = Infinity;
      for (const [d, obj] of byDate.entries()) {
        const t2 = new Date(d + "T00:00:00Z").getTime();
        if (isNaN(t2)) continue;
        const diff = Math.abs(t2 - target);
        if (diff <= 30 * 86_400_000 && diff < bestDiff) { bestDiff = diff; best = obj; }
      }
      return best ?? {};
    };

    const num = (v: any): number | null => {
      if (v == null || v === "") return null;
      const n = typeof v === "string" ? parseFloat(v) : Number(v);
      return isNaN(n) ? null : n;
    };

    const sorted = [...incomeList].sort((a, b) => (b.fiscal_date ?? "").localeCompare(a.fiscal_date ?? ""));

    return sorted.map((q: any, idx: number) => {
      const date = q.fiscal_date ?? "";
      // Use fuzzyGet first; fall back to array-index alignment if no match found
      const cfFuzzy = tdFuzzy(cashByDate, date);
      const bsFuzzy = tdFuzzy(balByDate,  date);
      const cf = (cfFuzzy.operating_activities != null || cfFuzzy.operating_cash_flow != null || cfFuzzy.net_cash_from_operating_activities != null)
        ? cfFuzzy : (cashList[idx] ?? {});
      const bs = (bsFuzzy.assets != null || bsFuzzy.total_assets != null || bsFuzzy.cash_and_cash_equivalents != null)
        ? bsFuzzy : (balanceList[idx] ?? {});

      const rev         = num(q.sales);
      const grossProfit = num(q.gross_profit);
      const ebitdaRaw   = num(q.ebitda);
      const opIncomeTD  = num(q.operating_income);
      const dnaTD       = num(q.depreciation_amortization) ?? num(q.depreciation_and_amortization);
      const ebitda      = ebitdaRaw != null ? ebitdaRaw
                        : (opIncomeTD != null && dnaTD != null ? opIncomeTD + dnaTD : null);
      const netIncome   = num(q.net_income);
      const eps         = num(q.eps_diluted) ?? num(q.eps_basic);

      // Handle both nested and flat Twelve Data response structures
      const opCF  = num(cf?.operating_activities?.operating_cash_flow)
                 ?? num(cf?.operating_activities?.net_cash_from_operating_activities)
                 ?? num(cf?.net_cash_from_operating_activities)
                 ?? num(cf?.operating_cash_flow);
      const fcf   = num(cf?.free_cash_flow)
                 ?? num(cf?.freeCashFlow);
      const capex = num(cf?.investing_activities?.capital_expenditures)
                 ?? num(cf?.capital_expenditures)
                 ?? num(cf?.capex);
      const investingCF = num(cf?.investing_activities?.net_cash_from_investing_activities)
                       ?? num(cf?.investing_activities?.investing_cash_flow)
                       ?? num(cf?.net_cash_from_investing_activities)
                       ?? num(cf?.investing_cash_flow);
      const financingCF = num(cf?.financing_activities?.net_cash_from_financing_activities)
                       ?? num(cf?.financing_activities?.financing_cash_flow)
                       ?? num(cf?.net_cash_from_financing_activities)
                       ?? num(cf?.financing_cash_flow);

      const cash      = num(bs?.assets?.current_assets?.cash_and_cash_equivalents)
                     ?? num(bs?.assets?.current_assets?.cash)
                     ?? num(bs?.cash_and_cash_equivalents)
                     ?? num(bs?.cash);
      const shortDebt = num(bs?.liabilities?.current_liabilities?.short_term_debt)
                     ?? num(bs?.short_term_debt);
      const longDebt  = num(bs?.liabilities?.non_current_liabilities?.long_term_debt)
                     ?? num(bs?.long_term_debt);
      const totalDebt = num(bs?.total_debt)
                     ?? ((shortDebt != null || longDebt != null) ? (shortDebt ?? 0) + (longDebt ?? 0) : null);
      const netDebt   = (totalDebt != null && cash != null) ? totalDebt - cash : null;
      const equity      = num(bs?.shareholders_equity?.total_shareholders_equity)
                       ?? num(bs?.shareholders_equity?.common_equity)
                       ?? num(bs?.total_shareholders_equity)
                       ?? num(bs?.total_equity);
      const totalAssets = num(bs?.assets?.total_assets)
                       ?? num(bs?.total_assets);

      const prevQ = sorted[idx + 4];
      const prevRev = num(prevQ?.sales);
      const revGrowth = (rev != null && prevRev != null && Math.abs(prevRev) > 0)
        ? `${((rev - prevRev) / Math.abs(prevRev) * 100) >= 0 ? "+" : ""}${((rev - prevRev) / Math.abs(prevRev) * 100).toFixed(1)}%`
        : "N/D";

      return {
        period:        date,
        revenue:       fmt(rev, "B"),
        revenueGrowth: revGrowth,
        grossMargin:   (rev != null && rev !== 0 && grossProfit != null) ? `${((grossProfit / rev) * 100).toFixed(1)}%` : "N/D",
        ebitda:        fmt(ebitda, "B"),
        netIncome:     fmt(netIncome, "B"),
        netMargin:     (rev != null && rev !== 0 && netIncome != null) ? `${((netIncome / rev) * 100).toFixed(1)}%` : "N/D",
        eps:           eps != null ? `$${eps.toFixed(2)}` : "N/D",
        operatingCF:   fmt(opCF, "B"),
        freeCashFlow:  fmt(fcf, "B"),
        capex:         capex != null ? fmt(capex, "B") : "N/D",
        investingCF:   fmt(investingCF, "B"),
        financingCF:   fmt(financingCF, "B"),
        cash:          fmt(cash, "B"),
        totalDebt:     fmt(totalDebt, "B"),
        netDebt:       fmt(netDebt, "B"),
        equity:        fmt(equity, "B"),
        totalAssets:   fmt(totalAssets, "B"),
      };
    }).slice(0, 16);
  } catch (_) { return []; }
}

async function fetchAiQuarterlyFallback(
  ticker: string,
  companyName: string,
  tavilyKey: string,
  geminiKey: string,
): Promise<any[]> {
  if (!tavilyKey || !geminiKey) return [];
  try {
    // Two parallel Tavily searches: one on financial data sites, one for earnings news
    const [finDataSearch, earningsSearch] = await Promise.all([
      fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: tavilyKey,
          query: `${ticker} ${companyName} quarterly revenue net income cash flow 2022 2023 2024 2025 financial statements`,
          search_depth: "advanced",
          max_results: 5,
          include_answer: false,
          include_domains: ["macrotrends.net", "stockanalysis.com", "wisesheets.io", "simplywall.st"],
        }),
      }).then(r => r.ok ? r.json() : { results: [] }).catch(() => ({ results: [] })),

      fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: tavilyKey,
          query: `"${companyName}" ${ticker} quarterly earnings revenue EPS results Q1 Q2 Q3 Q4 2023 2024 2025`,
          search_depth: "advanced",
          max_results: 6,
          include_answer: true,
        }),
      }).then(r => r.ok ? r.json() : { answer: "", results: [] }).catch(() => ({ answer: "", results: [] })),
    ]);

    const pieces: string[] = [];
    if (earningsSearch?.answer) pieces.push(`Resumen financiero: ${earningsSearch.answer}`);
    for (const r of [...(finDataSearch?.results ?? []), ...(earningsSearch?.results ?? [])]) {
      const content = (r.raw_content || r.content || "").slice(0, 3500);
      if (content) pieces.push(`## ${r.title}\n${content}`);
    }
    const context = pieces.join("\n\n").slice(0, 22000);
    if (!context) return [];

    const extractionPrompt = `Eres un analista financiero experto. Extrae los datos financieros trimestrales de ${companyName} (${ticker}) de los textos siguientes.

Devuelve SOLO un array JSON válido (sin texto adicional, sin bloques de código, sin markdown) con hasta 12 trimestres ordenados del más reciente al más antiguo. Cada objeto DEBE tener exactamente estos campos:
{
  "period": "YYYY-MM-DD",
  "revenue": número_o_null,
  "netIncome": número_o_null,
  "ebitda": número_o_null,
  "grossProfit": número_o_null,
  "eps": número_o_null,
  "operatingCF": número_o_null,
  "freeCashFlow": número_o_null,
  "capex": número_o_null,
  "cash": número_o_null,
  "totalDebt": número_o_null,
  "equity": número_o_null,
  "totalAssets": número_o_null
}

REGLAS:
- "period" = fecha del último día del trimestre fiscal, formato YYYY-MM-DD exacto (ej: "2024-09-30", "2024-12-31")
- Valores AGREGADOS (revenue, netIncome, ebitda, grossProfit, operatingCF, freeCashFlow, capex, cash, totalDebt, equity, totalAssets): expresar en USD absolutos. Si el texto dice "B/bn/billion(s)" multiplica por 1000000000; si dice "M/mm/million(s)" multiplica por 1000000.
- Valor POR ACCIÓN (eps): NO multiplicar. EPS es valor por acción en dólares normales (ej: 2.43, no 2430000000).
- Si no encuentras un valor concreto, pon null. NUNCA inventes cifras.
- Devuelve solo el array, empieza con [ y termina con ]

TEXTOS FUENTE:
${context}`;

    // Start with reliable models, then try newer ones
    const EXTRACTION_MODELS = [
      "gemini-2.5-pro",
      "gemini-2.5-flash",
      "gemini-2.5-pro-latest",
      "gemini-3-pro-preview",
      "gemini-3.1-pro-preview",
    ];

    let raw = "";
    for (const model of EXTRACTION_MODELS) {
      try {
        const geminiResp = await fetch(
          "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${geminiKey}`,
            },
            body: JSON.stringify({
              model,
              messages: [{ role: "user", content: extractionPrompt }],
              temperature: 0.1,
              stream: false,
            }),
          }
        );
        if (!geminiResp.ok) {
          console.log(`AI fallback model ${model} returned ${geminiResp.status}, trying next`);
          continue;
        }
        const geminiData = await geminiResp.json();
        raw = geminiData?.choices?.[0]?.message?.content ?? "";
        if (raw) {
          console.log(`AI fallback succeeded with model ${model}`);
          break;
        }
      } catch (modelErr) {
        console.log(`AI fallback model ${model} threw: ${modelErr}`);
      }
    }
    if (!raw) return [];
    raw = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
    const firstBracket = raw.indexOf("[");
    const lastBracket  = raw.lastIndexOf("]");
    if (firstBracket < 0 || lastBracket <= firstBracket) return [];
    let parsed: any[];
    try {
      parsed = JSON.parse(raw.slice(firstBracket, lastBracket + 1));
    } catch (_) { return []; }
    if (!Array.isArray(parsed)) return [];

    const result = parsed.map((q: any, idx: number) => {
      const rev = typeof q.revenue === "number" ? q.revenue : null;
      const grossProfit = typeof q.grossProfit === "number" ? q.grossProfit : null;
      const netIncome   = typeof q.netIncome === "number" ? q.netIncome : null;
      const ebitda      = typeof q.ebitda === "number" ? q.ebitda : null;
      const eps         = typeof q.eps === "number" ? q.eps : null;
      const opCF        = typeof q.operatingCF === "number" ? q.operatingCF : null;
      const fcf         = typeof q.freeCashFlow === "number" ? q.freeCashFlow : null;
      const capex       = typeof q.capex === "number" ? q.capex : null;
      const cash        = typeof q.cash === "number" ? q.cash : null;
      const totalDebt   = typeof q.totalDebt === "number" ? q.totalDebt : null;
      const netDebt     = (totalDebt != null && cash != null) ? totalDebt - cash : null;
      const equity      = typeof q.equity === "number" ? q.equity : null;
      const totalAssets = typeof q.totalAssets === "number" ? q.totalAssets : null;

      const prevQ = parsed[idx + 4];
      const prevRev = typeof prevQ?.revenue === "number" ? prevQ.revenue : null;
      const revGrowth = (rev != null && prevRev != null && Math.abs(prevRev) > 0)
        ? `${((rev - prevRev) / Math.abs(prevRev) * 100) >= 0 ? "+" : ""}${((rev - prevRev) / Math.abs(prevRev) * 100).toFixed(1)}%`
        : "N/D";

      return {
        period:        q.period ?? "",
        revenue:       fmt(rev, "B"),
        revenueGrowth: revGrowth,
        grossMargin:   (rev != null && rev !== 0 && grossProfit != null) ? `${((grossProfit / rev) * 100).toFixed(1)}%` : "N/D",
        ebitda:        fmt(ebitda, "B"),
        netIncome:     fmt(netIncome, "B"),
        netMargin:     (rev != null && rev !== 0 && netIncome != null) ? `${((netIncome / rev) * 100).toFixed(1)}%` : "N/D",
        eps:           eps != null ? `$${eps.toFixed(2)}` : "N/D",
        operatingCF:   fmt(opCF, "B"),
        freeCashFlow:  fmt(fcf, "B"),
        capex:         capex != null ? fmt(capex, "B") : "N/D",
        // AI fallback typically can't reliably extract CFI/CFF — leave N/D
        investingCF:   "N/D",
        financingCF:   "N/D",
        cash:          fmt(cash, "B"),
        totalDebt:     fmt(totalDebt, "B"),
        netDebt:       fmt(netDebt, "B"),
        equity:        fmt(equity, "B"),
        totalAssets:   fmt(totalAssets, "B"),
      };
    }).filter(q => q.period && /^\d{4}-\d{2}-\d{2}$/.test(q.period));
    console.log(`AI fallback extracted ${result.length} valid quarters from sources`);
    return result;
  } catch (e) {
    console.log("AI fallback error:", e);
    return [];
  }
}

function mergeQuarterlyData(yahoo: any[], finnhub: any[], fmp: any[], twelveData: any[], aiFallback: any[] = []): any[] {
  const merged = new Map<string, any>();
  const fields = ["revenueGrowth","grossMargin","ebitda","netIncome","netMargin","eps",
                  "operatingCF","freeCashFlow","capex","investingCF","financingCF",
                  "cash","totalDebt","netDebt","equity","totalAssets","revenue"];

  // Map a date (YYYY-MM-DD) to a calendar-quarter key (YYYYQn). Different data providers
  // sometimes report the same fiscal quarter ±1 day across quarter boundaries (e.g. one
  // source reports "2024-06-30" and another "2024-07-01" for the same Q2 results).
  // Slicing YYYY-MM put them in different buckets and the merge couldn't fill gaps
  // across sources. Treating "first ≤7 days of a new quarter" as the previous quarter
  // makes the join robust to this drift.
  const quarterKey = (period: string): string => {
    if (typeof period !== "string" || period.length < 10) return period.slice(0, 7);
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(period);
    if (!m) return period.slice(0, 7);
    let year = parseInt(m[1], 10);
    let month = parseInt(m[2], 10);
    const day = parseInt(m[3], 10);
    // If the date falls in the first week of a new quarter, treat as previous quarter
    if ((month === 1 || month === 4 || month === 7 || month === 10) && day <= 7) {
      month -= 1;
      if (month < 1) { month = 12; year -= 1; }
    }
    const q = Math.min(4, Math.max(1, Math.floor((month - 1) / 3) + 1));
    return `${year}Q${q}`;
  };

  const fillFrom = (source: any[]) => {
    for (const q of source) {
      if (!q.period) continue;
      const key = quarterKey(q.period);
      if (!merged.has(key)) {
        merged.set(key, { ...q });
      } else {
        const existing = merged.get(key)!;
        for (const f of fields) {
          if ((existing[f] === "N/D" || existing[f] == null) && q[f] !== "N/D" && q[f] != null) {
            existing[f] = q[f];
          }
        }
        // Prefer the later period date when sources disagree, so the displayed Q1'24
        // label aligns with how the company itself reports the quarter.
        if (q.period && existing.period && q.period > existing.period) {
          existing.period = q.period;
        }
      }
    }
  };

  // Priority order: Yahoo > FMP > Twelve Data > Finnhub > AI fallback (last resort).
  // The first source to set a field wins; later sources only fill remaining gaps.
  fillFrom(yahoo);
  fillFrom(fmp);
  fillFrom(twelveData);
  fillFrom(finnhub);
  fillFrom(aiFallback);

  // Require at least 1 of 7 key fields to be populated — avoids filtering out real
  // FMP/TwelveData quarters that may only have partial data (root cause of 0Q issue).
  const KEY_FIELDS = ["revenue", "ebitda", "netIncome", "operatingCF", "freeCashFlow", "cash", "equity"];
  return Array.from(merged.values())
    .filter((q: any) => {
      const keyCount = KEY_FIELDS.filter(f => q[f] !== "N/D" && q[f] != null && q[f] !== "").length;
      return keyCount >= 1;
    })
    .sort((a: any, b: any) => b.period.localeCompare(a.period))
    .slice(0, 16);
}

// =====================================================
// TICKER: FMP / TWELVE DATA
// =====================================================

async function fetchFmpData(ticker: string, key: string): Promise<string> {
  if (!key) return "";
  try {
    const t = encodeURIComponent(ticker);
    const base = "https://financialmodelingprep.com/api/v3";

    const [targetRaw, institutionalRaw, insiderRaw, analystRaw] = await Promise.all([
      fetch(`${base}/price-target-consensus/${t}?apikey=${key}`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${base}/institutional-holder/${t}?apikey=${key}`).then(r => r.ok ? r.json() : []).catch(() => []),
      fetch(`${base}/insider-trading?symbol=${t}&limit=5&apikey=${key}`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${base}/analyst-stock-recommendations/${t}?limit=1&apikey=${key}`).then(r => r.ok ? r.json() : []).catch(() => []),
    ]);

    const lines: string[] = [];

    const tgt = Array.isArray(targetRaw) ? targetRaw[0] : targetRaw;
    if (tgt?.targetConsensus) {
      lines.push("--- PRECIO OBJETIVO ANALISTAS (FMP) ---");
      lines.push(`Consenso: $${Number(tgt.targetConsensus).toFixed(2)} | Alto: $${Number(tgt.targetHigh ?? 0).toFixed(2)} | Bajo: $${Number(tgt.targetLow ?? 0).toFixed(2)} | Mediana: $${Number(tgt.targetMedian ?? 0).toFixed(2)}`);
    }

    const rec = Array.isArray(analystRaw) ? analystRaw[0] : null;
    if (rec) {
      lines.push(`Recomendaciones FMP (${rec.date ?? ""}): SB=${rec.analystRatingsStrongBuy ?? 0} | B=${rec.analystRatingsbuy ?? 0} | H=${rec.analystRatingsHold ?? 0} | S=${rec.analystRatingsSell ?? 0} | SS=${rec.analystRatingsStrongSell ?? 0}`);
    }

    if (Array.isArray(institutionalRaw) && institutionalRaw.length > 0) {
      lines.push("", "--- TENENCIAS INSTITUCIONALES (FMP) ---");
      institutionalRaw.slice(0, 6).forEach((h: any) => {
        const val = h.value ? `$${(h.value / 1e9).toFixed(2)}B` : "";
        const chg = h.change != null ? (h.change > 0 ? `+${h.change.toLocaleString()}` : h.change.toLocaleString()) : "N/A";
        lines.push(`${h.holder}: ${(h.shares ?? 0).toLocaleString()} acciones ${val} (cambio: ${chg})`);
      });
    }

    const insiderList: any[] = insiderRaw?.data ?? (Array.isArray(insiderRaw) ? insiderRaw : []);
    if (insiderList.length > 0) {
      lines.push("", "--- ACTIVIDAD INSIDER (FMP) ---");
      insiderList.slice(0, 4).forEach((tx: any) => {
        const shares = tx.securitiesTransacted ? tx.securitiesTransacted.toLocaleString() : "?";
        const price = tx.price ? `@$${Number(tx.price).toFixed(2)}` : "";
        lines.push(`${tx.transactionDate ?? ""} | ${tx.reportingName ?? "?"} (${tx.typeOfOwner ?? ""}) | ${tx.transactionType ?? "?"} ${shares} ${price}`);
      });
    }

    return lines.join("\n");
  } catch (_) { return ""; }
}

async function fetchTwelveData(ticker: string, key: string): Promise<string> {
  if (!key) return "";
  try {
    const res = await fetch(
      `https://api.twelvedata.com/statistics?symbol=${encodeURIComponent(ticker)}&apikey=${key}`
    ).catch(() => null);
    if (!res?.ok) return "";
    const d = await res.json().catch(() => null);
    if (!d?.statistics) return "";

    const v = d.statistics.valuations_metrics ?? {};
    const f = d.statistics.financials ?? {};
    const s = d.statistics.stock_statistics ?? {};
    const div = d.statistics.dividends_and_splits ?? {};

    const pairs: [string, unknown][] = [
      ["P/E TTM",       v.trailing_pe],
      ["P/E Forward",   v.forward_pe],
      ["P/B",           v.price_to_book_mrq],
      ["P/S TTM",       v.price_to_sales_ttm],
      ["EV/EBITDA",     v.enterprise_to_ebitda],
      ["EV/Revenue",    v.enterprise_to_revenue],
      ["Beta",          s.beta],
      ["52W High",      s["52_week_high"]],
      ["52W Low",       s["52_week_low"]],
      ["52W Change",    s["52_week_change"]],
      ["ROE TTM",       f.return_on_equity_ttm],
      ["ROA TTM",       f.return_on_assets_ttm],
      ["Net Margin",    f.profit_margin],
      ["Op Margin",     f.operating_margin_ttm],
      ["Gross Profit",  f.gross_profit_ttm],
      ["Revenue TTM",   f.revenue_ttm],
      ["EPS TTM",       f.diluted_eps_ttm],
      ["FCF TTM",       f.levered_free_cash_flow_ttm],
      ["Total Cash",    f.total_cash_mrq],
      ["Total Debt",    f.total_debt_mrq],
      ["D/E",           f.total_debt_to_equity_mrq],
      ["Div Yield",     div.forward_annual_dividend_yield],
      ["Inst. Owned",   s.percent_held_by_institutions],
    ];

    const line = pairs
      .filter(([, val]) => val != null && !isNaN(Number(val)))
      .map(([label, val]) => `${label}=${Number(val).toFixed(2)}`)
      .join(" | ");

    return line ? `--- DATOS TWELVE DATA (COMPLEMENTO N/D) ---\n${line}` : "";
  } catch (_) { return ""; }
}

async function fetchTechnicalIndicators(ticker: string, key: string): Promise<string> {
  if (!key) return "";
  const t = encodeURIComponent(ticker);
  try {
    const base = "https://api.twelvedata.com";
    const [rsiData, macdData, sma50Data, sma200Data] = await Promise.all([
      fetch(`${base}/rsi?symbol=${t}&interval=1day&time_period=14&outputsize=1&apikey=${key}`)
        .then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${base}/macd?symbol=${t}&interval=1day&outputsize=1&apikey=${key}`)
        .then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${base}/sma?symbol=${t}&interval=1day&time_period=50&outputsize=1&apikey=${key}`)
        .then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${base}/sma?symbol=${t}&interval=1day&time_period=200&outputsize=1&apikey=${key}`)
        .then(r => r.ok ? r.json() : null).catch(() => null),
    ]);

    const rsi    = rsiData?.values?.[0]?.rsi         ? Number(rsiData.values[0].rsi).toFixed(2)            : null;
    const macd   = macdData?.values?.[0]?.macd        ? Number(macdData.values[0].macd).toFixed(3)          : null;
    const signal = macdData?.values?.[0]?.macd_signal ? Number(macdData.values[0].macd_signal).toFixed(3)   : null;
    const hist   = macdData?.values?.[0]?.macd_hist   ? Number(macdData.values[0].macd_hist).toFixed(3)     : null;
    const sma50  = sma50Data?.values?.[0]?.sma        ? Number(sma50Data.values[0].sma).toFixed(2)          : null;
    const sma200 = sma200Data?.values?.[0]?.sma       ? Number(sma200Data.values[0].sma).toFixed(2)         : null;

    const parts: string[] = ["--- INDICADORES TÉCNICOS (TWELVE DATA) ---"];
    if (rsi)   parts.push(`RSI(14): ${rsi}`);
    if (macd)  parts.push(`MACD: ${macd}${signal ? ` | Signal: ${signal}` : ""}${hist ? ` | Histograma: ${hist}` : ""}`);
    if (sma50)  parts.push(`SMA 50: $${sma50}`);
    if (sma200) parts.push(`SMA 200: $${sma200}`);
    return parts.length > 1 ? parts.join("\n") : "";
  } catch (_) { return ""; }
}

// =====================================================
// TICKER: CATALYST CALENDAR
// =====================================================

interface CatalystCalendar {
  earnings: { date: string; epsEstimate: string | null; revenueEstimate: string | null }[];
  dividends: { exDate: string; amount: string; frequency: string }[];
}

async function fetchCatalystCalendar(ticker: string, fmpKey: string): Promise<CatalystCalendar> {
  const empty: CatalystCalendar = { earnings: [], dividends: [] };
  if (!fmpKey) return empty;
  const t = encodeURIComponent(ticker);
  const base = "https://financialmodelingprep.com/api/v3";
  const today = new Date().toISOString().slice(0, 10);
  const future = new Date(Date.now() + 120 * 86400_000).toISOString().slice(0, 10);
  try {
    const [earningsRaw, dividendRaw] = await Promise.all([
      fetch(`${base}/earning_calendar?symbol=${t}&from=${today}&to=${future}&apikey=${fmpKey}`)
        .then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${base}/stock_dividend/${t}?apikey=${fmpKey}`)
        .then(r => r.ok ? r.json() : null).catch(() => null),
    ]);
    const earningsList: any[] = Array.isArray(earningsRaw) ? earningsRaw : [];
    const dividendList: any[] = dividendRaw?.historical ?? (Array.isArray(dividendRaw) ? dividendRaw : []);
    const earnings = earningsList.slice(0, 3).map((e: any) => ({
      date: e.date ?? "",
      epsEstimate: e.epsEstimated != null ? `$${Number(e.epsEstimated).toFixed(2)}` : null,
      revenueEstimate: e.revenueEstimated != null ? fmt(Number(e.revenueEstimated), "B") : null,
    }));
    const dividends = dividendList.slice(0, 5).map((d: any) => ({
      exDate: d.date ?? d.exDividendDate ?? "",
      amount: d.dividend != null ? `$${Number(d.dividend).toFixed(4)}` : "",
      frequency: d.frequency ?? "",
    }));
    console.log(`CatalystCalendar ${ticker}: earnings=${earnings.length} dividends=${dividends.length}`);
    return { earnings, dividends };
  } catch (e) {
    console.log(`CatalystCalendar ${ticker} error:`, e);
    return empty;
  }
}

// =====================================================
// TICKER: CONTEXT BUILDER + PROMPT
// =====================================================

function buildTickerDataContext(
  data: any,
  peerData: any[],
  quarterlyHistory: any[],
  geo: any,
  sectorNews: any,
  tickerNews: any,
  earningsSearch: any,
  competitiveSearch: any,
  risksCatalystsSearch: any,
  fredContext: string,
  fmpContext: string,
  twelveDataContext: string,
  technicalContext: string,
): string {
  if (!data || (!data.quote && !data.profile)) {
    return "[Nota: datos en tiempo real no disponibles para este ticker]";
  }

  const q = data.quote;
  const p = data.profile;
  const m = data.metrics;
  const r = data.recommendations;
  const news = data.news ?? [];
  const peers = data.peers ?? [];
  const totalAnalysts = r
    ? (r.strongBuy ?? 0) + (r.buy ?? 0) + (r.hold ?? 0) + (r.sell ?? 0) + (r.strongSell ?? 0)
    : 0;

  const currentEv = m?.currentEv ?? m?.enterpriseValue ?? null;
  const ebitdPerShare = m?.ebitdPerShareTTM ?? m?.ebitdaPerShareTTM ?? null;
  const sharesOut = p?.shareOutstanding ?? null;
  let evEbitda: string | number = "N/D";
  if (currentEv && ebitdPerShare && sharesOut && ebitdPerShare > 0) {
    const ebitda = ebitdPerShare * sharesOut;
    if (ebitda > 0) evEbitda = (currentEv / ebitda).toFixed(1);
  }
  if (evEbitda === "N/D" && m?.evToEbitda != null) evEbitda = Number(m.evToEbitda).toFixed(1);

  const fcfPerShare =
    m?.fcfPerShareTTM ??
    m?.freeCashFlowPerShareTTM ??
    m?.cashFlowPerShareTTM ??
    null;
  let fcfPerShareStr = fcfPerShare != null ? String(Number(fcfPerShare).toFixed(2)) : "N/D";
  if (fcfPerShareStr === "N/D" && quarterlyHistory.length > 0) {
    const latestQ = quarterlyHistory[0];
    if (latestQ.freeCashFlow !== "N/D") {
      fcfPerShareStr = `~${latestQ.freeCashFlow} (trimestral, ver historial)`;
    }
  }

  const debtEquity =
    m?.totalDebtToEquityAnnual ??
    m?.totalDebtToEquityQuarterly ??
    m?.longTermDebtToEquityAnnual ??
    m?.longTermDebtToEquityQuarterly ??
    null;

  const lines = [
    "=== DATOS EN TIEMPO REAL (FINNHUB) ===",
    "",
    `Empresa: ${p?.name ?? "N/D"} | Ticker: ${p?.ticker ?? "N/D"}`,
    `Sector: ${p?.finnhubIndustry ?? "N/D"} | País: ${p?.country ?? "N/D"}`,
    `Exchange: ${p?.exchange ?? "N/D"} | IPO: ${p?.ipo ?? "N/D"}`,
    `Web: ${p?.weburl ?? "N/D"}`,
    "",
    "--- COTIZACIÓN ---",
    `Precio actual: $${q?.c ?? "N/D"}`,
    `Cambio hoy: ${q?.dp != null ? Number(q.dp).toFixed(2) + "%" : "N/D"} ($${q?.d != null ? Number(q.d).toFixed(2) : "N/D"})`,
    `Cierre anterior: $${q?.pc ?? "N/D"}`,
    `Máximo del día: $${q?.h ?? "N/D"} | Mínimo del día: $${q?.l ?? "N/D"}`,
    `Apertura: $${q?.o ?? "N/D"}`,
    "",
    "--- FUNDAMENTALES ---",
    `Market Cap: $${p?.marketCapitalization ? Number(p.marketCapitalization).toFixed(0) + "M" : "N/D"}`,
    `Shares Outstanding: ${p?.shareOutstanding ? Number(p.shareOutstanding).toFixed(2) + "M" : "N/D"}`,
    `P/E (TTM): ${n2(m?.peBasicExclExtraTTM ?? m?.peTTM)}`,
    `P/E NTM (Forward): ${n2(m?.peNTM ?? m?.forwardPE)}`,
    `P/B: ${n2(m?.pbAnnual ?? m?.pbQuarterly)}`,
    `P/S (TTM): ${n2(m?.psTTM ?? m?.priceToSalesTTM)}`,
    `EV/EBITDA: ${evEbitda}`,
    `Deuda/Equity: ${n2(debtEquity)}`,
    `ROE (TTM): ${n2(m?.roeTTM)}%`,
    `ROA (TTM): ${n2(m?.roaTTM)}%`,
    `ROI (TTM): ${n2(m?.roiTTM)}%`,
    `Revenue Growth YoY: ${n2(m?.revenueGrowthTTMYoy)}%`,
    `EPS Growth YoY: ${n2(m?.epsGrowthTTMYoy)}%`,
    `EPS (TTM): ${n2(m?.epsTTM)}`,
    `Dividend Yield: ${n2(m?.dividendYieldIndicatedAnnual)}%`,
    `Current Ratio: ${n2(m?.currentRatioAnnual ?? m?.currentRatioQuarterly)}`,
    `Quick Ratio: ${n2(m?.quickRatioAnnual ?? m?.quickRatioQuarterly)}`,
    `Gross Margin (TTM): ${n2(m?.grossMarginTTM)}%`,
    `Operating Margin (TTM): ${n2(m?.operatingMarginTTM)}%`,
    `Net Margin (TTM): ${n2(m?.netProfitMarginTTM)}%`,
    `Free Cash Flow/Share (TTM): ${fcfPerShareStr}`,
    `Beta: ${m?.beta ?? "N/D"}`,
    `52W High: $${m?.["52WeekHigh"] ?? "N/D"} | 52W Low: $${m?.["52WeekLow"] ?? "N/D"}`,
    `52W Price Return: ${m?.["52WeekPriceReturnDaily"] ?? "N/D"}%`,
    `10D Avg Volume: ${m?.["10DayAverageTradingVolume"] ?? "N/D"}M`,
    "",
    `--- RECOMENDACIONES DE ANALISTAS (${totalAnalysts} analistas) ---`,
    `Strong Buy: ${r?.strongBuy ?? 0} | Buy: ${r?.buy ?? 0} | Hold: ${r?.hold ?? 0} | Sell: ${r?.sell ?? 0} | Strong Sell: ${r?.strongSell ?? 0}`,
    `Periodo: ${r?.period ?? "N/D"}`,
  ];

  if (data.allRecommendations?.length > 1) {
    lines.push("", "Tendencia histórica de recomendaciones:");
    for (const rec of data.allRecommendations) {
      lines.push(`  ${rec.period}: SB=${rec.strongBuy} B=${rec.buy} H=${rec.hold} S=${rec.sell} SS=${rec.strongSell}`);
    }
  }

  if (peers.length > 0) {
    lines.push("", `Peers/Competidores identificados: ${peers.join(", ")}`);
  }

  if (peerData.length > 0) {
    lines.push("", "--- DATOS FINANCIEROS DE COMPETIDORES (FINNHUB) ---");
    lines.push("Ticker | Empresa | Precio | Market Cap | P/E | P/B | EV/EBITDA | ROE | Net Margin | Rev Growth YoY | 52W Return | Beta");
    for (const pd of peerData) {
      lines.push(`${pd.ticker} | ${pd.name} | ${pd.price} | ${pd.marketCap} | ${pd.pe} | ${pd.pb} | ${pd.evEbitda} | ${pd.roe} | ${pd.netMargin} | ${pd.revenueGrowth} | ${pd.weekReturn52} | ${pd.beta}`);
    }
  }

  if (news.length > 0) {
    lines.push("", "--- NOTICIAS RECIENTES DEL TICKER (ÚLTIMAS 4 SEMANAS, FINNHUB) ---");
    for (const n of news) {
      const urlPart = n.url ? ` [URL: ${n.url}]` : "";
      lines.push(`- ${n.headline}${n.source ? ` [${n.source}]` : ""}${urlPart}`);
    }
  }

  if (tickerNews?.results?.length > 0) {
    lines.push("", "--- NOTICIAS ADICIONALES DEL TICKER (BÚSQUEDA WEB) ---");
    if (tickerNews.answer) lines.push(`Resumen: ${tickerNews.answer}`);
    for (const result of tickerNews.results) {
      const urlPart = result.url ? ` [URL: ${result.url}]` : "";
      lines.push(`- ${result.title}${urlPart}`);
      if (result.content) lines.push(`  ${result.content}`);
    }
  }

  if (sectorNews?.results?.length > 0) {
    lines.push("", "--- NOTICIAS DEL SECTOR (BÚSQUEDA WEB) ---");
    if (sectorNews.answer) lines.push(`Resumen del sector: ${sectorNews.answer}`);
    for (const result of sectorNews.results) {
      const urlPart = result.url ? ` [URL: ${result.url}]` : "";
      lines.push(`- ${result.title}${urlPart}`);
      if (result.content) lines.push(`  ${result.content}`);
    }
  }

  if (earningsSearch?.results?.length > 0) {
    lines.push("", "--- RESULTADOS FINANCIEROS RECIENTES (EARNINGS) ---");
    if (earningsSearch.answer) lines.push(earningsSearch.answer);
    for (const result of earningsSearch.results) {
      const urlPart = result.url ? ` [URL: ${result.url}]` : "";
      lines.push(`- ${result.title}${urlPart}`);
      if (result.content) lines.push(`  ${result.content}`);
    }
  }

  if (competitiveSearch?.results?.length > 0) {
    lines.push("", "--- POSICIÓN COMPETITIVA Y CUOTA DE MERCADO ---");
    if (competitiveSearch.answer) lines.push(competitiveSearch.answer);
    for (const result of competitiveSearch.results) {
      const urlPart = result.url ? ` [URL: ${result.url}]` : "";
      lines.push(`- ${result.title}${urlPart}`);
      if (result.content) lines.push(`  ${result.content}`);
    }
  }

  if (risksCatalystsSearch?.results?.length > 0) {
    lines.push("", "--- RIESGOS Y CATALIZADORES — NOTICIAS RECIENTES ---");
    if (risksCatalystsSearch.answer) lines.push(risksCatalystsSearch.answer);
    for (const result of risksCatalystsSearch.results) {
      const urlPart = result.url ? ` [URL: ${result.url}]` : "";
      lines.push(`- [${result.published_date ?? ""}] ${result.title}${urlPart}`);
      if (result.content) lines.push(`  ${result.content}`);
    }
  }

  if (geo?.answer) {
    lines.push("", "--- CONTEXTO GEOPOLÍTICO Y REGULATORIO ---");
    lines.push(geo.answer);
    if (geo.results?.length > 0) {
      for (const s of geo.results) lines.push(`  - ${s.title}: ${s.content?.slice(0, 250) ?? ""}`);
    }
  }

  if (quarterlyHistory.length > 0) {
    lines.push("", "--- HISTORIAL TRIMESTRAL: P&L (ÚLTIMOS TRIMESTRES) ---");
    lines.push("Periodo | Revenue | Var.%YoY | M.Bruto | EBITDA | Bfº Neto | M.Neto | EPS");
    for (const q of quarterlyHistory) {
      lines.push(`${q.period} | ${q.revenue} | ${q.revenueGrowth} | ${q.grossMargin} | ${q.ebitda} | ${q.netIncome} | ${q.netMargin} | ${q.eps}`);
    }

    lines.push("", "--- HISTORIAL TRIMESTRAL: CASH FLOW ---");
    lines.push("Periodo | Op.CF | Free Cash Flow | Capex");
    for (const q of quarterlyHistory) {
      lines.push(`${q.period} | ${q.operatingCF} | ${q.freeCashFlow} | ${q.capex}`);
    }

    lines.push("", "--- HISTORIAL TRIMESTRAL: BALANCE ---");
    lines.push("Periodo | Caja | Deuda Total | Deuda Neta | Equity | Total Activos");
    for (const q of quarterlyHistory) {
      lines.push(`${q.period} | ${q.cash} | ${q.totalDebt} | ${q.netDebt} | ${q.equity} | ${q.totalAssets}`);
    }
  }

  if (fredContext) lines.push("", fredContext);
  if (fmpContext) lines.push("", fmpContext);
  if (twelveDataContext) lines.push("", twelveDataContext);
  if (technicalContext) lines.push("", technicalContext);

  lines.push("", "=== FIN DATOS ===");
  return lines.join("\n");
}

function buildTickerSystemPrompt(): string {
  const today = new Date().toISOString().slice(0, 10);
  return `Eres un analista financiero institucional senior. Fecha: ${today}.

Genera EXACTAMENTE las 7 secciones siguientes, cada una iniciada con "## " (no las omitas ni fusiones):
## Resumen Ejecutivo
## Finanzas
## Valoración
## Sector
## Noticias
## Señales Técnicas
## Institucional

== CONTENIDO POR SECCION ==

## Resumen Ejecutivo
- Párrafo 1 (5-7 líneas): situación actual — precio, capitalización, rendimiento reciente vs sector.
- Párrafo 2 (4-5 líneas): posicionamiento competitivo y ventajas diferenciales.
- Párrafo 3 (4-5 líneas): catalizadores y riesgos macro (aranceles, tipos, geopolítica).
- ### Perfil de la Empresa: sector, país, exchange, IPO, descripción del negocio (3-4 líneas).

## Finanzas
Incluye una tabla de métricas actuales con EXACTAMENTE estas filas (Métrica | Valor):
| Métrica | Valor |
|---|---|
| Precio Actual | |
| Market Cap | |
| P/E TTM | |
| P/E Forward (NTM) | |
| P/B | |
| P/S TTM | |
| EV/EBITDA | |
| ROE TTM | |
| ROA TTM | |
| Gross Margin TTM | |
| Operating Margin TTM | |
| Net Margin TTM | |
| Deuda/Equity | |
| EPS TTM | |
| Free Cash Flow/Share | |
| Dividend Yield | |
| Beta | |
| 52W High | |
| 52W Low | |
| 52W Return | |
| Volumen Promedio 10D | |

Si un dato es N/D en Finnhub, búscalo en DATOS TWELVE DATA, FMP, o HISTORIAL TRIMESTRAL. Prioriza datos reales. Nunca inventes.

[Las tablas trimestrales históricas se renderizan automáticamente — NO las generes.]

Añade un párrafo analítico de 4-5 líneas sobre los fundamentales más relevantes.

## Valoración
- ### Análisis de Múltiplos: tabla P/E, P/B, EV/EBITDA, P/S empresa vs media sectorial. Párrafo 4-5 líneas.
- ### Análisis del Sector: 5-6 líneas sobre estado, tendencias estructurales, macro, perspectivas 12M.
- ### Red Flags Automáticos: ESCANEA los datos del HISTORIAL TRIMESTRAL (P&L, Cash Flow, Balance) y detecta señales cuantitativas de alerta comparando trimestres entre sí. Genera 3-6 viñetas SÓLO si encuentras patrones reales en los datos. Formato obligatorio:
  "- **[Categoría]:** descripción específica con cifras concretas comparando trimestres. Severidad: **ALTA** / **MEDIA** / **BAJA**"

  Categorías a evaluar (no inventes datos, sólo reporta lo que veas en el historial trimestral):
  - Apalancamiento: deuda total creciendo mientras equity/FCF cae
  - Compresión de márgenes: gross/net margin descendiendo 2+ trimestres seguidos
  - Calidad de beneficios: net income creciendo pero operating CF cayendo (warning de earnings quality)
  - Capex / FCF: capex aumentando mientras FCF se deteriora
  - Working capital: cash cayendo + deuda corto plazo subiendo
  - Crecimiento de ingresos: desaceleración secuencial significativa (>5pp drop QoQ en YoY growth)
  - Dilución / Recompras: equity decreciendo rápido (recompras agresivas) o equity diluido (emisiones)

  Si NO detectas red flags relevantes en los datos: escribe UNA sola viñeta: "- **Sin alertas:** los fundamentales trimestrales no muestran señales cuantitativas de alerta material."
- ### Factores de Riesgo (8-10 viñetas):
  Formato: "- **Tipo:** descripción con cifras/eventos. Nivel: **ALTO** / **MEDIO** / **BAJO**"
  Cubre: regulatorio, competitivo, macro (tipos/aranceles/divisa), operativo, concentración, geopolítico.
- ### Catalizadores Positivos (6-8 viñetas):
  Divide en **Corto plazo (0-3m)**, **Medio plazo (3-12m)**, **Largo plazo (+12m)**.

## Sector
- ### Tabla Comparativa del Sector: tabla Empresa | Ticker | Precio | Market Cap | P/E TTM | P/B | EV/EBITDA | ROE | Net Margin | Rev Growth YoY | 52W Return | Beta. Empresa analizada en primera fila con *.
- ### Análisis del Sector: 5-6 líneas sobre estado del sector, posición relativa, tendencias estructurales, macro, perspectivas 12M.
- ### Posicionamiento Competitivo: 3-4 líneas sobre cuota de mercado y ventajas diferenciales.

## Noticias
- ### Noticias Corporativas Recientes: 5-7 noticias. Formato: "- **Titular:** impacto 2-3 líneas. ([Fuente](URL))" — usa la URL proporcionada en los datos de contexto ([URL: ...]) para enlazar directamente la fuente en formato markdown [texto](url). Si no hay URL disponible para una noticia, usa "(Fuente)" sin enlace.
- ### Noticias del Sector: 3-4 noticias. Mismo formato con enlace si URL disponible.
- ### Contexto Macro Relevante: 4-5 líneas sobre entorno macro/geopolítico con impacto directo. Integra indicadores FRED (tipos, inflación, yield 10Y).

## Señales Técnicas
Usa los INDICADORES TÉCNICOS (TWELVE DATA) y el precio actual / rango 52W de Finnhub.

### Indicadores
| Indicador | Valor | Señal |
|---|---|---|
| Tendencia | [descripción: ej. Precio > SMA50 > SMA200] | **BULLISH** / **BEARISH** / **NEUTRO** |
| RSI (14) | [valor] | **SOBRECOMPRADO** (>70) / **SOBREVENTA** (<30) / **NEUTRO** (30-70) |
| MACD | [valor] (Signal: [señal]) | **ALCISTA** si MACD>Signal / **BAJISTA** si MACD<Signal |
| SMA 50 | $[valor] | [% precio vs SMA50] |
| SMA 200 | $[valor] | [% precio vs SMA200] |
| Soporte Clave | $[nivel] | [fuente: SMA200 / 52W Low] |
| Resistencia Clave | $[nivel] | [fuente: 52W High / nivel técnico] |

### Análisis Técnico
2-3 líneas sobre la visión técnica: tendencia dominante, confluencias de señales, niveles críticos a vigilar.

## Institucional
- ### Tenencias Institucionales: usa datos de TENENCIAS INSTITUCIONALES (FMP) para listar los principales holders con acciones y valor. Añade % institucional de Twelve Data si disponible.
- ### Precio Objetivo: usa PRECIO OBJETIVO ANALISTAS (FMP) — consenso, rango alto/bajo, mediana. Párrafo 2-3 líneas sobre implicaciones.
- ### Actividad Insider: resume los datos de ACTIVIDAD INSIDER (FMP) — compras/ventas recientes.
- ### Flujos y Sentimiento: 3-4 líneas sobre flujos institucionales y sentimiento general.

REGLAS DE FORMATO:
- Markdown estricto. Sin emojis.
- TODOS los números: exactamente 2 decimales (21.28, no 21.2848; 40.84%, no 40.839999%).
- Unidades siempre presentes: $, %, x, B, M.
- Señales técnicas en **NEGRITAS**: **BULLISH**, **BEARISH**, **NEUTRO**, **ALCISTA**, **BAJISTA**, **SOBRECOMPRADO**, **SOBREVENTA**.
- Niveles de riesgo en **NEGRITAS**: **ALTO**, **MEDIO**, **BAJO**.
- Cuando menciones trimestres específicos en el análisis narrativo, usa SIEMPRE formato Q1'24, Q2'24, Q3'24, Q4'24 (nunca "primer trimestre 2024", ni "ENE 24", ni "marzo 2024").
- Entre cada viñeta deja UNA LÍNEA EN BLANCO (doble salto de línea) para máxima legibilidad. Las viñetas pegadas son ilegibles.
- MANEJO DE DATOS FALTANTES:
  - Si un dato concreto no aparece en NINGUNA fuente (Finnhub, Twelve Data, FMP, historial trimestral): escribe simplemente "—" (em-dash) en esa celda específica.
  - NO escribas "N/D" ni "N/A" — usa "—".
  - NUNCA omitas una FILA ENTERA de la tabla "Métrica | Valor" — todas las métricas de la lista DEBEN aparecer. Si te falta el dato, pon "—" en la columna Valor.
  - Solo está permitido omitir una fila ENTERA si TODAS las celdas de esa fila serían "—".
  - Antes de poner "—", SIEMPRE busca en las 4 fuentes: Finnhub (metrics, profile), Twelve Data (statistics_metrics), FMP, y HISTORIAL TRIMESTRAL.
- TABLAS COMPLETAS: las 7 secciones son OBLIGATORIAS, no las puedes omitir aunque tengas pocos datos. Si una sección tiene poco contenido, escribe lo que sepas; nunca dejes una sección vacía.
- No cortes frases a medias.`;
}

// =====================================================
// SECTOR: CONTEXT BUILDER + PROMPT
// =====================================================

function buildSectorDataContext(
  sector: string,
  sectorNews: any,
  sectorTrends: any,
  topCompanies: any,
  sectorETFs: any,
  macroNews: any,
  regulatoryContext: any,
  fredContext: string,
): string {
  const lines = [`=== INVESTIGACIÓN SECTORIAL: ${sector.toUpperCase()} ===`, ""];

  if (sectorNews?.results?.length > 0) {
    lines.push("--- NOTICIAS RECIENTES DEL SECTOR (ÚLTIMOS 30 DÍAS) ---");
    if (sectorNews.answer) lines.push(`Resumen: ${sectorNews.answer}`);
    for (const r of sectorNews.results) {
      lines.push(`- [${r.published_date ?? ""}] ${r.title}`);
      if (r.content) lines.push(`  ${r.content}`);
    }
    lines.push("");
  }

  if (sectorTrends?.results?.length > 0) {
    lines.push("--- TENDENCIAS Y PERSPECTIVAS DEL SECTOR ---");
    if (sectorTrends.answer) lines.push(sectorTrends.answer);
    for (const r of sectorTrends.results) {
      lines.push(`- ${r.title}`);
      if (r.content) lines.push(`  ${r.content}`);
    }
    lines.push("");
  }

  if (topCompanies?.results?.length > 0) {
    lines.push("--- PRINCIPALES EMPRESAS DEL SECTOR ---");
    if (topCompanies.answer) lines.push(topCompanies.answer);
    for (const r of topCompanies.results) {
      lines.push(`- ${r.title}`);
      if (r.content) lines.push(`  ${r.content}`);
    }
    lines.push("");
  }

  if (sectorETFs?.results?.length > 0) {
    lines.push("--- ETFs DISPONIBLES PARA EL SECTOR ---");
    if (sectorETFs.answer) lines.push(sectorETFs.answer);
    for (const r of sectorETFs.results) {
      lines.push(`- ${r.title}`);
      if (r.content) lines.push(`  ${r.content}`);
    }
    lines.push("");
  }

  if (macroNews?.results?.length > 0) {
    lines.push("--- CONTEXTO MACRO QUE AFECTA AL SECTOR ---");
    if (macroNews.answer) lines.push(macroNews.answer);
    for (const r of macroNews.results) {
      lines.push(`- ${r.title}`);
      if (r.content) lines.push(`  ${r.content}`);
    }
    lines.push("");
  }

  if (regulatoryContext?.results?.length > 0) {
    lines.push("--- CONTEXTO REGULATORIO Y GEOPOLÍTICO ---");
    if (regulatoryContext.answer) lines.push(regulatoryContext.answer);
    for (const r of regulatoryContext.results) {
      lines.push(`- ${r.title}`);
      if (r.content) lines.push(`  ${r.content}`);
    }
    lines.push("");
  }

  if (fredContext) { lines.push(fredContext); lines.push(""); }

  lines.push("=== FIN DATOS ===");
  return lines.join("\n");
}

function buildSectorSystemPrompt(sector: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return `Eres un analista financiero institucional senior especializado en análisis sectorial. Fecha: ${today}.

Genera un informe sectorial completo y detallado sobre el sector "${sector}". Usa EXACTAMENTE estas 7 secciones iniciadas con "## ":
## Panorama del Sector
## Empresas Líderes
## Mejores ETFs
## Noticias y Tendencias
## Análisis Macro
## Perspectivas y Catalizadores
## Riesgos del Sector

== CONTENIDO POR SECCIÓN ==

## Panorama del Sector
- Párrafo 5-7 líneas: descripción del sector, tamaño de mercado (TAM), CAGR histórico y proyectado, segmentos clave, geografías dominantes, fase del ciclo.
- ### Métricas Clave: tabla Métrica | Valor con: Tamaño Mercado Global, CAGR proyectado, Número empresas cotizadas, Principales índices/benchmarks, Volatilidad relativa.
- ### Estructura del Sector: 4-5 líneas sobre cómo está organizado el sector (cadena de valor, segmentos, concentración).

## Empresas Líderes
- ### Tabla de Empresas Líderes: tabla Empresa | Ticker | País | Market Cap est. | Especialización
  Incluye 8-10 empresas. Empresa analizada en primera fila con *.
- Para cada empresa 2-3 líderes: párrafo 2-3 líneas explicando por qué son líderes, ventajas diferenciales, cuota de mercado.

## Mejores ETFs
- ### Tabla de ETFs: tabla ETF | Ticker | TER | AUM est. | Índice/Benchmark | Exposición geográfica
  Incluye 5-7 ETFs.
- Para cada ETF, 1-2 líneas sobre ventajas, liquidez, para qué tipo de inversor.

## Noticias y Tendencias
- ### Noticias Recientes: 5-7 noticias importantes (últimas 4 semanas). Formato: "- **Titular:** impacto 2-3 líneas."
- ### Tendencias Estructurales: 5-7 viñetas sobre megatendencias que definen el sector a largo plazo.
- ### Disruptores e Innovaciones: 3-4 viñetas sobre tecnologías o modelos que están transformando el sector.

## Análisis Macro
- ### Factores Macroeconómicos: 5-6 líneas sobre tipos de interés, inflación, ciclo económico, divisa, aranceles.
- Integra indicadores FRED disponibles (Fed Funds, yield 10Y, desempleo, CPI).
- ### Impacto Geopolítico: 3-4 líneas sobre geopolítica, regulación y política sectorial relevante.

## Perspectivas y Catalizadores
- ### Corto Plazo (0-6m): 3-4 catalizadores con impacto esperado y horizonte temporal.
- ### Medio Plazo (6-18m): 3-4 catalizadores de crecimiento o consolidación.
- ### Largo Plazo (+18m): 3-4 tendencias estructurales de crecimiento sostenido.
- ### Tesis de Inversión: 4-5 líneas con la tesis principal para invertir en este sector ahora.

## Riesgos del Sector
- 7-9 viñetas sobre riesgos principales. Formato: "- **Tipo de Riesgo:** descripción concreta con cifras o eventos. Nivel: **ALTO** / **MEDIO** / **BAJO**"
  Cubre: regulatorio, competencia, macro (tipos/aranceles/divisa), tecnológico, concentración, geopolítico, ESG.

REGLAS DE FORMATO:
- Markdown estricto. Sin emojis.
- Todos los números: exactamente 2 decimales donde aplique.
- Unidades siempre presentes: $, %, x, B, M.
- Niveles de riesgo en **NEGRITAS**: **ALTO**, **MEDIO**, **BAJO**.
- Tendencias/señales en **NEGRITAS**: **BULLISH**, **BEARISH**, **ALCISTA**, **BAJISTA**.
- Cuando menciones trimestres específicos, usa SIEMPRE formato Q1'24, Q2'24, Q3'24, Q4'24 (nunca "primer trimestre 2024", "ENE 24", ni "marzo 2024").
- Entre cada viñeta deja UNA LÍNEA EN BLANCO (doble salto de línea) para máxima legibilidad. Las viñetas pegadas son ilegibles.
- Datos faltantes: escribe "—" en la celda específica, NUNCA "N/D" o "N/A". Solo omite una fila entera si TODAS sus celdas estarían vacías.
- TODAS las 7 secciones (## ...) son obligatorias. No omitas ninguna.
- No cortes frases a medias.`;
}

// =====================================================
// HANDLERS
// =====================================================

interface EnvKeys {
  GEMINI_API_KEY: string;
  FINNHUB_KEY: string;
  TAVILY_KEY: string;
  FMP_KEY: string;
  FRED_KEY: string;
  TWELVE_KEY: string;
}

async function handleTickerAnalysis(ticker: string, env: EnvKeys): Promise<Response> {
  const cleanTicker = ticker.trim().toUpperCase();
  const encoder = new TextEncoder();

  // Return the SSE Response immediately so Supabase's 150s idle timeout never fires.
  // All data gathering and Gemini streaming happen inside the ReadableStream callback.
  const stream = new ReadableStream({
    async start(controller) {
      // Send SSE keepalive comments every 5s — resets Supabase's idle timer
      // so gemini-2.5-pro (60-90s generation) can complete without being killed.
      const keepalive = setInterval(() => {
        try { controller.enqueue(encoder.encode(": keepalive\n\n")); } catch (_) {}
      }, 5_000);

      try {
        // Step 1: Finnhub profile (sequential — companyName/sector/peers needed for Tavily queries)
        const finnhubData = env.FINNHUB_KEY ? await fetchFinnhubData(cleanTicker, env.FINNHUB_KEY) : null;
        const companyName = finnhubData?.profile?.name ?? cleanTicker;
        const sector      = finnhubData?.profile?.finnhubIndustry ?? "";
        const peers       = finnhubData?.peers ?? [];

        // Step 2: All remaining data in parallel
        const [
          yahooQuarterly,
          finnhubQuarterly,
          fmpQuarterly,
          twelveDataQuarterly,
          peerData,
          fredContext,
          fmpContext,
          twelveDataContext,
          technicalContext,
          geoContext,
          tickerNews,
          sectorNews,
          earningsSearch,
          competitiveSearch,
          risksCatalystsSearch,
          catalystCalendar,
        ] = await Promise.all([
          fetchYahooQuarterlyFinancials(cleanTicker),
          env.FINNHUB_KEY ? fetchQuarterlyFinancials(cleanTicker, env.FINNHUB_KEY) : Promise.resolve([]),
          env.FMP_KEY     ? fetchFmpQuarterlyFinancials(cleanTicker, env.FMP_KEY)  : Promise.resolve([]),
          env.TWELVE_KEY  ? fetchTwelveDataQuarterlyFinancials(cleanTicker, env.TWELVE_KEY) : Promise.resolve([]),
          env.FINNHUB_KEY ? fetchPeerData(peers, env.FINNHUB_KEY) : Promise.resolve([]),
          fetchFredData(env.FRED_KEY),
          fetchFmpData(cleanTicker, env.FMP_KEY),
          fetchTwelveData(cleanTicker, env.TWELVE_KEY),
          fetchTechnicalIndicators(cleanTicker, env.TWELVE_KEY),
          env.TAVILY_KEY
            ? fetchTavilySearch(`${companyName} ${cleanTicker} geopolitical regulatory tariffs sanctions 2025 2026`, env.TAVILY_KEY, 3, 60, undefined, 180)
            : Promise.resolve(null),
          env.TAVILY_KEY
            ? fetchTavilySearch(`${companyName} ${cleanTicker} news latest 2025 2026`, env.TAVILY_KEY, 4, 7, "news", 150)
            : Promise.resolve(null),
          env.TAVILY_KEY && sector
            ? fetchTavilySearch(`${sector} sector outlook trends 2025 2026`, env.TAVILY_KEY, 3, 14, "news", 130)
            : Promise.resolve(null),
          env.TAVILY_KEY
            ? fetchTavilySearch(`${companyName} ${cleanTicker} quarterly earnings revenue EPS results 2025`, env.TAVILY_KEY, 3, undefined, undefined, 140)
            : Promise.resolve(null),
          env.TAVILY_KEY && peers.length > 0
            ? fetchTavilySearch(`${companyName} vs ${peers.slice(0, 2).join(" ")} market share competitive 2025`, env.TAVILY_KEY, 2, undefined, undefined, 120)
            : Promise.resolve(null),
          env.TAVILY_KEY
            ? fetchTavilySearch(`${companyName} ${cleanTicker} risks catalysts growth headwinds 2025 2026`, env.TAVILY_KEY, 4, 30, "news", 160)
            : Promise.resolve(null),
          fetchCatalystCalendar(cleanTicker, env.FMP_KEY),
        ]);

        // Step 3: Merge quarterly data from all structured sources (Yahoo first)
        let quarterlyHistory = mergeQuarterlyData(
          yahooQuarterly      as any[],
          finnhubQuarterly    as any[],
          fmpQuarterly        as any[],
          twelveDataQuarterly as any[],
        );

        // AI fallback when structured sources returned fewer than 4 quarters
        let aiFallback: any[] = [];
        if (quarterlyHistory.length < 4 && env.TAVILY_KEY && env.GEMINI_API_KEY) {
          console.log(`Quarterly AI fallback triggered (0 structured quarters).`);
          aiFallback = await fetchAiQuarterlyFallback(cleanTicker, companyName, env.TAVILY_KEY, env.GEMINI_API_KEY);
          if (aiFallback.length > 0) {
            quarterlyHistory = mergeQuarterlyData(
              yahooQuarterly      as any[],
              finnhubQuarterly    as any[],
              fmpQuarterly        as any[],
              twelveDataQuarterly as any[],
              aiFallback,
            );
            console.log(`AI fallback: ${aiFallback.length} quarters added. Total: ${quarterlyHistory.length}`);
          }
        }

        // Step 4: Emit quarterly data event so frontend can render tables immediately
        const quarterlyDebug = {
          hasFinnhub:     !!env.FINNHUB_KEY,
          hasFmp:         !!env.FMP_KEY,
          hasTwelveData:  !!env.TWELVE_KEY,
          hasTavily:      !!env.TAVILY_KEY,
          yahooRows:      (yahooQuarterly as any[]).length,
          finnhubRows:    (finnhubQuarterly as any[]).length,
          fmpRows:        (fmpQuarterly as any[]).length,
          twelveDataRows: (twelveDataQuarterly as any[]).length,
          aiFallbackRows: aiFallback.length,
          mergedRows:     quarterlyHistory.length,
        };
        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({ __quarterly: quarterlyHistory, __quarterlyDebug: quarterlyDebug, __catalystCalendar: catalystCalendar })}\n\n`
        ));

        // Step 5: Build Gemini prompt
        const dataContext = buildTickerDataContext(
          finnhubData, peerData, quarterlyHistory, geoContext, sectorNews, tickerNews,
          earningsSearch, competitiveSearch, risksCatalystsSearch,
          fredContext, fmpContext, twelveDataContext, technicalContext,
        );

        console.log("Ticker data loaded:", {
          ticker: cleanTicker,
          finnhub_quote: !!finnhubData?.quote?.c,
          quarterly_history: quarterlyHistory.length,
          quarterly_fmp: (fmpQuarterly as any[]).length,
          quarterly_twelve_data: (twelveDataQuarterly as any[]).length,
        });

        const messages = [
          { role: "system", content: buildTickerSystemPrompt() },
          {
            role: "user",
            content: `${dataContext}

INSTRUCCIÓN FINAL:
Genera el informe completo sobre ${cleanTicker} (${companyName}) con las 7 secciones obligatorias.
- En ## Finanzas: incluye la tabla de métricas actuales. Las tablas trimestrales se renderizan automáticamente — NO las generes.
- En ## Valoración: desarrolla Factores de Riesgo con nivel **ALTO/MEDIO/BAJO** al final de cada viñeta.
- En ## Finanzas: para cualquier métrica no disponible en Finnhub, usa DATOS TWELVE DATA o FMP. Si no hay dato en ninguna fuente, OMITE esa fila. CERO N/D permitidos.
- En ## Sector: usa los datos de peers de Finnhub para la tabla comparativa. Omite columnas sin dato.
- En ## Señales Técnicas: usa los INDICADORES TÉCNICOS (TWELVE DATA). Si faltan datos, deriva tendencia del precio vs SMA o rango 52W.
- En ## Institucional: usa los datos estructurados de FMP como fuente principal.
- En ## Noticias / ## Resumen: integra los indicadores FRED en el contexto macro.
- Si el ticker no existe, indícalo en el Resumen Ejecutivo.`,
          },
        ];

        // Step 6: Call Gemini (Pro by default — keepalives above allow unlimited generation time)
        const gemini = await callGeminiStream(messages, env.GEMINI_API_KEY);
        if (!gemini.ok) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ __error: gemini.error })}\n\n`));
          return;
        }
        console.log(`Streaming ticker analysis with model: ${gemini.model}`);

        if (!gemini.response.body) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ __error: "Gemini returned empty response body" })}\n\n`));
          return;
        }

        // Step 7: Pipe Gemini SSE output directly
        const geminiReader = gemini.response.body.getReader();
        while (true) {
          const { done, value } = await geminiReader.read();
          if (done) break;
          controller.enqueue(value);
        }
      } catch (e: any) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ __error: e?.message ?? "Error interno del servidor" })}\n\n`));
        } catch (_) {}
      } finally {
        clearInterval(keepalive);
        try { controller.close(); } catch (_) {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}

async function handleSectorAnalysis(sector: string, env: EnvKeys): Promise<Response> {
  const cleanSector = sector.trim();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const keepalive = setInterval(() => {
        try { controller.enqueue(encoder.encode(": keepalive\n\n")); } catch (_) {}
      }, 5_000);

      try {
        const [
          sectorNews,
          sectorTrends,
          topCompanies,
          sectorETFs,
          macroNews,
          regulatoryContext,
          fredContext,
        ] = await Promise.all([
          env.TAVILY_KEY ? fetchTavilySearch(`${cleanSector} sector news latest 2025 2026`, env.TAVILY_KEY, 6, 30, "news", 180) : Promise.resolve({ answer: "", results: [] }),
          env.TAVILY_KEY ? fetchTavilySearch(`${cleanSector} sector outlook trends growth forecast 2025 2026`, env.TAVILY_KEY, 5, undefined, undefined, 180) : Promise.resolve({ answer: "", results: [] }),
          env.TAVILY_KEY ? fetchTavilySearch(`top companies ${cleanSector} sector leaders market cap 2025`, env.TAVILY_KEY, 5, undefined, undefined, 160) : Promise.resolve({ answer: "", results: [] }),
          env.TAVILY_KEY ? fetchTavilySearch(`best ETF ${cleanSector} sector invest 2025`, env.TAVILY_KEY, 4, undefined, undefined, 140) : Promise.resolve({ answer: "", results: [] }),
          env.TAVILY_KEY ? fetchTavilySearch(`${cleanSector} sector interest rates inflation tariffs macro impact 2025`, env.TAVILY_KEY, 4, 60, undefined, 160) : Promise.resolve({ answer: "", results: [] }),
          env.TAVILY_KEY ? fetchTavilySearch(`${cleanSector} sector regulation policy geopolitical risk 2025 2026`, env.TAVILY_KEY, 3, 90, undefined, 150) : Promise.resolve({ answer: "", results: [] }),
          fetchFredData(env.FRED_KEY),
        ]);

        const dataContext = buildSectorDataContext(
          cleanSector, sectorNews, sectorTrends, topCompanies,
          sectorETFs, macroNews, regulatoryContext, fredContext,
        );

        console.log("Sector data loaded:", {
          sector: cleanSector,
          tavily_news: (sectorNews as any)?.results?.length ?? 0,
          tavily_trends: (sectorTrends as any)?.results?.length ?? 0,
        });

        const messages = [
          { role: "system", content: buildSectorSystemPrompt(cleanSector) },
          {
            role: "user",
            content: `${dataContext}

INSTRUCCIÓN FINAL:
Genera el informe sectorial completo sobre "${cleanSector}" con las 7 secciones obligatorias.
- Usa todas las noticias y datos de investigación proporcionados.
- Sé específico: menciona empresas reales, tickers, cifras concretas.
- Integra los indicadores FRED en el Análisis Macro.
- Las tablas de empresas y ETFs deben tener datos reales y completos.
- Si no existe un dato, omite esa fila — nunca uses N/D.`,
          },
        ];

        const gemini = await callGeminiStream(messages, env.GEMINI_API_KEY);
        if (!gemini.ok) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ __error: gemini.error })}\n\n`));
          return;
        }
        console.log(`Streaming sector analysis with model: ${gemini.model}`);

        if (!gemini.response.body) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ __error: "Gemini returned empty response body" })}\n\n`));
          return;
        }

        const geminiReader = gemini.response.body.getReader();
        while (true) {
          const { done, value } = await geminiReader.read();
          if (done) break;
          controller.enqueue(value);
        }
      } catch (e: any) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ __error: e?.message ?? "Error interno del servidor" })}\n\n`));
        } catch (_) {}
      } finally {
        clearInterval(keepalive);
        try { controller.close(); } catch (_) {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}

// =====================================================
// MARKET DATA HANDLER
// =====================================================

// Dedicated, chart-ready fundamentals endpoint backed by Yahoo Finance.
// Body: { fundamentals: true, ticker: "AAPL" }
// Returns a guaranteed-serializable object: parallel forward-filled numeric
// series (so chart lines never break) plus 3-month daily price history.
async function handleFundamentals(ticker: string): Promise<Response> {
  const sym = ticker.trim().toUpperCase();

  const qLabel = (iso: string): string => {
    const d = new Date(iso + "T00:00:00Z");
    if (isNaN(d.getTime())) return iso;
    return `Q${Math.floor(d.getUTCMonth() / 3) + 1}'${String(d.getUTCFullYear()).slice(2)}`;
  };

  const [tsResult, price] = await Promise.all([
    yfFundamentalsTimeseries(sym),
    fetchYahooChart(sym, "3mo", "1d"),
  ]);

  // Ticker doesn't exist / Yahoo has nothing → explicit not-found, stable shape.
  if (!tsResult && !price) {
    return new Response(JSON.stringify({
      ticker: sym, found: false, periods: [], series: {}, price: null, ts: Date.now(),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // type -> Map<asOfDate, raw>
  const byType = new Map<string, Map<string, number | null>>();
  for (const series of (tsResult ?? [])) {
    const type: string | undefined = series?.meta?.type?.[0];
    if (!type) continue;
    const arr = series[type];
    if (!Array.isArray(arr)) continue;
    const m = new Map<string, number | null>();
    for (const pt of arr) {
      if (!pt?.asOfDate) continue;
      m.set(pt.asOfDate, jsonSafeNum(pt?.reportedValue?.raw));
    }
    byType.set(type, m);
  }

  const dates = new Set<string>();
  for (const m of byType.values()) for (const d of m.keys()) dates.add(d);
  // oldest → newest is what charts plot left-to-right
  const periodsIso = [...dates].sort((a, b) => a.localeCompare(b)).slice(-16);
  const pick = (type: string, date: string) => byType.get(type)?.get(date) ?? null;
  const col = (type: string) => periodsIso.map((d) => pick(type, d));

  const revenue   = col("quarterlyTotalRevenue");
  const grossP    = col("quarterlyGrossProfit");
  const ebitda    = periodsIso.map((d) => pick("quarterlyEBITDA", d) ?? pick("quarterlyNormalizedEBITDA", d));
  const netIncome = col("quarterlyNetIncome");
  const opCF      = col("quarterlyOperatingCashFlow");
  const capexRaw  = col("quarterlyCapitalExpenditure");
  const capex     = capexRaw.map((v) => (v != null ? Math.abs(v) : null));
  const fcf        = periodsIso.map((d, i) => {
    const direct = pick("quarterlyFreeCashFlow", d);
    if (direct != null) return direct;
    const o = opCF[i]; const c = capexRaw[i];
    return (o != null && c != null) ? o + c : null;
  });
  const cash       = periodsIso.map((d) => pick("quarterlyCashAndCashEquivalents", d) ?? pick("quarterlyCashCashEquivalentsAndShortTermInvestments", d));
  const totalDebt  = col("quarterlyTotalDebt");
  const equity     = col("quarterlyStockholdersEquity");
  const totalAssets= col("quarterlyTotalAssets");

  const grossMargin = revenue.map((r, i) => (r != null && r !== 0 && grossP[i] != null) ? (grossP[i]! / r) * 100 : null);
  const netMargin   = revenue.map((r, i) => (r != null && r !== 0 && netIncome[i] != null) ? (netIncome[i]! / r) * 100 : null);
  const revenueGrowth = revenue.map((r, i) => {
    const prev = revenue[i - 4];
    return (i >= 4 && r != null && prev != null && Math.abs(prev) > 0) ? ((r - prev) / Math.abs(prev)) * 100 : null;
  });

  // Forward-fill every monetary series so chart lines are continuous; ratios
  // are NOT forward-filled (a fake flat margin would be misleading) — they stay
  // null and the chart's connectNulls handles the gaps.
  const payload = deepJsonSafe({
    ticker: sym,
    found: periodsIso.length > 0 || !!price,
    periods: periodsIso.map(qLabel),
    periodsIso,
    series: {
      revenue:      forwardFill(revenue),
      ebitda:       forwardFill(ebitda),
      netIncome:    forwardFill(netIncome),
      operatingCF:  forwardFill(opCF),
      capex:        forwardFill(capex),
      fcf:          forwardFill(fcf),
      totalAssets:  forwardFill(totalAssets),
      cash:         forwardFill(cash),
      totalDebt:    forwardFill(totalDebt),
      equity:       forwardFill(equity),
      grossMargin:  grossMargin.map(jsonSafeNum),
      netMargin:    netMargin.map(jsonSafeNum),
      revenueGrowth: revenueGrowth.map(jsonSafeNum),
    },
    price: price ?? null,
    ts: Date.now(),
  });

  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function handleMarketData(env: EnvKeys, extraSymbols: string[]): Promise<Response> {
  // Major asset-class proxies — quotes from Finnhub, candles from Yahoo Finance
  const INDICES: Array<{ symbol: string; label: string }> = [
    { symbol: "SPY",  label: "S&P 500"      },
    { symbol: "QQQ",  label: "NASDAQ 100"   },
    { symbol: "DIA",  label: "DOW JONES"    },
    { symbol: "IWM",  label: "RUSSELL 2000" },
    { symbol: "VIXY", label: "VIX VOL"      },
    { symbol: "GLD",  label: "ORO"          },
    { symbol: "TLT",  label: "BONOS 20Y+"   },
  ];
  const indexSymbols = INDICES.map(i => i.symbol);
  const allSymbols = [...indexSymbols, ...extraSymbols.filter(s => !indexSymbols.includes(s))];

  // Candles come from the shared, cached fetchYahooChart() helper (3-month daily
  // closes, forward-filled). The 10-min TTL cache shields us from IP rate-limits.
  const [quotesResult, candlesResult, fred10y, fred2y] = await Promise.allSettled([
    Promise.all(allSymbols.map(s =>
      finnhubGet(`/quote?symbol=${s}`, env.FINNHUB_KEY)
        .then(d => d ? { symbol: s, c: d.c as number, dp: d.dp as number } : { symbol: s, c: null, dp: null })
    )),
    Promise.all(indexSymbols.map(async s => ({ symbol: s, data: await fetchYahooChart(s, "3mo", "1d") }))),
    env.FRED_KEY
      ? fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=DGS10&apikey=${env.FRED_KEY}&limit=5&sort_order=desc&file_type=json`).then(r => r.json()).catch(() => null)
      : Promise.resolve(null),
    env.FRED_KEY
      ? fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=DGS2&apikey=${env.FRED_KEY}&limit=5&sort_order=desc&file_type=json`).then(r => r.json()).catch(() => null)
      : Promise.resolve(null),
  ]);

  const quoteList = quotesResult.status === "fulfilled" ? quotesResult.value : [];
  const quoteMap: Record<string, { c: number | null; dp: number | null }> = {};
  for (const q of quoteList) quoteMap[q.symbol] = q;

  const calc1m = (candle: { t: number[]; c: number[] } | null): number | null => {
    if (!candle || candle.c.length < 2) return null;
    // Walk back from the last bar to find the close ~30 days earlier (or oldest available)
    const last = candle.c[candle.c.length - 1];
    const lastT = candle.t[candle.t.length - 1];
    const cutoff = lastT - 30 * 86_400;
    let baseIdx = 0;
    for (let i = candle.t.length - 1; i >= 0; i--) {
      if (candle.t[i] <= cutoff) { baseIdx = i; break; }
    }
    const base = candle.c[baseIdx];
    return base > 0 ? +((last - base) / base * 100).toFixed(2) : null;
  };

  const candleMap: Record<string, { t: number[]; c: number[] } | null> = {};
  const change1mMap: Record<string, number | null> = {};
  if (candlesResult.status === "fulfilled") {
    for (const { symbol, data } of candlesResult.value) {
      candleMap[symbol]   = data;
      change1mMap[symbol] = calc1m(data);
    }
  }

  const getYield = (result: PromiseSettledResult<any>): number | null => {
    if (result.status !== "fulfilled" || !result.value) return null;
    const obs: any[] = result.value?.observations?.filter((o: any) => o.value !== ".") ?? [];
    return obs.length ? parseFloat(obs[0].value) : null;
  };

  const yield10y = getYield(fred10y);
  const yield2y  = getYield(fred2y);
  const spread   = yield10y != null && yield2y != null ? +((yield10y - yield2y) * 100).toFixed(0) : null;

  const makeQ = (symbol: string, label: string, change1m: number | null = null) => ({
    symbol, label,
    price:    quoteMap[symbol]?.c ?? null,
    change1d: quoteMap[symbol]?.dp != null ? +quoteMap[symbol].dp!.toFixed(2) : null,
    change1m,
  });

  return new Response(JSON.stringify({
    indices: INDICES.map(({ symbol, label }) => makeQ(symbol, label, change1mMap[symbol] ?? null)),
    yield10y,
    yield2y,
    spread,
    stocks: extraSymbols.map(s => makeQ(s, s)),
    candles: candleMap,
    ts: Date.now(),
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// =====================================================
// OPTIONS  (sección "Opciones") — additive & isolated
//   Pulls option chains from Yahoo and computes EVERY Greek + flow
//   aggregation analytically (Black-Scholes-Merton) — never by an LLM.
//   Reuses corsHeaders / YF_UA / yfGetAuth / fetchYahooChart defined above.
//   Dispatched from the main handler via body.optionsAction.
//   Verified vs Hull: call 10.4506, delta 0.6368 (S=100,K=100,T=1,r=.05,σ=.2).
// =====================================================

const OPT_RISK_FREE = parseFloat(Deno.env.get("RISK_FREE_RATE") || "0.0525");
const OPT_MULT = 100;
const OPT_MIN_IV = 0.01;
const OPT_MAX_IV = 5.0;

// erf via Abramowitz-Stegun 7.1.26 (max error ~1.5e-7) — ample for Greeks.
function oErf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
  return sign * y;
}
const O_SQRT2 = Math.sqrt(2);
const O_INV_SQRT_2PI = 1 / Math.sqrt(2 * Math.PI);
const oNormCdf = (x: number): number => 0.5 * (1 + oErf(x / O_SQRT2));
const oNormPdf = (x: number): number => O_INV_SQRT_2PI * Math.exp(-0.5 * x * x);

interface OptGreeks {
  delta: number | null; gamma: number | null; theta: number | null;
  vega: number | null; rho: number | null; vanna: number | null; charm: number | null;
}

// Trader-scaled Greeks: theta & charm per calendar DAY; vega/rho/vanna per 1 vol pt.
function oGreeks(S: number, K: number, T: number, r: number, q: number, sigma: number, isCall: boolean): OptGreeks {
  if (!(T > 0) || !(sigma > 0) || !(S > 0) || !(K > 0)) {
    return { delta: null, gamma: null, theta: null, vega: null, rho: null, vanna: null, charm: null };
  }
  const volSqrtT = sigma * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / volSqrtT;
  const d2 = d1 - volSqrtT;
  const dq = Math.exp(-q * T);
  const dr = Math.exp(-r * T);
  const sqrtT = Math.sqrt(T);
  const pdf = oNormPdf(d1);

  const delta = isCall ? dq * oNormCdf(d1) : dq * (oNormCdf(d1) - 1);
  const gamma = (dq * pdf) / (S * sigma * sqrtT);
  const vega = S * dq * pdf * sqrtT;
  const common = -(S * dq * pdf * sigma) / (2 * sqrtT);
  const thetaYr = isCall
    ? common - r * K * dr * oNormCdf(d2) + q * S * dq * oNormCdf(d1)
    : common + r * K * dr * oNormCdf(-d2) - q * S * dq * oNormCdf(-d1);
  const rhoRaw = isCall ? K * T * dr * oNormCdf(d2) : -K * T * dr * oNormCdf(-d2);
  const vannaRaw = (-dq * pdf * d2) / sigma;
  const charmCore = (dq * pdf * (2 * (r - q) * T - d2 * sigma * sqrtT)) / (2 * T * sigma * sqrtT);
  const charmYr = isCall ? q * dq * oNormCdf(d1) - charmCore : -q * dq * oNormCdf(-d1) - charmCore;

  const c = (v: number): number | null => (Number.isFinite(v) ? v : null);
  return {
    delta: c(delta), gamma: c(gamma), theta: c(thetaYr / 365),
    vega: c(vega * 0.01), rho: c(rhoRaw * 0.01), vanna: c(vannaRaw * 0.01), charm: c(charmYr / 365),
  };
}

type OptType = "call" | "put";
interface OptContract {
  contractSymbol: string; type: OptType; strike: number;
  lastPrice: number | null; bid: number | null; ask: number | null; mid: number | null;
  volume: number | null; openInterest: number | null; impliedVolatility: number | null;
  inTheMoney: boolean;
  delta: number | null; gamma: number | null; theta: number | null; vega: number | null;
  rho: number | null; vanna: number | null; charm: number | null;
  intrinsic: number | null; extrinsic: number | null;
}

const oF = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};
const oNum = (v: unknown): number => oF(v) ?? 0;
const oInt = (v: unknown): number | null => { const n = oF(v); return n === null ? null : Math.trunc(n); };
const oNowIso = (): string => new Date().toISOString();
const oIsoFromEpoch = (e: number): string => new Date(e * 1000).toISOString().slice(0, 10);

function oYearFraction(expiry: string): { days: number; T: number } {
  const exp = Date.parse(`${expiry}T00:00:00Z`);
  const days = Math.floor((exp - Date.now()) / 86_400_000);
  let T = Math.max(days, 0) / 365;
  if (T <= 0) T = 0.5 / 365;
  return { days, T };
}

class OptError extends Error { status: number; constructor(m: string, s = 400) { super(m); this.status = s; } }

interface OptYahooResult {
  spot: number; dividendYield: number; expirationDates: number[];
  rawCalls: Record<string, unknown>[]; rawPuts: Record<string, unknown>[];
}

interface OptCacheEntry { ts: number; data: unknown; }
const OPT_CACHE = new Map<string, OptCacheEntry>();
const OPT_CACHE_TTL = 4 * 60 * 60 * 1000; // 4h
function optCacheGet<T>(k: string): T | undefined {
  const e = OPT_CACHE.get(k);
  if (!e) return undefined;
  if (Date.now() - e.ts > OPT_CACHE_TTL) { OPT_CACHE.delete(k); return undefined; }
  return e.data as T;
}
function optCacheSet(k: string, data: unknown): void {
  OPT_CACHE.set(k, { ts: Date.now(), data });
  if (OPT_CACHE.size > 200) {
    let oldest: string | null = null, oldestTs = Infinity;
    for (const [kk, v] of OPT_CACHE) if (v.ts < oldestTs) { oldestTs = v.ts; oldest = kk; }
    if (oldest) OPT_CACHE.delete(oldest);
  }
}

async function oYahooOptions(ticker: string, dateEpoch?: number): Promise<OptYahooResult> {
  const auth = await yfGetAuth();
  const sym = encodeURIComponent(ticker.toUpperCase());
  let url = `https://query2.finance.yahoo.com/v7/finance/options/${sym}`;
  const qp: string[] = [];
  if (dateEpoch) qp.push(`date=${dateEpoch}`);
  if (auth?.crumb) qp.push(`crumb=${encodeURIComponent(auth.crumb)}`);
  if (qp.length) url += `?${qp.join("&")}`;

  const r = await fetch(url, {
    headers: { "User-Agent": YF_UA, ...(auth?.cookie ? { Cookie: auth.cookie } : {}) },
    signal: AbortSignal.timeout(12_000),
  });
  if (!r.ok) throw new OptError(`Yahoo respondió ${r.status} para ${ticker}`, 502);
  const j = await r.json();
  const res = j?.optionChain?.result?.[0];
  if (!res) throw new OptError(j?.optionChain?.error?.description || `Sin datos de opciones para ${ticker}`, 404);
  const quote = res.quote ?? {};
  const spot = oF(quote.regularMarketPrice) ?? oF(quote.postMarketPrice) ?? oF(quote.regularMarketPreviousClose) ?? 0;
  if (!spot) throw new OptError(`Sin precio spot para ${ticker}`, 404);

  let q = oF(quote.trailingAnnualDividendYield);
  if (q === null) { const dyPct = oF(quote.dividendYield); q = dyPct === null ? 0 : (dyPct > 1 ? dyPct / 100 : dyPct); }
  q = Math.max(0, Math.min(q ?? 0, 0.25));

  const opt = res.options?.[0] ?? {};
  return {
    spot, dividendYield: q,
    expirationDates: (res.expirationDates ?? []).map((e: unknown) => Number(e)).filter((e: number) => e > 0),
    rawCalls: opt.calls ?? [], rawPuts: opt.puts ?? [],
  };
}

function oEnrich(rows: Record<string, unknown>[], type: OptType, S: number, T: number, r: number, q: number): OptContract[] {
  const isCall = type === "call";
  return rows.map((rec) => {
    const k = oF(rec.strike);
    const bid = oF(rec.bid), ask = oF(rec.ask), last = oF(rec.lastPrice);
    let iv = oF(rec.impliedVolatility);
    const badIv = iv === null || iv < OPT_MIN_IV || iv > OPT_MAX_IV;
    if (badIv) iv = null;

    let mid: number | null = null;
    if (bid !== null && ask !== null && bid > 0 && ask > 0) mid = (bid + ask) / 2;
    else if (last !== null && last > 0) mid = last;

    let intrinsic: number | null = null;
    if (k !== null) intrinsic = isCall ? Math.max(S - k, 0) : Math.max(k - S, 0);
    const extrinsic = mid !== null && intrinsic !== null ? mid - intrinsic : null;

    let itm = rec.inTheMoney as boolean | undefined;
    if (itm === undefined && k !== null) itm = isCall ? S > k : S < k;

    const g = !badIv && k !== null && iv !== null
      ? oGreeks(S, k, T, r, q, iv, isCall)
      : { delta: null, gamma: null, theta: null, vega: null, rho: null, vanna: null, charm: null };

    return {
      contractSymbol: String(rec.contractSymbol ?? `${type}-${k}`),
      type, strike: k ?? 0, lastPrice: last, bid, ask, mid,
      volume: oInt(rec.volume), openInterest: oInt(rec.openInterest),
      impliedVolatility: iv, inTheMoney: Boolean(itm), ...g, intrinsic, extrinsic,
    };
  });
}

interface OptStrikeRow {
  strike: number; gex: number; callGex: number; putGex: number; dex: number; vex: number;
  callOI: number; putOI: number; callVolume: number; putVolume: number;
}
function oExposures(calls: OptContract[], puts: OptContract[], spot: number, mult = OPT_MULT) {
  const set = new Set<number>();
  calls.forEach((c) => set.add(c.strike)); puts.forEach((p) => set.add(p.strike));
  const strikes = [...set].sort((a, b) => a - b);
  const table = new Map<number, OptStrikeRow>();
  for (const k of strikes) table.set(k, { strike: k, gex: 0, callGex: 0, putGex: 0, dex: 0, vex: 0, callOI: 0, putOI: 0, callVolume: 0, putVolume: 0 });
  const s2 = spot * spot * 0.01;

  for (const c of calls) {
    const row = table.get(c.strike)!; const oi = Math.trunc(oNum(c.openInterest));
    row.callOI += oi; row.callVolume += Math.trunc(oNum(c.volume));
    if (c.gamma !== null) { const cg = c.gamma * oi * mult * s2; row.callGex += cg; row.gex += cg; }
    if (c.delta !== null) row.dex += c.delta * oi * mult * spot;
    if (c.vega !== null) row.vex += c.vega * oi * mult;
  }
  for (const p of puts) {
    const row = table.get(p.strike)!; const oi = Math.trunc(oNum(p.openInterest));
    row.putOI += oi; row.putVolume += Math.trunc(oNum(p.volume));
    if (p.gamma !== null) { const pg = -p.gamma * oi * mult * s2; row.putGex += pg; row.gex += pg; }
    if (p.delta !== null) row.dex += p.delta * oi * mult * spot;
    if (p.vega !== null) row.vex += -p.vega * oi * mult;
  }
  const perStrike = strikes.map((k) => table.get(k)!);
  return {
    perStrike,
    totals: {
      totalGex: perStrike.reduce((s, r) => s + r.gex, 0),
      totalDex: perStrike.reduce((s, r) => s + r.dex, 0),
      totalVex: perStrike.reduce((s, r) => s + r.vex, 0),
    },
  };
}
function oGammaFlip(perStrike: OptStrikeRow[]): number | null {
  const pts = [...perStrike].sort((a, b) => a.strike - b.strike);
  let cum = 0, prevCum: number | null = null, prevStrike = 0;
  for (const p of pts) {
    cum += p.gex;
    if (prevCum !== null && ((prevCum <= 0 && cum > 0) || (prevCum >= 0 && cum < 0))) {
      if (cum !== prevCum) { const frac = -prevCum / (cum - prevCum); return prevStrike + frac * (p.strike - prevStrike); }
      return p.strike;
    }
    prevCum = cum; prevStrike = p.strike;
  }
  return null;
}
function oMaxPain(calls: OptContract[], puts: OptContract[]): number | null {
  const set = new Set<number>(); calls.forEach((c) => set.add(c.strike)); puts.forEach((p) => set.add(p.strike));
  const strikes = [...set].sort((a, b) => a - b);
  if (!strikes.length) return null;
  let bestK: number | null = null, bestVal = Infinity;
  for (const kt of strikes) {
    let total = 0;
    for (const c of calls) if (kt > c.strike) total += (kt - c.strike) * oNum(c.openInterest);
    for (const p of puts) if (kt < p.strike) total += (p.strike - kt) * oNum(p.openInterest);
    if (total < bestVal) { bestVal = total; bestK = kt; }
  }
  return bestK;
}
function oPutCallRatio(calls: OptContract[], puts: OptContract[]) {
  const cOI = calls.reduce((s, c) => s + oNum(c.openInterest), 0);
  const pOI = puts.reduce((s, p) => s + oNum(p.openInterest), 0);
  const cV = calls.reduce((s, c) => s + oNum(c.volume), 0);
  const pV = puts.reduce((s, p) => s + oNum(p.volume), 0);
  return { oi: cOI > 0 ? pOI / cOI : null, vol: cV > 0 ? pV / cV : null };
}
function oWalls(calls: OptContract[], puts: OptContract[], n = 5) {
  const cw = calls.filter((c) => oNum(c.openInterest) > 0)
    .map((c) => ({ strike: c.strike, openInterest: Math.trunc(oNum(c.openInterest)), type: "call" as OptType }))
    .sort((a, b) => b.openInterest - a.openInterest).slice(0, n);
  const pw = puts.filter((p) => oNum(p.openInterest) > 0)
    .map((p) => ({ strike: p.strike, openInterest: Math.trunc(oNum(p.openInterest)), type: "put" as OptType }))
    .sort((a, b) => b.openInterest - a.openInterest).slice(0, n);
  return { cw, pw };
}
function oAtmIv(calls: OptContract[], puts: OptContract[], spot: number): number | null {
  const nearest = (rows: OptContract[]): number | null => {
    const v = rows.map((r) => ({ d: Math.abs(r.strike - spot), iv: r.impliedVolatility }))
      .filter((x) => x.iv !== null && x.iv > 0).sort((a, b) => a.d - b.d);
    return v.length ? v[0].iv : null;
  };
  const vals = [nearest(calls), nearest(puts)].filter((v): v is number => v !== null);
  return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
}
function oStraddleMid(calls: OptContract[], puts: OptContract[], spot: number): number | null {
  const nm = (rows: OptContract[]): number | null => {
    const c = rows.map((r) => ({ d: Math.abs(r.strike - spot), m: r.mid }))
      .filter((x) => x.m !== null && x.m > 0).sort((a, b) => a.d - b.d);
    return c.length ? c[0].m : null;
  };
  const cm = nm(calls), pm = nm(puts);
  return cm === null || pm === null ? null : cm + pm;
}
function oExpectedMove(spot: number, iv: number | null, T: number) {
  const pct = iv !== null && iv > 0 && T > 0 ? iv * Math.sqrt(T) : null;
  return { pct, abs: pct !== null ? spot * pct : null };
}
function oHvSeries(closes: number[], window = 30): (number | null)[] {
  const n = closes.length;
  const out: (number | null)[] = new Array(n).fill(null);
  if (n < window + 1) return out;
  const logRet: number[] = [];
  for (let i = 1; i < n; i++) logRet.push(Math.log(closes[i] / closes[i - 1]));
  for (let i = window; i < n; i++) {
    const win = logRet.slice(i - window, i);
    if (win.length === window && win.every((x) => Number.isFinite(x))) {
      const mean = win.reduce((s, x) => s + x, 0) / window;
      const variance = win.reduce((s, x) => s + (x - mean) ** 2, 0) / (window - 1);
      out[i] = Math.sqrt(variance) * Math.sqrt(252);
    }
  }
  return out;
}

async function oGetMeta(ticker: string): Promise<OptYahooResult> {
  const key = `opt-meta:${ticker}`;
  const cached = optCacheGet<OptYahooResult>(key);
  const res = cached ?? (await oYahooOptions(ticker));
  if (!cached) optCacheSet(key, res);
  return res;
}
const oExpiryToEpoch = (dateStr: string, epochs: number[]): number | undefined =>
  epochs.find((e) => oIsoFromEpoch(e) === dateStr);

async function oBuildChain(ticker: string, expiry: string) {
  const key = `opt-chain:${ticker}:${expiry}`;
  const cached = optCacheGet<{ spot: number; q: number; calls: OptContract[]; puts: OptContract[]; days: number; T: number }>(key);
  if (cached) return cached;
  const meta = await oGetMeta(ticker);
  const epoch = oExpiryToEpoch(expiry, meta.expirationDates);
  const data = await oYahooOptions(ticker, epoch);
  const { days, T } = oYearFraction(expiry);
  const r = OPT_RISK_FREE, q = data.dividendYield;
  const calls = oEnrich(data.rawCalls, "call", data.spot, T, r, q);
  const puts = oEnrich(data.rawPuts, "put", data.spot, T, r, q);
  const result = { spot: data.spot, q, calls, puts, days, T };
  optCacheSet(key, result);
  return result;
}

// ── action handlers (shapes mirror src/types/options.ts) ──────────────
async function oHandleExpiries(ticker: string) {
  const meta = await oGetMeta(ticker);
  return { ticker: ticker.toUpperCase(), spot: meta.spot, expiries: meta.expirationDates.map(oIsoFromEpoch), dividendYield: meta.dividendYield, riskFreeRate: OPT_RISK_FREE };
}
async function oHandleChain(ticker: string, expiry: string) {
  const c = await oBuildChain(ticker, expiry);
  return { ticker: ticker.toUpperCase(), expiry, spot: c.spot, riskFreeRate: OPT_RISK_FREE, dividendYield: c.q, daysToExpiry: c.days, T: c.T, calls: c.calls, puts: c.puts, cached: false, fetchedAt: oNowIso() };
}
async function oHandleAggregations(ticker: string, expiry: string) {
  const c = await oBuildChain(ticker, expiry);
  const { perStrike, totals } = oExposures(c.calls, c.puts, c.spot);
  const { cw, pw } = oWalls(c.calls, c.puts);
  const pcr = oPutCallRatio(c.calls, c.puts);
  const iv = oAtmIv(c.calls, c.puts, c.spot);
  const straddle = oStraddleMid(c.calls, c.puts, c.spot);
  const em = oExpectedMove(c.spot, iv, c.T);
  return {
    ticker: ticker.toUpperCase(), expiry, spot: c.spot, perStrike,
    totalGex: totals.totalGex, totalDex: totals.totalDex, totalVex: totals.totalVex,
    gammaFlip: oGammaFlip(perStrike), maxPain: oMaxPain(c.calls, c.puts),
    putCallRatioOI: pcr.oi, putCallRatioVol: pcr.vol,
    expectedMovePct: em.pct, expectedMoveAbs: em.abs, expectedMoveStraddle: straddle,
    atmIV: iv, callWalls: cw, putWalls: pw, cached: false, fetchedAt: oNowIso(),
  };
}
async function oHandleSkew(ticker: string, expiry: string) {
  const c = await oBuildChain(ticker, expiry);
  const cm = new Map<number, OptContract>(), pm = new Map<number, OptContract>();
  c.calls.forEach((x) => cm.set(x.strike, x)); c.puts.forEach((x) => pm.set(x.strike, x));
  const strikes = [...new Set([...cm.keys(), ...pm.keys()])].sort((a, b) => a - b);
  const points = strikes.map((k) => {
    const callIV = cm.get(k)?.impliedVolatility ?? null;
    const putIV = pm.get(k)?.impliedVolatility ?? null;
    const smile = k >= c.spot ? callIV : putIV;
    return { strike: k, moneyness: k / c.spot, callIV, putIV, iv: smile };
  });
  return { ticker: ticker.toUpperCase(), expiry, spot: c.spot, points, cached: false, fetchedAt: oNowIso() };
}
async function oHandleTermStructure(ticker: string, maxExpiries = 8) {
  const meta = await oGetMeta(ticker);
  const expiries = meta.expirationDates.slice(0, maxExpiries).map(oIsoFromEpoch);
  const points = [];
  for (const expiry of expiries) {
    try {
      const c = await oBuildChain(ticker, expiry);
      const iv = oAtmIv(c.calls, c.puts, c.spot);
      points.push({ expiry, daysToExpiry: c.days, atmIV: iv, expectedMovePct: oExpectedMove(c.spot, iv, c.T).pct });
    } catch (_) { /* skip */ }
  }
  return { ticker: ticker.toUpperCase(), spot: meta.spot, points, cached: false, fetchedAt: oNowIso() };
}
async function oHandleSurface(ticker: string, maxExpiries = 8, mMin = 0.7, mMax = 1.3) {
  const meta = await oGetMeta(ticker);
  const expiries = meta.expirationDates.slice(0, maxExpiries).map(oIsoFromEpoch);
  const points = []; const used: string[] = [];
  for (const expiry of expiries) {
    try {
      const c = await oBuildChain(ticker, expiry);
      used.push(expiry);
      const add = (rows: OptContract[], type: OptType) => {
        for (const r of rows) {
          const m = r.strike / c.spot;
          if (r.impliedVolatility === null || m < mMin || m > mMax) continue;
          if ((type === "call" && m >= 1) || (type === "put" && m < 1)) {
            points.push({ strike: r.strike, expiry, daysToExpiry: c.days, moneyness: m, iv: r.impliedVolatility, type });
          }
        }
      };
      add(c.calls, "call"); add(c.puts, "put");
    } catch (_) { /* skip */ }
  }
  return { ticker: ticker.toUpperCase(), spot: meta.spot, expiries: used, points, cached: false, fetchedAt: oNowIso() };
}
async function oHandleIvHv(ticker: string, window = 30) {
  const meta = await oGetMeta(ticker);
  const hist = await fetchYahooChart(ticker, "1y", "1d");
  const closes = hist?.c ?? [];
  const dates = (hist?.t ?? []).map((ts) => new Date(ts * 1000).toISOString().slice(0, 10));
  const series = oHvSeries(closes, window);
  const out = dates.map((d, i) => ({ date: d, hv: series[i] ?? null, close: closes[i] ?? null }));

  let currentIV30: number | null = null;
  try {
    let best: string | null = null, bestDiff = Infinity;
    for (const e of meta.expirationDates.map(oIsoFromEpoch)) {
      const diff = Math.abs(oYearFraction(e).days - 30);
      if (diff < bestDiff) { bestDiff = diff; best = e; }
    }
    if (best) { const c = await oBuildChain(ticker, best); currentIV30 = oAtmIv(c.calls, c.puts, c.spot); }
  } catch (_) { /* leave null */ }

  let currentHV: number | null = null;
  for (let i = series.length - 1; i >= 0; i--) { if (series[i] !== null) { currentHV = series[i]; break; } }
  const variancePremium = currentIV30 !== null && currentHV !== null ? currentIV30 - currentHV : null;

  return {
    ticker: ticker.toUpperCase(), window, currentIV30, currentHV, variancePremium,
    series: out, ivRank: null, ivPercentile: null, cached: false, fetchedAt: oNowIso(),
  };
}

// Single entrypoint dispatched from the main handler (body.optionsAction).
async function handleOptions(body: Record<string, any>): Promise<Response> {
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  try {
    const action = String(body.optionsAction ?? "");
    const ticker = String(body.ticker ?? "").trim().toUpperCase();
    const expiry = body.expiry ? String(body.expiry) : "";
    const window = body.window ? Number(body.window) : 30;
    if (!ticker || !/^[A-Z0-9.\-^]{1,12}$/.test(ticker)) return json({ error: "Ticker inválido" }, 400);
    if (["chain", "aggregations", "skew"].includes(action) && !expiry) return json({ error: `La acción '${action}' requiere 'expiry'` }, 400);

    let result: unknown;
    switch (action) {
      case "expiries":       result = await oHandleExpiries(ticker); break;
      case "chain":          result = await oHandleChain(ticker, expiry); break;
      case "aggregations":   result = await oHandleAggregations(ticker, expiry); break;
      case "skew":           result = await oHandleSkew(ticker, expiry); break;
      case "term-structure": result = await oHandleTermStructure(ticker); break;
      case "surface":        result = await oHandleSurface(ticker); break;
      case "ivhv":           result = await oHandleIvHv(ticker, window); break;
      default: return json({ error: `Acción de opciones desconocida: '${action}'` }, 400);
    }
    return json(result);
  } catch (e) {
    if (e instanceof OptError) return json({ error: e.message }, e.status);
    console.error("[options] error:", e);
    return json({ error: (e as Error).message || "Error interno de opciones" }, 500);
  }
}

// =====================================================
// ETF DEEP ANALYSIS (sección "ETF") — deterministic, no LLM
// =====================================================
// Sector / asset-class / holdings come from Yahoo quoteSummary; country
// weightings from FMP when configured; news from Finnhub when configured.
// The geopolitical risk layer is a fixed, auditable heuristic table crossed
// with real exposure weights — computed here, never by the LLM.

const ETF_SECTOR_ES: Record<string, string> = {
  realestate: "Inmobiliario",
  consumer_cyclical: "Consumo cíclico",
  basic_materials: "Materiales básicos",
  consumer_defensive: "Consumo defensivo",
  technology: "Tecnología",
  communication_services: "Comunicaciones",
  financial_services: "Servicios financieros",
  utilities: "Utilities",
  industrials: "Industriales",
  energy: "Energía",
  healthcare: "Salud",
};

// Sector geopolitical risk heuristics: score 0–100 + rationale.
const ETF_SECTOR_RISK: Record<string, { score: number; note: string }> = {
  energy:                 { score: 75, note: "OPEP+, sanciones y conflictos en Oriente Medio / Rusia" },
  technology:             { score: 70, note: "Restricciones de exportación de semiconductores y cadena de suministro asiática" },
  basic_materials:        { score: 60, note: "Concentración minera y aranceles a materias primas" },
  industrials:            { score: 55, note: "Aranceles y fragmentación del comercio global" },
  consumer_cyclical:      { score: 45, note: "Sensibilidad al ciclo global y a aranceles" },
  financial_services:     { score: 40, note: "Sensibilidad a tipos de interés y riesgo regulatorio" },
  communication_services: { score: 35, note: "Riesgo regulatorio y antimonopolio" },
  healthcare:             { score: 35, note: "Riesgo regulatorio de precios de medicamentos" },
  realestate:             { score: 30, note: "Sensibilidad a tipos de interés" },
  utilities:              { score: 25, note: "Defensivo: impacto geopolítico limitado" },
  consumer_defensive:     { score: 20, note: "Defensivo: impacto geopolítico limitado" },
};

// Country geopolitical risk heuristics (FMP country names).
const ETF_COUNTRY_RISK: Record<string, { score: number; note: string }> = {
  "Russia":         { score: 95, note: "Sanciones y riesgo de confiscación / desliste" },
  "China":          { score: 85, note: "Tensiones EE.UU.–China, riesgo regulatorio y de desliste" },
  "Taiwan":         { score: 80, note: "Riesgo de conflicto en el estrecho de Taiwán" },
  "Hong Kong":      { score: 75, note: "Exposición indirecta al riesgo regulatorio chino" },
  "Turkey":         { score: 70, note: "Inestabilidad monetaria e institucional" },
  "Israel":         { score: 70, note: "Conflicto regional en Oriente Medio" },
  "Saudi Arabia":   { score: 65, note: "Dependencia del crudo y riesgo regional" },
  "South Africa":   { score: 60, note: "Inestabilidad institucional y de suministro eléctrico" },
  "Brazil":         { score: 55, note: "Volatilidad política y cambiaria" },
  "India":          { score: 50, note: "Tensiones fronterizas y proteccionismo" },
  "Mexico":         { score: 50, note: "Dependencia comercial de EE.UU. y riesgo arancelario" },
  "South Korea":    { score: 45, note: "Tensión con Corea del Norte; ciclo de semiconductores" },
  "Japan":          { score: 30, note: "Riesgo bajo; sensibilidad al yen" },
  "United States":  { score: 15, note: "Riesgo geopolítico doméstico bajo" },
};
const ETF_COUNTRY_RISK_DEFAULT = { score: 35, note: "Riesgo geopolítico moderado" };

function eNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v && typeof v === "object" && "raw" in (v as Record<string, unknown>)) {
    const raw = (v as Record<string, unknown>).raw;
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  }
  return null;
}

async function eYahooQuoteSummary(ticker: string): Promise<Record<string, any> | null> {
  const auth = await yfGetAuth();
  const sym = encodeURIComponent(ticker.toUpperCase());
  const modules = "quoteType,fundProfile,topHoldings";
  let url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${sym}?modules=${modules}`;
  if (auth?.crumb) url += `&crumb=${encodeURIComponent(auth.crumb)}`;
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": YF_UA, ...(auth?.cookie ? { Cookie: auth.cookie } : {}) },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j?.quoteSummary?.result?.[0] ?? null;
  } catch (_) { return null; }
}

async function eFmpCountries(ticker: string, fmpKey: string): Promise<{ country: string; pct: number }[] | null> {
  if (!fmpKey) return null;
  try {
    const url = `https://financialmodelingprep.com/api/v3/etf-country-weightings/${encodeURIComponent(ticker)}?apikey=${fmpKey}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(9_000) });
    if (!r.ok) return null;
    const j = await r.json();
    if (!Array.isArray(j) || j.length === 0) return null;
    const out = j
      .map((row: Record<string, unknown>) => ({
        country: String(row.country ?? ""),
        pct: parseFloat(String(row.weightPercentage ?? "").replace("%", "")),
      }))
      .filter((c) => c.country && Number.isFinite(c.pct) && c.pct > 0)
      .sort((a, b) => b.pct - a.pct);
    return out.length ? out : null;
  } catch (_) { return null; }
}

async function eFinnhubNews(ticker: string, finnhubKey: string): Promise<{ title: string; url: string; source: string; datetime: string }[]> {
  if (!finnhubKey) return [];
  try {
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const url = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(ticker)}&from=${from}&to=${to}&token=${finnhubKey}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(9_000) });
    if (!r.ok) return [];
    const j = await r.json();
    if (!Array.isArray(j)) return [];
    return j.slice(0, 8).map((n: Record<string, unknown>) => ({
      title: String(n.headline ?? ""),
      url: String(n.url ?? ""),
      source: String(n.source ?? ""),
      datetime: n.datetime ? new Date(Number(n.datetime) * 1000).toISOString().slice(0, 10) : "",
    })).filter((n) => n.title && n.url);
  } catch (_) { return []; }
}

async function handleEtf(tickerRaw: string, env: EnvKeys): Promise<Response> {
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  const ticker = tickerRaw.trim().toUpperCase();
  if (!/^[A-Z0-9.\-]{1,12}$/.test(ticker)) return json({ error: "Ticker inválido" }, 400);

  const summary = await eYahooQuoteSummary(ticker);
  const quoteType = String(summary?.quoteType?.quoteType ?? "");
  const isFund = quoteType === "ETF" || quoteType === "MUTUALFUND";
  if (!summary || !isFund) {
    return json({ ticker, found: false, fetchedAt: new Date().toISOString() });
  }

  const th = summary.topHoldings ?? {};
  const fp = summary.fundProfile ?? {};

  // Asset-class allocation (some ETFs have no bonds, no cash, etc. — only
  // categories actually present are emitted).
  const allocPairs: [string, unknown][] = [
    ["Acciones", th.stockPosition], ["Bonos", th.bondPosition], ["Efectivo", th.cashPosition],
    ["Preferentes", th.preferredPosition], ["Convertibles", th.convertiblePosition], ["Otros", th.otherPosition],
  ];
  const assetAllocation = allocPairs
    .map(([label, v]) => ({ label, pct: (eNum(v) ?? 0) * 100 }))
    .filter((a) => a.pct > 0.05)
    .map((a) => ({ label: a.label, pct: +a.pct.toFixed(2) }));

  // Sector weightings: array of single-key objects keyed by Yahoo sector id.
  const sectors: { key: string; sector: string; pct: number }[] = [];
  for (const entry of (th.sectorWeightings ?? []) as Record<string, unknown>[]) {
    for (const [key, v] of Object.entries(entry)) {
      const pct = (eNum(v) ?? 0) * 100;
      if (pct > 0.05) sectors.push({ key, sector: ETF_SECTOR_ES[key] ?? key, pct: +pct.toFixed(2) });
    }
  }
  sectors.sort((a, b) => b.pct - a.pct);

  const holdings = ((th.holdings ?? []) as Record<string, unknown>[])
    .map((h) => ({
      symbol: String(h.symbol ?? ""),
      name: String(h.holdingName ?? ""),
      pct: +(((eNum(h.holdingPercent) ?? 0) * 100).toFixed(2)),
    }))
    .filter((h) => h.symbol || h.name)
    .slice(0, 10);

  const [countries, news] = await Promise.all([
    eFmpCountries(ticker, env.FMP_KEY),
    eFinnhubNews(ticker, env.FINNHUB_KEY),
  ]);

  // Geopolitical risk layer: real exposure × fixed heuristic score.
  const geoRisks: { factor: string; kind: "sector" | "país"; exposurePct: number; score: number; contribution: number; note: string }[] = [];
  for (const s of sectors.slice(0, 6)) {
    const risk = ETF_SECTOR_RISK[s.key];
    if (!risk) continue;
    geoRisks.push({
      factor: s.sector, kind: "sector", exposurePct: s.pct, score: risk.score,
      contribution: +((s.pct * risk.score) / 100).toFixed(2), note: risk.note,
    });
  }
  for (const c of countries ?? []) {
    if (c.pct < 1) continue;
    const risk = ETF_COUNTRY_RISK[c.country] ?? ETF_COUNTRY_RISK_DEFAULT;
    if (risk.score < 50) continue; // only flag genuinely risky geographies
    geoRisks.push({
      factor: c.country, kind: "país", exposurePct: +c.pct.toFixed(2), score: risk.score,
      contribution: +((c.pct * risk.score) / 100).toFixed(2), note: risk.note,
    });
  }
  geoRisks.sort((a, b) => b.contribution - a.contribution);

  return json({
    ticker,
    found: true,
    name: String(summary.quoteType?.longName ?? summary.quoteType?.shortName ?? ""),
    family: fp.family ? String(fp.family) : null,
    category: fp.categoryName ? String(fp.categoryName) : null,
    assetAllocation,
    sectors: sectors.map(({ sector, pct }) => ({ sector, pct })),
    countries,
    holdings,
    geoRisks: geoRisks.slice(0, 8),
    news,
    fetchedAt: new Date().toISOString(),
  });
}

// =====================================================
// RISK ANALYTICS (sección "Riesgo") — deterministic, no LLM
// =====================================================
// Every number here is computed in code from Yahoo price series.
// The LLM never produces these figures.

const RISK_VIX_PANIC = 25; // VIX level splitting "calma" vs "pánico" regimes

interface RDay { date: string; close: number }

function rDays(hist: { t: number[]; c: number[] } | null): RDay[] {
  if (!hist) return [];
  const out: RDay[] = [];
  for (let i = 0; i < hist.t.length; i++) {
    out.push({ date: new Date(hist.t[i] * 1000).toISOString().slice(0, 10), close: hist.c[i] });
  }
  return out;
}

// Daily simple returns keyed by the date of day t (vs close of t-1).
function rReturnsByDate(days: RDay[]): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 1; i < days.length; i++) {
    const prev = days[i - 1].close;
    if (prev > 0) m.set(days[i].date, days[i].close / prev - 1);
  }
  return m;
}

// Inner-join two return series on date (sessions differ across assets).
function rAlignedReturns(
  a: Map<string, number>,
  b: Map<string, number>,
): { date: string; ra: number; rb: number }[] {
  const out: { date: string; ra: number; rb: number }[] = [];
  for (const [date, ra] of a) {
    const rb = b.get(date);
    if (rb !== undefined) out.push({ date, ra, rb });
  }
  out.sort((x, y) => x.date.localeCompare(y.date));
  return out;
}

function rPearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 3) return null;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
  const mx = sx / n, my = sy / n;
  let cov = 0, vx = 0, vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    cov += dx * dy; vx += dx * dx; vy += dy * dy;
  }
  if (vx <= 0 || vy <= 0) return null;
  return cov / Math.sqrt(vx * vy);
}

// Underwater series: distance from the running all-time high (fraction ≤ 0).
function rDrawdown(days: RDay[]) {
  if (days.length < 30) return null;
  let peak = -Infinity;
  const points = days.map((d) => {
    if (d.close > peak) peak = d.close;
    return { date: d.date, drawdown: peak > 0 ? d.close / peak - 1 : 0 };
  });
  let maxDrawdown = 0;
  for (const p of points) if (p.drawdown < maxDrawdown) maxDrawdown = p.drawdown;
  // Decimate long histories so the JSON payload stays light.
  const step = Math.max(1, Math.ceil(points.length / 1200));
  const slim = points.filter((_, i) => i % step === 0 || i === points.length - 1);
  return { points: slim, maxDrawdown, current: points[points.length - 1].drawdown };
}

// "Termómetro de refugio": 60-session rolling correlation vs GLD.
function rRefuge(tickerDays: RDay[], gldDays: RDay[]) {
  const aligned = rAlignedReturns(rReturnsByDate(tickerDays), rReturnsByDate(gldDays));
  const win = 60;
  if (aligned.length < win + 20) return null;
  const points: { date: string; corr: number | null }[] = [];
  for (let i = win; i < aligned.length; i++) {
    const slice = aligned.slice(i - win, i);
    points.push({ date: aligned[i].date, corr: rPearson(slice.map((s) => s.ra), slice.map((s) => s.rb)) });
  }
  let current: number | null = null;
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].corr !== null) { current = points[i].corr; break; }
  }
  return { points, current };
}

// Histogram of daily returns split by VIX regime (≤25 calm, >25 panic).
function rVixRegime(tickerDays: RDay[], vixDays: RDay[]) {
  const rets = rReturnsByDate(tickerDays);
  const vixByDate = new Map(vixDays.map((d) => [d.date, d.close]));
  const calm: number[] = [], panic: number[] = [];
  for (const [date, r] of rets) {
    const vix = vixByDate.get(date);
    if (vix === undefined) continue;
    (vix > RISK_VIX_PANIC ? panic : calm).push(r * 100);
  }
  if (calm.length + panic.length < 60) return null;

  const lo = -8, hi = 8, binStep = 0.5;
  const clamp = (v: number) => Math.max(lo, Math.min(hi - binStep / 2, v));
  const bins: { ret: number; calm: number; panic: number }[] = [];
  for (let b = lo; b < hi - 1e-9; b += binStep) {
    const inBin = (v: number) => { const c = clamp(v); return c >= b && c < b + binStep; };
    bins.push({
      ret: +(b + binStep / 2).toFixed(2),
      calm: calm.length ? +((100 * calm.filter(inBin).length) / calm.length).toFixed(2) : 0,
      panic: panic.length ? +((100 * panic.filter(inBin).length) / panic.length).toFixed(2) : 0,
    });
  }
  const stats = (a: number[]) => {
    if (!a.length) return { mean: null as number | null, std: null as number | null };
    const mean = a.reduce((s, v) => s + v, 0) / a.length;
    const std = a.length > 1 ? Math.sqrt(a.reduce((s, v) => s + (v - mean) ** 2, 0) / (a.length - 1)) : null;
    return { mean, std };
  };
  const cs = stats(calm), ps = stats(panic);
  return {
    bins, calmDays: calm.length, panicDays: panic.length,
    calmMean: cs.mean, calmStd: cs.std, panicMean: ps.mean, panicStd: ps.std,
  };
}

// OLS beta of the asset's daily returns vs Brent (BZ=F), in % units.
function rOilBeta(tickerDays: RDay[], brentDays: RDay[]) {
  const aligned = rAlignedReturns(rReturnsByDate(tickerDays), rReturnsByDate(brentDays));
  if (aligned.length < 60) return null;
  const xs = aligned.map((a) => a.rb * 100), ys = aligned.map((a) => a.ra * 100);
  const n = xs.length;
  const mx = xs.reduce((s, v) => s + v, 0) / n, my = ys.reduce((s, v) => s + v, 0) / n;
  let cov = 0, vx = 0, vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    cov += dx * dy; vx += dx * dx; vy += dy * dy;
  }
  if (vx <= 0) return null;
  const beta = cov / vx;
  const alpha = my - beta * mx;
  const r2 = vy > 0 ? (cov * cov) / (vx * vy) : null;
  const points = aligned.map((a) => ({ x: +(a.rb * 100).toFixed(3), y: +(a.ra * 100).toFixed(3) }));
  return { points, beta, alpha, r2, days: n };
}

// =====================================================
// TECHNICAL SERIES (sección "Señales Técnicas") — deterministic, no LLM
// =====================================================
// SMA / RSI / MACD computed in code from Yahoo daily closes so the charts
// always match auditable arithmetic; the AI narrative is rendered separately.

function tSma(values: number[], n: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

function tEma(values: number[], n: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < n) return out;
  const k = 2 / (n + 1);
  let ema = values.slice(0, n).reduce((s, v) => s + v, 0) / n;
  out[n - 1] = ema;
  for (let i = n; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
    out[i] = ema;
  }
  return out;
}

// Wilder's RSI(14).
function tRsi(values: number[], n = 14): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length <= n) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  let avgGain = gain / n, avgLoss = loss / n;
  const rsiAt = () => avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  out[n] = rsiAt();
  for (let i = n + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    avgGain = (avgGain * (n - 1) + Math.max(0, d)) / n;
    avgLoss = (avgLoss * (n - 1) + Math.max(0, -d)) / n;
    out[i] = rsiAt();
  }
  return out;
}

async function handleTechnicals(tickerRaw: string): Promise<Response> {
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  const ticker = tickerRaw.trim().toUpperCase();
  if (!/^[A-Z0-9.\-^=]{1,12}$/.test(ticker)) return json({ error: "Ticker inválido" }, 400);

  // 2y of history so SMA200 is defined across the whole 1y display window.
  const hist = await fetchYahooChart(ticker, "2y", "1d");
  if (!hist || hist.c.length < 30) return json({ error: `Sin histórico de precios para ${ticker}` }, 404);

  const days = rDays(hist);
  const closes = days.map((d) => d.close);
  const sma50 = tSma(closes, 50);
  const sma200 = tSma(closes, 200);
  const rsi = tRsi(closes, 14);
  const ema12 = tEma(closes, 12), ema26 = tEma(closes, 26);
  const macdLine = closes.map((_, i) =>
    ema12[i] !== null && ema26[i] !== null ? (ema12[i] as number) - (ema26[i] as number) : null);
  const macdVals = macdLine.filter((v): v is number => v !== null);
  const signalTail = tEma(macdVals, 9);
  // Re-align the signal EMA (computed on the compacted MACD array) to dates.
  const signal: (number | null)[] = new Array(closes.length).fill(null);
  let mi = 0;
  for (let i = 0; i < closes.length; i++) {
    if (macdLine[i] === null) continue;
    signal[i] = signalTail[mi] ?? null;
    mi++;
  }

  const keep = Math.min(252, days.length);
  const start = days.length - keep;
  const round = (v: number | null, dp = 4) => v === null ? null : +v.toFixed(dp);
  const series = [];
  for (let i = start; i < days.length; i++) {
    const m = macdLine[i], s = signal[i];
    series.push({
      date: days[i].date,
      close: round(closes[i], 4),
      sma50: round(sma50[i], 4),
      sma200: round(sma200[i], 4),
      rsi: round(rsi[i], 2),
      macd: round(m, 4),
      macdSignal: round(s, 4),
      macdHist: m !== null && s !== null ? +(m - s).toFixed(4) : null,
    });
  }
  const lastIdx = days.length - 1;
  return json({
    ticker,
    series,
    current: {
      close: round(closes[lastIdx], 4),
      sma50: round(sma50[lastIdx], 4),
      sma200: round(sma200[lastIdx], 4),
      rsi: round(rsi[lastIdx], 2),
      macd: round(macdLine[lastIdx], 4),
      macdSignal: round(signal[lastIdx], 4),
    },
    fetchedAt: new Date().toISOString(),
  });
}

async function handleRisk(tickerRaw: string): Promise<Response> {
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  const ticker = tickerRaw.trim().toUpperCase();
  if (!/^[A-Z0-9.\-^=]{1,12}$/.test(ticker)) return json({ error: "Ticker inválido" }, 400);

  const [hist10y, hist2y, gld, vix, brent] = await Promise.all([
    fetchYahooChart(ticker, "10y", "1d"),
    fetchYahooChart(ticker, "2y", "1d"),
    fetchYahooChart("GLD", "2y", "1d"),
    fetchYahooChart("^VIX", "2y", "1d"),
    fetchYahooChart("BZ=F", "1y", "1d"),
  ]);
  if (!hist10y && !hist2y) return json({ error: `Sin histórico de precios para ${ticker}` }, 404);

  const d10 = rDays(hist10y), d2 = rDays(hist2y);
  return json({
    ticker,
    drawdown: rDrawdown(d10.length ? d10 : d2),
    refuge: rRefuge(d2, rDays(gld)),
    vixRegime: rVixRegime(d2, rDays(vix)),
    oilBeta: rOilBeta(d2, rDays(brent)),
    fetchedAt: new Date().toISOString(),
  });
}

// =====================================================
// MAIN DISPATCHER
// =====================================================

Deno.serve(async (req) => {
  console.log("analyze v8-UNIFIED started");
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();

    const env: EnvKeys = {
      GEMINI_API_KEY: (Deno.env.get("GEMINI_API_KEY") || Deno.env.get("Gemini") || Deno.env.get("GOOGLE_API_KEY")) ?? "",
      FINNHUB_KEY:    (Deno.env.get("FINNHUB_API_KEY") || Deno.env.get("Finhub")) ?? "",
      TAVILY_KEY:     (Deno.env.get("TAVILY_API_KEY")  || Deno.env.get("Tavily")) ?? "",
      FMP_KEY:        Deno.env.get("FMP")         ?? "",
      FRED_KEY:       Deno.env.get("Fred")        ?? "",
      TWELVE_KEY:     Deno.env.get("Twelve Data") ?? "",
    };

    // Market data — no Gemini needed
    if (body.marketData === true) {
      const extraSymbols: string[] = Array.isArray(body.symbols)
        ? (body.symbols as any[]).filter(s => typeof s === "string" && /^[A-Z0-9.^]{1,10}$/.test(s)).slice(0, 6)
        : [];
      return await handleMarketData(env, extraSymbols);
    }

    // Chart-ready fundamentals from Yahoo Finance — no Gemini needed
    if (body.fundamentals === true && typeof body.ticker === "string"
        && body.ticker.trim().length > 0 && body.ticker.trim().length <= 12) {
      return await handleFundamentals(body.ticker);
    }

    // Options analytics (sección "Opciones") — Yahoo + BSM, no Gemini needed
    if (typeof body.optionsAction === "string" && body.optionsAction.length > 0) {
      return await handleOptions(body);
    }

    // Risk analytics (sección "Riesgo") — Yahoo charts + stats in code, no Gemini
    if (body.risk === true && typeof body.ticker === "string" && body.ticker.trim().length > 0) {
      return await handleRisk(body.ticker);
    }

    // ETF deep analysis (sección "ETF") — Yahoo + FMP + Finnhub, no Gemini
    if (body.etf === true && typeof body.ticker === "string" && body.ticker.trim().length > 0) {
      return await handleEtf(body.ticker, env);
    }

    // Technical series (sección "Señales Técnicas") — SMA/RSI/MACD in code, no Gemini
    if (body.technicals === true && typeof body.ticker === "string" && body.ticker.trim().length > 0) {
      return await handleTechnicals(body.ticker);
    }

    if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");

    // Dispatch by body shape
    if (body.sector && typeof body.sector === "string" && body.sector.trim().length > 0 && body.sector.trim().length <= 80) {
      return await handleSectorAnalysis(body.sector, env);
    }

    if (body.ticker && typeof body.ticker === "string" && body.ticker.trim().length > 0 && body.ticker.trim().length <= 10) {
      return await handleTickerAnalysis(body.ticker, env);
    }

    return jsonError("Petición inválida: debe incluir 'ticker' (≤10 chars), 'sector' (≤80 chars), o 'marketData: true'.", 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : "";
    console.error("analyze fatal error:", msg, stack);
    return jsonError(msg, 500);
  }
});
