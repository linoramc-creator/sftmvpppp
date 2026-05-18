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
      search_depth: "advanced",
      max_results: maxResults,
      include_answer: true,
    };
    if (days) body.days = days;
    if (topic) body.topic = topic;

    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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
// GEMINI (shared fallback chain)
// =====================================================

type GeminiResult =
  | { ok: true;  response: Response; model: string }
  | { ok: false; status: number; error: string };

async function callGeminiStream(messages: any[], apiKey: string): Promise<GeminiResult> {
  const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
  // Gemini 3.1 Pro Preview (SOTA, Feb 2026) first, with fallbacks
  const GEMINI_MODELS = [
    "gemini-3.1-pro-preview",
    "gemini-3-pro-preview",
    "gemini-3-pro-latest",
    "gemini-3.0-pro",
    "gemini-3-pro",
    "gemini-2.5-pro-latest",
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-2.0-flash",
  ];

  for (const model of GEMINI_MODELS) {
    const res = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messages, stream: true, model }),
    });
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
    const res = await fetch(`https://finnhub.io/api/v1${path}&token=${key}`);
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
      ? news.slice(0, 6).map((n: any) => ({ headline: n.headline, source: n.source }))
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

  return icList.slice(0, 12).map((q: any) => {
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

    const cash     = bs.cashAndEquivalents ?? bs.cash ?? bs.cashEquivalents ?? null;
    const totalDebt = bs.totalDebt ?? bs.longTermDebt ?? null;
    const netDebt  = (totalDebt != null && cash != null) ? totalDebt - cash : null;
    const equity   = bs.totalEquity ?? bs.stockholdersEquity ?? bs.totalStockholdersEquity ?? null;
    const totalAssets = bs.totalAssets ?? null;

    return {
      period: q.period ?? "",
      revenue: fmt(rev, "B"),
      revenueGrowth: revGrowth != null ? `${revGrowth >= 0 ? "+" : ""}${(revGrowth * 100).toFixed(1)}%` : "N/D",
      grossMargin: rev && grossProfit ? `${((grossProfit / rev) * 100).toFixed(1)}%` : "N/D",
      ebitda: fmt(ebitda, "B"),
      netIncome: fmt(netIncome, "B"),
      netMargin: rev && netIncome ? `${((netIncome / rev) * 100).toFixed(1)}%` : "N/D",
      eps: eps != null ? `$${Number(eps).toFixed(2)}` : "N/D",
      operatingCF: fmt(opCF, "B"),
      freeCashFlow: fmt(fcf, "B"),
      capex: capex != null ? fmt(capex, "B") : "N/D",
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
  // Normalize FMP date strings to YYYY-MM-DD (FMP returns this format,
  // but defensively strip anything after the date portion just in case).
  const normDate = (d: any): string => {
    if (typeof d !== "string") return "";
    const m = d.match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : "";
  };
  try {
    const incomeUrl  = `${base}/income-statement/${t}?period=quarter&limit=12&apikey=${key}`;
    const cashUrl    = `${base}/cash-flow-statement/${t}?period=quarter&limit=12&apikey=${key}`;
    const balanceUrl = `${base}/balance-sheet-statement/${t}?period=quarter&limit=12&apikey=${key}`;
    const [incomeRaw, cashRaw, balanceRaw] = await Promise.all([
      fetch(incomeUrl).then(r => r.ok ? r.json() : { __status: r.status }).catch(() => []),
      fetch(cashUrl).then(r => r.ok ? r.json() : { __status: r.status }).catch(() => []),
      fetch(balanceUrl).then(r => r.ok ? r.json() : { __status: r.status }).catch(() => []),
    ]);

    const incomeList: any[] = Array.isArray(incomeRaw) ? incomeRaw : [];
    console.log(`FMP ${ticker} quarter limit=12: income=${incomeList.length} cf=${Array.isArray(cashRaw) ? cashRaw.length : "err"} bs=${Array.isArray(balanceRaw) ? balanceRaw.length : "err"} ${!Array.isArray(incomeRaw) ? "incomeErr=" + JSON.stringify(incomeRaw).slice(0, 120) : ""}`);
    if (!incomeList.length) return [];

    const cashByDate = new Map<string, any>(
      Array.isArray(cashRaw) ? (cashRaw as any[]).map((q: any) => [normDate(q.date), q]) : []
    );
    const balByDate = new Map<string, any>(
      Array.isArray(balanceRaw) ? (balanceRaw as any[]).map((q: any) => [normDate(q.date), q]) : []
    );

    return incomeList.map((q: any, idx: number) => {
      const period = normDate(q.date);
      const cf = cashByDate.get(period) ?? {};
      const bs = balByDate.get(period) ?? {};

      const rev         = q.revenue ?? null;
      const grossProfit = q.grossProfit ?? null;
      const ebitda      = q.ebitda ?? null;
      const netIncome   = q.netIncome ?? null;
      const eps         = q.epsdiluted ?? q.eps ?? null;
      const opCF        = cf.operatingCashFlow ?? null;
      const fcf         = cf.freeCashFlow ?? null;
      const capex       = cf.capitalExpenditure ?? null;
      const cash        = bs.cashAndCashEquivalents ?? null;
      const totalDebt   = bs.totalDebt ?? null;
      const netDebt     = (totalDebt != null && cash != null) ? totalDebt - cash : null;
      const equity      = bs.totalStockholdersEquity ?? null;
      const totalAssets = bs.totalAssets ?? null;

      const prevQ = incomeList[idx + 4] as any;
      const revGrowth = (rev && prevQ?.revenue && Math.abs(prevQ.revenue) > 0)
        ? `${((rev - prevQ.revenue) / Math.abs(prevQ.revenue) * 100) >= 0 ? "+" : ""}${((rev - prevQ.revenue) / Math.abs(prevQ.revenue) * 100).toFixed(1)}%`
        : "N/D";

      return {
        period,
        revenue:      fmt(rev, "B"),
        revenueGrowth: revGrowth,
        grossMargin:  rev && grossProfit ? `${((grossProfit / rev) * 100).toFixed(1)}%` : "N/D",
        ebitda:       fmt(ebitda, "B"),
        netIncome:    fmt(netIncome, "B"),
        netMargin:    rev && netIncome ? `${((netIncome / rev) * 100).toFixed(1)}%` : "N/D",
        eps:          eps != null ? `$${Number(eps).toFixed(2)}` : "N/D",
        operatingCF:  fmt(opCF, "B"),
        freeCashFlow: fmt(fcf, "B"),
        capex:        capex != null ? fmt(capex, "B") : "N/D",
        cash:         fmt(cash, "B"),
        totalDebt:    fmt(totalDebt, "B"),
        netDebt:      fmt(netDebt, "B"),
        equity:       fmt(equity, "B"),
        totalAssets:  fmt(totalAssets, "B"),
      };
    }).filter(q => /^\d{4}-\d{2}-\d{2}$/.test(q.period)).slice(0, 12);
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
      fetch(`${base}/income_statement?symbol=${t}&period=quarterly&apikey=${key}`)
        .then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${base}/cash_flow?symbol=${t}&period=quarterly&apikey=${key}`)
        .then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${base}/balance_sheet?symbol=${t}&period=quarterly&apikey=${key}`)
        .then(r => r.ok ? r.json() : null).catch(() => null),
    ]);

    const incomeList: any[] = Array.isArray(incomeRaw?.income_statement) ? incomeRaw.income_statement : [];
    console.log(`TwelveData ${ticker}: income=${incomeList.length} status=${incomeRaw?.status ?? "ok"} code=${incomeRaw?.code ?? ""}`);
    if (!incomeList.length) return [];

    const cashList:    any[] = Array.isArray(cashRaw?.cash_flow)        ? cashRaw.cash_flow        : [];
    const balanceList: any[] = Array.isArray(balanceRaw?.balance_sheet) ? balanceRaw.balance_sheet : [];

    const cashByDate = new Map<string, any>(cashList   .map((q: any) => [q.fiscal_date, q]));
    const balByDate  = new Map<string, any>(balanceList.map((q: any) => [q.fiscal_date, q]));

    const num = (v: any): number | null => {
      if (v == null || v === "") return null;
      const n = typeof v === "string" ? parseFloat(v) : Number(v);
      return isNaN(n) ? null : n;
    };

    const sorted = [...incomeList].sort((a, b) => (b.fiscal_date ?? "").localeCompare(a.fiscal_date ?? ""));

    return sorted.map((q: any, idx: number) => {
      const date = q.fiscal_date ?? "";
      const cf = cashByDate.get(date) ?? {};
      const bs = balByDate.get(date) ?? {};

      const rev         = num(q.sales);
      const grossProfit = num(q.gross_profit);
      const ebitda      = num(q.ebitda);
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
        grossMargin:   (rev && grossProfit) ? `${((grossProfit / rev) * 100).toFixed(1)}%` : "N/D",
        ebitda:        fmt(ebitda, "B"),
        netIncome:     fmt(netIncome, "B"),
        netMargin:     (rev && netIncome) ? `${((netIncome / rev) * 100).toFixed(1)}%` : "N/D",
        eps:           eps != null ? `$${eps.toFixed(2)}` : "N/D",
        operatingCF:   fmt(opCF, "B"),
        freeCashFlow:  fmt(fcf, "B"),
        capex:         capex != null ? fmt(capex, "B") : "N/D",
        cash:          fmt(cash, "B"),
        totalDebt:     fmt(totalDebt, "B"),
        netDebt:       fmt(netDebt, "B"),
        equity:        fmt(equity, "B"),
        totalAssets:   fmt(totalAssets, "B"),
      };
    }).slice(0, 12);
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
- Todos los valores monetarios en USD absolutos: si está en Miles de Millones (B/bn/billions) multiplica por 1000000000; si está en Millones (M/mm/millions) multiplica por 1000000
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
        grossMargin:   (rev && grossProfit) ? `${((grossProfit / rev) * 100).toFixed(1)}%` : "N/D",
        ebitda:        fmt(ebitda, "B"),
        netIncome:     fmt(netIncome, "B"),
        netMargin:     (rev && netIncome) ? `${((netIncome / rev) * 100).toFixed(1)}%` : "N/D",
        eps:           eps != null ? `$${eps.toFixed(2)}` : "N/D",
        operatingCF:   fmt(opCF, "B"),
        freeCashFlow:  fmt(fcf, "B"),
        capex:         capex != null ? fmt(capex, "B") : "N/D",
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

function mergeQuarterlyData(finnhub: any[], fmp: any[], twelveData: any[], aiFallback: any[] = []): any[] {
  const merged = new Map<string, any>();
  const fields = ["revenueGrowth","grossMargin","ebitda","netIncome","netMargin","eps",
                  "operatingCF","freeCashFlow","capex","cash","totalDebt","netDebt","equity","totalAssets","revenue"];

  const fillFrom = (source: any[]) => {
    for (const q of source) {
      if (!q.period) continue;
      const key = q.period.slice(0, 7);
      if (!merged.has(key)) {
        merged.set(key, { ...q });
      } else {
        const existing = merged.get(key)!;
        for (const f of fields) {
          if ((existing[f] === "N/D" || existing[f] == null) && q[f] !== "N/D" && q[f] != null) {
            existing[f] = q[f];
          }
        }
      }
    }
  };

  // Priority order: FMP > Twelve Data > Finnhub > AI fallback (last resort)
  fillFrom(fmp);
  fillFrom(twelveData);
  fillFrom(finnhub);
  fillFrom(aiFallback);

  return Array.from(merged.values())
    .sort((a: any, b: any) => b.period.localeCompare(a.period))
    .slice(0, 12);
}

// =====================================================
// TICKER: POLYMARKET / FMP / TWELVE DATA
// =====================================================

async function fetchPolymarketData(ticker: string, companyName: string): Promise<string> {
  try {
    const terms = [companyName.split(" ").slice(0, 2).join(" "), ticker].filter(Boolean);
    let markets: any[] = [];

    for (const q of terms) {
      const res = await fetch(
        `https://gamma-api.polymarket.com/markets?q=${encodeURIComponent(q)}&limit=6&active=true&closed=false`,
        { headers: { "Accept": "application/json" } }
      ).catch(() => null);
      if (!res?.ok) continue;
      const data = await res.json().catch(() => []);
      if (Array.isArray(data) && data.length > 0) { markets = data; break; }
    }

    const relevant = markets
      .filter((m: any) => !m.closed && m.outcomePrices && m.question)
      .sort((a: any, b: any) => (b.volume ?? 0) - (a.volume ?? 0))
      .slice(0, 3);

    if (!relevant.length) return "";

    const lines = ["--- MERCADOS DE PREDICCION ACTIVOS (POLYMARKET) ---"];
    for (const m of relevant) {
      try {
        const outcomes: string[] = JSON.parse(m.outcomes || "[]");
        const prices: string[] = JSON.parse(m.outcomePrices || "[]");
        const vol = m.volume ? `$${(m.volume / 1000).toFixed(0)}K vol` : "";
        const priceStr = outcomes.map((o, i) => `${o}: ${(parseFloat(prices[i] ?? "0") * 100).toFixed(0)}%`).join(" / ");
        const slug = m.slug ?? m.conditionId ?? "";
        const url = slug ? ` — https://polymarket.com/event/${slug}` : "";
        lines.push(`- "${m.question}"${url}`);
        lines.push(`  ${priceStr}${vol ? `  (${vol})` : ""}`);
      } catch (_) { /* skip */ }
    }
    return lines.length > 1 ? lines.join("\n") : "";
  } catch (_) { return ""; }
}

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
  polymarketContext: string,
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
      lines.push(`- ${n.headline}${n.source ? ` [${n.source}]` : ""}`);
    }
  }

  if (tickerNews?.results?.length > 0) {
    lines.push("", "--- NOTICIAS ADICIONALES DEL TICKER (BÚSQUEDA WEB) ---");
    if (tickerNews.answer) lines.push(`Resumen: ${tickerNews.answer}`);
    for (const result of tickerNews.results) {
      lines.push(`- ${result.title}`);
      if (result.content) lines.push(`  ${result.content}`);
    }
  }

  if (sectorNews?.results?.length > 0) {
    lines.push("", "--- NOTICIAS DEL SECTOR (BÚSQUEDA WEB) ---");
    if (sectorNews.answer) lines.push(`Resumen del sector: ${sectorNews.answer}`);
    for (const result of sectorNews.results) {
      lines.push(`- ${result.title}`);
      if (result.content) lines.push(`  ${result.content}`);
    }
  }

  if (earningsSearch?.results?.length > 0) {
    lines.push("", "--- RESULTADOS FINANCIEROS RECIENTES (EARNINGS) ---");
    if (earningsSearch.answer) lines.push(earningsSearch.answer);
    for (const result of earningsSearch.results) {
      lines.push(`- ${result.title}`);
      if (result.content) lines.push(`  ${result.content}`);
    }
  }

  if (competitiveSearch?.results?.length > 0) {
    lines.push("", "--- POSICIÓN COMPETITIVA Y CUOTA DE MERCADO ---");
    if (competitiveSearch.answer) lines.push(competitiveSearch.answer);
    for (const result of competitiveSearch.results) {
      lines.push(`- ${result.title}`);
      if (result.content) lines.push(`  ${result.content}`);
    }
  }

  if (risksCatalystsSearch?.results?.length > 0) {
    lines.push("", "--- RIESGOS Y CATALIZADORES — NOTICIAS RECIENTES ---");
    if (risksCatalystsSearch.answer) lines.push(risksCatalystsSearch.answer);
    for (const result of risksCatalystsSearch.results) {
      lines.push(`- [${result.published_date ?? ""}] ${result.title}`);
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
  if (polymarketContext) lines.push("", polymarketContext);

  lines.push("", "=== FIN DATOS ===");
  return lines.join("\n");
}

function buildTickerSystemPrompt(): string {
  const today = new Date().toISOString().slice(0, 10);
  return `Eres un analista financiero institucional senior. Fecha: ${today}.

Genera EXACTAMENTE las 8 secciones siguientes, cada una iniciada con "## " (no las omitas ni fusiones):
## Resumen Ejecutivo
## Finanzas
## Valoración
## Sector
## Noticias
## Señales Técnicas
## Institucional
## Mercados de Predicción

== CONTENIDO POR SECCION ==

## Resumen Ejecutivo
- Párrafo 1 (5-7 líneas): situación actual — precio, capitalización, rendimiento reciente vs sector.
- Párrafo 2 (4-5 líneas): posicionamiento competitivo y ventajas diferenciales.
- Párrafo 3 (4-5 líneas): catalizadores y riesgos macro (aranceles, tipos, geopolítica).
- ### Perfil de la Empresa: sector, país, exchange, IPO, descripción del negocio (3-4 líneas).

## Finanzas
PARTE 1 — Tabla métricas actuales (Métrica | Valor) con estas filas:
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

PARTE 2 — Las tablas de evolución trimestral (P&L, Cash Flow, Balance) se renderizan automáticamente en el informe. NO generes ningún texto ni tabla para este bloque.

PARTE 3 — Párrafo 4-5 líneas sobre los fundamentales más relevantes.

## Valoración
- ### Análisis de Múltiplos: tabla P/E, P/B, EV/EBITDA, P/S empresa vs media sectorial. Párrafo 4-5 líneas.
- ### Análisis del Sector: 5-6 líneas sobre estado, tendencias estructurales, macro, perspectivas 12M.
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
- ### Noticias Corporativas Recientes: 5-7 noticias. Formato: "- **Titular:** impacto 2-3 líneas. (Fuente)"
- ### Noticias del Sector: 3-4 noticias. Mismo formato.
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

## Mercados de Predicción
Solo si existen datos en POLYMARKET: escribe 3-5 líneas mencionando los mercados de predicción activos más relevantes, sus probabilidades actuales y volumen. Para cada mercado, incluye el enlace del contexto en formato [ver en Polymarket](url). Explica qué implican esas probabilidades para el inversor. Si no hay datos de Polymarket, omite esta sección completamente.

REGLAS DE FORMATO:
- Markdown estricto. Sin emojis.
- TODOS los números: exactamente 2 decimales (21.28, no 21.2848; 40.84%, no 40.839999%).
- Unidades siempre presentes: $, %, x, B, M.
- Señales técnicas en **NEGRITAS**: **BULLISH**, **BEARISH**, **NEUTRO**, **ALCISTA**, **BAJISTA**, **SOBRECOMPRADO**, **SOBREVENTA**.
- Niveles de riesgo en **NEGRITAS**: **ALTO**, **MEDIO**, **BAJO**.
- Cuando menciones trimestres específicos en el análisis narrativo, usa SIEMPRE formato Q1'24, Q2'24, Q3'24, Q4'24 (nunca "primer trimestre 2024", ni "ENE 24", ni "marzo 2024").
- Entre cada viñeta deja UNA LÍNEA EN BLANCO (doble salto de línea) para máxima legibilidad. Las viñetas pegadas son ilegibles.
- CERO N/D EN EL INFORME: Está PROHIBIDO escribir N/D, N/A, -, — o cualquier equivalente en el informe. Si un dato no está en Finnhub, búscalo en DATOS TWELVE DATA (enterprise_to_ebitda, forward_pe, total_debt_to_equity_mrq, etc.), luego en FMP, luego en HISTORIAL TRIMESTRAL. Si tras buscar en TODAS las fuentes no existe el dato, OMITE esa fila de la tabla completamente — no la incluyas. Un informe sin una fila es mejor que un informe con N/D.
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
- Si no tienes un dato específico, omite esa fila — nunca escribas N/D, N/A o similar.
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

  const finnhubData = env.FINNHUB_KEY ? await fetchFinnhubData(cleanTicker, env.FINNHUB_KEY) : null;

  const companyName = finnhubData?.profile?.name ?? cleanTicker;
  const sector = finnhubData?.profile?.finnhubIndustry ?? "";
  const peers = finnhubData?.peers ?? [];

  const [
    finnhubQuarterly,
    fmpQuarterly,
    twelveDataQuarterly,
    peerData,
    polymarketContext,
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
  ] = await Promise.all([
    env.FINNHUB_KEY ? fetchQuarterlyFinancials(cleanTicker, env.FINNHUB_KEY) : Promise.resolve([]),
    env.FMP_KEY     ? fetchFmpQuarterlyFinancials(cleanTicker, env.FMP_KEY)  : Promise.resolve([]),
    env.TWELVE_KEY  ? fetchTwelveDataQuarterlyFinancials(cleanTicker, env.TWELVE_KEY) : Promise.resolve([]),
    env.FINNHUB_KEY ? fetchPeerData(peers, env.FINNHUB_KEY) : Promise.resolve([]),
    fetchPolymarketData(cleanTicker, companyName),
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
  ]);

  let quarterlyHistory = mergeQuarterlyData(
    finnhubQuarterly    as any[],
    fmpQuarterly        as any[],
    twelveDataQuarterly as any[],
  );

  // Detect gaps: trigger AI fallback if we have fewer than 6 quarters OR any column has N/D values
  const hasGaps = (rows: any[]): boolean => {
    if (rows.length < 6) return true;
    const ndFields = ["revenueGrowth", "grossMargin", "ebitda", "netIncome", "operatingCF", "freeCashFlow", "cash", "totalDebt", "equity"];
    return rows.some(r => ndFields.some(f => r[f] === "N/D" || r[f] == null));
  };

  // AI fallback: if data is missing OR has gaps, ask Gemini (3.1 Pro) to extract from web search
  let aiFallback: any[] = [];
  if (hasGaps(quarterlyHistory) && env.TAVILY_KEY && env.GEMINI_API_KEY) {
    console.log(`Quarterly fallback triggered: ${quarterlyHistory.length} quarters with gaps. Calling AI extraction.`);
    aiFallback = await fetchAiQuarterlyFallback(cleanTicker, companyName, env.TAVILY_KEY, env.GEMINI_API_KEY);
    if (aiFallback.length > 0) {
      quarterlyHistory = mergeQuarterlyData(
        finnhubQuarterly    as any[],
        fmpQuarterly        as any[],
        twelveDataQuarterly as any[],
        aiFallback,
      );
      console.log(`AI fallback added ${aiFallback.length} quarters. Final merged: ${quarterlyHistory.length}`);
    }
  }

  const dataContext = buildTickerDataContext(
    finnhubData,
    peerData,
    quarterlyHistory,
    geoContext,
    sectorNews,
    tickerNews,
    earningsSearch,
    competitiveSearch,
    risksCatalystsSearch,
    polymarketContext,
    fredContext,
    fmpContext,
    twelveDataContext,
    technicalContext,
  );

  console.log("Ticker data loaded:", {
    ticker: cleanTicker,
    finnhub_quote: !!finnhubData?.quote?.c,
    finnhub_metrics: !!finnhubData?.metrics,
    quarterly_history: quarterlyHistory.length,
    quarterly_finnhub: (finnhubQuarterly as any[]).length,
    quarterly_fmp: (fmpQuarterly as any[]).length,
    quarterly_twelve_data: (twelveDataQuarterly as any[]).length,
    quarterly_ai_fallback: aiFallback.length,
    peer_data: (peerData as any[]).length,
    tavily_ticker_news: tickerNews?.results?.length ?? 0,
    polymarket_ok: !!polymarketContext,
    fred_ok: !!fredContext,
    fmp_ok: !!fmpContext,
    twelve_data_ok: !!twelveDataContext,
    technical_ok: !!technicalContext,
  });

  const messages = [
    { role: "system", content: buildTickerSystemPrompt() },
    {
      role: "user",
      content: `${dataContext}

INSTRUCCIÓN FINAL:
Genera el informe completo sobre ${cleanTicker} (${companyName}) con las 8 secciones obligatorias.
- En ## Finanzas: incluye la tabla de métricas actuales (PARTE 1). Las tablas trimestrales se renderizan automáticamente — NO las generes.
- En ## Valoración: desarrolla Factores de Riesgo con nivel **ALTO/MEDIO/BAJO** al final de cada viñeta.
- En ## Finanzas: para cualquier métrica no disponible en Finnhub, usa DATOS TWELVE DATA o FMP. Si no hay dato en ninguna fuente, OMITE esa fila. CERO N/D permitidos.
- En ## Sector: usa los datos de peers de Finnhub para la tabla comparativa. Omite columnas sin dato.
- En ## Señales Técnicas: usa los INDICADORES TÉCNICOS (TWELVE DATA). Si faltan datos, deriva tendencia del precio vs SMA o rango 52W.
- En ## Institucional: usa los datos estructurados de FMP como fuente principal.
- En ## Noticias / ## Resumen: integra los indicadores FRED en el contexto macro.
- En ## Mercados de Predicción: solo si hay datos de POLYMARKET. Incluye el enlace. Si no hay datos, omite la sección.
- Si el ticker no existe, indícalo en el Resumen Ejecutivo.`,
    },
  ];

  const gemini = await callGeminiStream(messages, env.GEMINI_API_KEY);
  if (!gemini.ok) return jsonError(gemini.error, gemini.status);
  console.log(`Streaming ticker analysis with model: ${gemini.model}`);

  if (!gemini.response.body) return jsonError("Gemini returned empty response body", 500);

  // Combined stream: quarterly JSON event first, then Gemini SSE
  const encoder = new TextEncoder();
  const quarterlyDebug = {
    hasFinnhub:     !!env.FINNHUB_KEY,
    hasFmp:         !!env.FMP_KEY,
    hasTwelveData:  !!env.TWELVE_KEY,
    hasTavily:      !!env.TAVILY_KEY,
    finnhubRows:    (finnhubQuarterly as any[]).length,
    fmpRows:        (fmpQuarterly as any[]).length,
    twelveDataRows: (twelveDataQuarterly as any[]).length,
    aiFallbackRows: aiFallback.length,
    mergedRows:     quarterlyHistory.length,
  };
  const quarterlyEvent = encoder.encode(`data: ${JSON.stringify({ __quarterly: quarterlyHistory, __quarterlyDebug: quarterlyDebug })}\n\n`);
  const geminiReader = gemini.response.body.getReader();

  const combined = new ReadableStream({
    async start(controller) {
      controller.enqueue(quarterlyEvent);
      try {
        while (true) {
          const { done, value } = await geminiReader.read();
          if (done) break;
          controller.enqueue(value);
        }
      } finally {
        controller.close();
      }
    },
    cancel() { geminiReader.cancel(); },
  });

  return new Response(combined, {
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
    cleanSector,
    sectorNews,
    sectorTrends,
    topCompanies,
    sectorETFs,
    macroNews,
    regulatoryContext,
    fredContext,
  );

  console.log("Sector data loaded:", {
    sector: cleanSector,
    tavily_news: (sectorNews as any)?.results?.length ?? 0,
    tavily_trends: (sectorTrends as any)?.results?.length ?? 0,
    tavily_companies: (topCompanies as any)?.results?.length ?? 0,
    tavily_etfs: (sectorETFs as any)?.results?.length ?? 0,
    fred_ok: !!fredContext,
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
  if (!gemini.ok) return jsonError(gemini.error, gemini.status);
  console.log(`Streaming sector analysis with model: ${gemini.model}`);

  if (!gemini.response.body) return jsonError("Gemini returned empty response body", 500);

  return new Response(gemini.response.body, {
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

async function handleMarketData(env: EnvKeys, extraSymbols: string[]): Promise<Response> {
  const now    = Math.floor(Date.now() / 1000);
  const ago30d = now - 30 * 24 * 3600;

  const allSymbols = ["SPY", "QQQ", ...extraSymbols.filter(s => s !== "SPY" && s !== "QQQ")];

  const [quotesResult, spyCandle, qqqCandle, fred10y, fred2y] = await Promise.allSettled([
    Promise.all(allSymbols.map(s =>
      finnhubGet(`/quote?symbol=${s}`, env.FINNHUB_KEY)
        .then(d => d ? { symbol: s, c: d.c as number, dp: d.dp as number } : { symbol: s, c: null, dp: null })
    )),
    finnhubGet(`/stock/candle?symbol=SPY&resolution=D&from=${ago30d}&to=${now}`, env.FINNHUB_KEY),
    finnhubGet(`/stock/candle?symbol=QQQ&resolution=D&from=${ago30d}&to=${now}`, env.FINNHUB_KEY),
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

  const calc1m = (candle: any): number | null => {
    if (!candle || candle.s === "no_data" || !Array.isArray(candle.c) || candle.c.length < 2) return null;
    const first = candle.c[0] as number;
    const last  = candle.c[candle.c.length - 1] as number;
    return first > 0 ? +((last - first) / first * 100).toFixed(2) : null;
  };

  const spy1m = spyCandle.status === "fulfilled" ? calc1m(spyCandle.value) : null;
  const qqq1m = qqqCandle.status === "fulfilled" ? calc1m(qqqCandle.value) : null;

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
    indices: [
      makeQ("SPY", "S&P 500", spy1m),
      makeQ("QQQ", "NASDAQ",  qqq1m),
    ],
    yield10y,
    yield2y,
    spread,
    stocks: extraSymbols.map(s => makeQ(s, s)),
    ts: Date.now(),
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
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
