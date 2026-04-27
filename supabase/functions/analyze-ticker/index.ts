
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Finnhub helpers ───────────────────────────────────────────────────

async function finnhubGet(path: string, key: string) {
  try {
    const res = await fetch(`https://finnhub.io/api/v1${path}&token=${key}`);
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
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
      ? news.slice(0, 6).map((n: any) => ({
          headline: n.headline,
          source: n.source,
        }))
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

// ── Quarterly financials ──────────────────────────────────────────────

function fmt(val: number | null | undefined, unit: "M" | "B" | "pct" | "x" | "raw" = "M"): string {
  if (val == null || isNaN(val)) return "N/D";
  if (unit === "pct") return `${val >= 0 ? "+" : ""}${val.toFixed(1)}%`;
  if (unit === "B") return `$${(val / 1_000_000_000).toFixed(2)}B`;
  if (unit === "M") return `$${(val / 1_000_000).toFixed(0)}M`;
  if (unit === "x") return `${val.toFixed(2)}x`;
  return val.toFixed(2);
}

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

  return icList.slice(0, 6).map((q: any) => {
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

    // Balance sheet fields — try multiple Finnhub naming variants
    const cash     = bs.cashAndEquivalents ?? bs.cash ?? bs.cashEquivalents ?? null;
    const totalDebt = bs.totalDebt ?? bs.longTermDebt ?? null;
    const netDebt  = (totalDebt != null && cash != null) ? totalDebt - cash : null;
    const equity   = bs.totalEquity ?? bs.stockholdersEquity ?? bs.totalStockholdersEquity ?? null;
    const totalAssets = bs.totalAssets ?? null;

    return {
      period: q.period ?? "",
      // P&L
      revenue: fmt(rev, "B"),
      revenueGrowth: revGrowth != null ? `${revGrowth >= 0 ? "+" : ""}${(revGrowth * 100).toFixed(1)}%` : "N/D",
      grossMargin: rev && grossProfit ? `${((grossProfit / rev) * 100).toFixed(1)}%` : "N/D",
      ebitda: fmt(ebitda, "B"),
      netIncome: fmt(netIncome, "B"),
      netMargin: rev && netIncome ? `${((netIncome / rev) * 100).toFixed(1)}%` : "N/D",
      eps: eps != null ? `$${Number(eps).toFixed(2)}` : "N/D",
      // Cash flow
      operatingCF: fmt(opCF, "B"),
      freeCashFlow: fmt(fcf, "B"),
      capex: capex != null ? fmt(capex, "B") : "N/D",
      // Balance sheet
      cash: fmt(cash, "B"),
      totalDebt: fmt(totalDebt, "B"),
      netDebt: fmt(netDebt, "B"),
      equity: fmt(equity, "B"),
      totalAssets: fmt(totalAssets, "B"),
    };
  });
}

// ── Tavily helpers ────────────────────────────────────────────────────

async function fetchTavilySearch(
  query: string,
  key: string,
  maxResults = 5,
  days?: number,
  topic?: string,
  contentLen = 120,
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
      answer: (data.answer ?? "").slice(0, 220),
      results: (data.results ?? []).map((r: any) => ({
        title: r.title,
        content: (r.content ?? "").slice(0, contentLen),
        published_date: r.published_date ?? "",
      })),
    };
  } catch { return { answer: "", results: [] }; }
}

// ── Number helpers ────────────────────────────────────────────────────

/** Round any number to exactly 2 decimal places; return "N/D" if null/undefined */
function n2(v: number | null | undefined): string {
  if (v == null || isNaN(Number(v))) return "N/D";
  return Number(v).toFixed(2);
}

// ── Context builder ───────────────────────────────────────────────────

function buildDataContext(
  data: any,
  peerData: any[],
  quarterlyHistory: any[],
  geo: any,
  sectorNews: any,
  tickerNews: any,
  analystSearch: any,
  earningsSearch: any,
  competitiveSearch: any,
  institutionalSearch: any,
  missingDataSearch: any,
  risksCatalystsSearch: any,
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

  // Calculate EV/EBITDA — try multiple Finnhub field combinations
  const currentEv = m?.currentEv ?? m?.enterpriseValue ?? null;
  const ebitdPerShare = m?.ebitdPerShareTTM ?? m?.ebitdaPerShareTTM ?? null;
  const sharesOut = p?.shareOutstanding ?? null;
  let evEbitda: string | number = "N/D";
  if (currentEv && ebitdPerShare && sharesOut && ebitdPerShare > 0) {
    const ebitda = ebitdPerShare * sharesOut;
    if (ebitda > 0) evEbitda = (currentEv / ebitda).toFixed(1);
  }
  // Fallback: direct EV/EBITDA field
  if (evEbitda === "N/D" && m?.evToEbitda != null) evEbitda = Number(m.evToEbitda).toFixed(1);

  // FCF/Share — try all known Finnhub field names
  const fcfPerShare =
    m?.fcfPerShareTTM ??
    m?.freeCashFlowPerShareTTM ??
    m?.cashFlowPerShareTTM ??
    null;
  // Derive FCF/Share from quarterly data if still missing
  let fcfPerShareStr = fcfPerShare != null ? String(Number(fcfPerShare).toFixed(2)) : "N/D";
  if (fcfPerShareStr === "N/D" && quarterlyHistory.length > 0) {
    const latestQ = quarterlyHistory[0];
    if (latestQ.freeCashFlow !== "N/D") {
      fcfPerShareStr = `~${latestQ.freeCashFlow} (trimestral, ver historial)`;
    }
  }

  // Debt/Equity — try all variants
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

  // Peer financial data (real data from Finnhub)
  if (peerData.length > 0) {
    lines.push("", "--- DATOS FINANCIEROS DE COMPETIDORES (FINNHUB) ---");
    lines.push("Ticker | Empresa | Precio | Market Cap | P/E | P/B | EV/EBITDA | ROE | Net Margin | Rev Growth YoY | 52W Return | Beta");
    for (const pd of peerData) {
      lines.push(`${pd.ticker} | ${pd.name} | ${pd.price} | ${pd.marketCap} | ${pd.pe} | ${pd.pb} | ${pd.evEbitda} | ${pd.roe} | ${pd.netMargin} | ${pd.revenueGrowth} | ${pd.weekReturn52} | ${pd.beta}`);
    }
  }

  // Finnhub company news (last 30 days)
  if (news.length > 0) {
    lines.push("", "--- NOTICIAS RECIENTES DEL TICKER (ÚLTIMAS 4 SEMANAS, FINNHUB) ---");
    for (const n of news) {
      lines.push(`- ${n.headline}${n.source ? ` [${n.source}]` : ""}`);
    }
  }

  // Tavily ticker news
  if (tickerNews?.results?.length > 0) {
    lines.push("", "--- NOTICIAS ADICIONALES DEL TICKER (BÚSQUEDA WEB) ---");
    if (tickerNews.answer) lines.push(`Resumen: ${tickerNews.answer}`);
    for (const result of tickerNews.results) {
      lines.push(`- ${result.title}`);
      if (result.content) lines.push(`  ${result.content}`);
    }
  }

  // Tavily sector news
  if (sectorNews?.results?.length > 0) {
    lines.push("", "--- NOTICIAS DEL SECTOR (BÚSQUEDA WEB) ---");
    if (sectorNews.answer) lines.push(`Resumen del sector: ${sectorNews.answer}`);
    for (const result of sectorNews.results) {
      lines.push(`- ${result.title}`);
      if (result.content) lines.push(`  ${result.content}`);
    }
  }

  // Analyst targets
  if (analystSearch?.results?.length > 0) {
    lines.push("", "--- OBJETIVOS DE PRECIO Y RATINGS DE ANALISTAS ---");
    if (analystSearch.answer) lines.push(analystSearch.answer);
    for (const result of analystSearch.results) {
      lines.push(`- ${result.title}`);
      if (result.content) lines.push(`  ${result.content}`);
    }
  }

  // Recent earnings
  if (earningsSearch?.results?.length > 0) {
    lines.push("", "--- RESULTADOS FINANCIEROS RECIENTES (EARNINGS) ---");
    if (earningsSearch.answer) lines.push(earningsSearch.answer);
    for (const result of earningsSearch.results) {
      lines.push(`- ${result.title}`);
      if (result.content) lines.push(`  ${result.content}`);
    }
  }

  // Competitive landscape
  if (competitiveSearch?.results?.length > 0) {
    lines.push("", "--- POSICIÓN COMPETITIVA Y CUOTA DE MERCADO ---");
    if (competitiveSearch.answer) lines.push(competitiveSearch.answer);
    for (const result of competitiveSearch.results) {
      lines.push(`- ${result.title}`);
      if (result.content) lines.push(`  ${result.content}`);
    }
  }

  // Institutional positions
  if (institutionalSearch?.results?.length > 0) {
    lines.push("", "--- POSICIONES INSTITUCIONALES (TAVILY) ---");
    if (institutionalSearch.answer) lines.push(institutionalSearch.answer);
    for (const result of institutionalSearch.results) {
      lines.push(`- ${result.title}`);
      if (result.content) lines.push(`  ${result.content}`);
    }
  }

  // Missing data resolution
  if (missingDataSearch?.results?.length > 0) {
    lines.push("", "--- DATOS ADICIONALES PARA COMPLEMENTAR N/D (TAVILY) ---");
    if (missingDataSearch.answer) lines.push(missingDataSearch.answer);
    for (const result of missingDataSearch.results) {
      lines.push(`- ${result.title}`);
      if (result.content) lines.push(`  ${result.content}`);
    }
  }

  // Risks & catalysts news
  if (risksCatalystsSearch?.results?.length > 0) {
    lines.push("", "--- RIESGOS Y CATALIZADORES — NOTICIAS RECIENTES ---");
    if (risksCatalystsSearch.answer) lines.push(risksCatalystsSearch.answer);
    for (const result of risksCatalystsSearch.results) {
      lines.push(`- [${result.published_date ?? ""}] ${result.title}`);
      if (result.content) lines.push(`  ${result.content}`);
    }
  }

  // Geo/regulatory context
  if (geo?.answer) {
    lines.push("", "--- CONTEXTO GEOPOLÍTICO Y REGULATORIO ---");
    lines.push(geo.answer);
    if (geo.results?.length > 0) {
      for (const s of geo.results) lines.push(`  - ${s.title}: ${s.content?.slice(0, 250) ?? ""}`);
    }
  }

  // Quarterly financial history — three separate tables for clarity
  if (quarterlyHistory.length > 0) {
    lines.push("", "--- HISTORIAL TRIMESTRAL: P&L (ÚLTIMOS 6 TRIMESTRES) ---");
    lines.push("Periodo | Revenue | Var.%YoY | M.Bruto | EBITDA | Bfº Neto | M.Neto | EPS");
    for (const q of quarterlyHistory) {
      lines.push(`${q.period} | ${q.revenue} | ${q.revenueGrowth} | ${q.grossMargin} | ${q.ebitda} | ${q.netIncome} | ${q.netMargin} | ${q.eps}`);
    }

    lines.push("", "--- HISTORIAL TRIMESTRAL: CASH FLOW (ÚLTIMOS 6 TRIMESTRES) ---");
    lines.push("Periodo | Op.CF | Free Cash Flow | Capex");
    for (const q of quarterlyHistory) {
      lines.push(`${q.period} | ${q.operatingCF} | ${q.freeCashFlow} | ${q.capex}`);
    }

    lines.push("", "--- HISTORIAL TRIMESTRAL: BALANCE (ÚLTIMOS 6 TRIMESTRES) ---");
    lines.push("Periodo | Caja | Deuda Total | Deuda Neta | Equity | Total Activos");
    for (const q of quarterlyHistory) {
      lines.push(`${q.period} | ${q.cash} | ${q.totalDebt} | ${q.netDebt} | ${q.equity} | ${q.totalAssets}`);
    }
  }

  lines.push("", "=== FIN DATOS ===");
  return lines.join("\n");
}

// ── System prompt ──────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  const today = new Date().toISOString().slice(0, 10);
  return `Eres un analista financiero institucional senior. Fecha: ${today}.

Genera EXACTAMENTE las 6 secciones siguientes, cada una iniciada con "## " (no las omitas ni fusiones):
## Resumen Ejecutivo
## Finanzas
## Valoración
## Competidores
## Noticias
## Institucional

── CONTENIDO POR SECCIÓN ──

## Resumen Ejecutivo
- Párrafo 1 (5-7 líneas): situación actual — precio, capitalización, rendimiento reciente vs sector.
- Párrafo 2 (4-5 líneas): posicionamiento competitivo y ventajas diferenciales.
- Párrafo 3 (4-5 líneas): catalizadores y riesgos macro (aranceles, tipos, geopolítica).
- ### Perfil de la Empresa: sector, país, exchange, IPO, descripción del negocio (3-4 líneas).
- ### Consenso de Analistas: total analistas, distribución Buy/Hold/Sell, precio objetivo.

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

Si un dato es N/D en Finnhub, búscalo en DATOS ADICIONALES o HISTORIAL TRIMESTRAL. Nunca inventes.

PARTE 2 — ### Evolución Trimestral
Las tablas de datos históricos se renderizan automáticamente en el informe.
Escribe ÚNICAMENTE un párrafo de análisis (5-6 líneas) sobre las tendencias observadas en los últimos 6 trimestres:
crecimiento o desaceleración de ingresos, evolución de márgenes, generación de Free Cash Flow, cambios en deuda y solidez del balance.

PARTE 3 — Párrafo 4-5 líneas sobre los fundamentales más relevantes.

## Valoración
- ### Análisis de Múltiplos: tabla P/E, P/B, EV/EBITDA, P/S empresa vs media sectorial. Párrafo 4-5 líneas.
- ### Análisis del Sector: 5-6 líneas sobre estado, tendencias estructurales, macro, perspectivas 12M.
- ### Factores de Riesgo (8-10 viñetas):
  Formato: "- **Tipo:** descripción con cifras/eventos. (Fuente: medio)"
  Usa RIESGOS Y CATALIZADORES NOTICIAS + CONTEXTO GEOPOLÍTICO para citar.
  Cubre: regulatorio, competitivo, macro (tipos/aranceles/divisa), operativo, concentración, geopolítico.
- ### Catalizadores Positivos (6-8 viñetas):
  Divide en **Corto plazo (0-3m)**, **Medio plazo (3-12m)**, **Largo plazo (+12m)**.
  Cita noticias concretas de las fuentes proporcionadas.

## Competidores
- ### Tabla Comparativa: Empresa | Ticker | Precio | Market Cap | P/E TTM | P/B | EV/EBITDA | ROE | Net Margin | Rev Growth YoY | 52W Return | Beta. Empresa analizada primera fila con *.
- ### Análisis Competitivo: 5-6 líneas sobre posición relativa.
- ### Cuota de Mercado y Posicionamiento: 3-4 líneas.

## Noticias
- ### Noticias Corporativas Recientes: 5-7 noticias. Formato: "- **Titular:** impacto 2-3 líneas. (Fuente)"
- ### Noticias del Sector: 3-4 noticias. Mismo formato.
- ### Contexto Macro Relevante: 4-5 líneas sobre entorno macro/geopolítico con impacto directo. Usa CONTEXTO GEOPOLÍTICO para detallar aranceles, regulación específica, tensiones geopolíticas.

## Institucional
- ### Tenencias Institucionales: Vanguard, BlackRock, Fidelity, etc. con % si disponible.
- ### Consenso de Analistas — Detalle: tabla Strong Buy/Buy/Hold/Sell/Strong Sell + párrafo 3-4 líneas.
- ### Cambios Recientes en Posiciones: upgrades/downgrades, cambios precio objetivo.
- ### Flujos y Sentimiento: 3-4 líneas.

REGLAS DE FORMATO:
- Markdown estricto. Sin emojis.
- TODOS los números: exactamente 2 decimales (21.28, no 21.2848; 40.84%, no 40.839999%).
- Unidades siempre presentes: $, %, x, B, M.
- Si un dato no existe en ninguna fuente: OMITE esa fila o usa el mejor estimado disponible con nota "(est.)". NUNCA escribas "N/D" en el informe final.
- No cortes frases a medias.`;
}

// ── Main handler ───────────────────────────────────────────────────────

Deno.serve(async (req) => {
  console.log("analyze-ticker v5-GROQ started");
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { ticker } = await req.json();

    if (!ticker || typeof ticker !== "string" || ticker.trim().length === 0 || ticker.trim().length > 10) {
      return new Response(
        JSON.stringify({ error: "Ticker inválido." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY") || Deno.env.get("Groq");
    if (!GROQ_API_KEY) throw new Error("GROQ_API_KEY is not configured");

    const FINNHUB_KEY = (Deno.env.get("FINNHUB_API_KEY") || Deno.env.get("Finhub")) ?? "";
    const TAVILY_KEY = (Deno.env.get("TAVILY_API_KEY") || Deno.env.get("Tavily")) ?? "";

    const cleanTicker = ticker.trim().toUpperCase();

    // Step 1: Fetch Finnhub base data
    const finnhubData = FINNHUB_KEY ? await fetchFinnhubData(cleanTicker, FINNHUB_KEY) : null;

    const companyName = finnhubData?.profile?.name ?? cleanTicker;
    const sector = finnhubData?.profile?.finnhubIndustry ?? "";
    const peers = finnhubData?.peers ?? [];

    // Step 2: Fetch quarterly history + peer data + 10 Tavily searches in parallel
    const [
      quarterlyHistory,
      peerData,
      geoContext,
      tickerNews,
      sectorNews,
      analystSearch,
      earningsSearch,
      competitiveSearch,
      institutionalSearch,
      missingDataSearch,
      risksCatalystsSearch,
    ] = await Promise.all([
      FINNHUB_KEY ? fetchQuarterlyFinancials(cleanTicker, FINNHUB_KEY) : Promise.resolve([]),
      FINNHUB_KEY ? fetchPeerData(peers, FINNHUB_KEY) : Promise.resolve([]),
      // Geopolitical + regulatory — more results, longer content
      TAVILY_KEY
        ? fetchTavilySearch(
            `${companyName} ${cleanTicker} geopolitical regulatory tariffs sanctions China EU USA 2025 2026`,
            TAVILY_KEY, 4, 60, undefined, 220,
          )
        : Promise.resolve(null),
      // Ticker news
      TAVILY_KEY
        ? fetchTavilySearch(`${companyName} ${cleanTicker} noticias ultimos dias`, TAVILY_KEY, 4, 7, "news", 150)
        : Promise.resolve(null),
      TAVILY_KEY && sector
        ? fetchTavilySearch(`${sector} sector tendencias outlook`, TAVILY_KEY, 3, 14, "news", 140)
        : Promise.resolve(null),
      TAVILY_KEY
        ? fetchTavilySearch(`${companyName} ${cleanTicker} analyst price target rating 2025`, TAVILY_KEY, 2, undefined, undefined, 120)
        : Promise.resolve(null),
      TAVILY_KEY
        ? fetchTavilySearch(`${companyName} ${cleanTicker} quarterly earnings revenue EPS 2024 2025`, TAVILY_KEY, 3, undefined, undefined, 140)
        : Promise.resolve(null),
      TAVILY_KEY && peers.length > 0
        ? fetchTavilySearch(
            `${companyName} vs ${peers.slice(0, 2).join(" ")} market share competitive position`,
            TAVILY_KEY, 2, undefined, undefined, 120,
          )
        : Promise.resolve(null),
      TAVILY_KEY
        ? fetchTavilySearch(`${companyName} ${cleanTicker} institutional ownership Vanguard BlackRock 2025`, TAVILY_KEY, 2, undefined, undefined, 110)
        : Promise.resolve(null),
      TAVILY_KEY
        ? fetchTavilySearch(`${companyName} ${cleanTicker} free cash flow debt equity EBITDA 2024`, TAVILY_KEY, 2, undefined, undefined, 110)
        : Promise.resolve(null),
      TAVILY_KEY
        ? fetchTavilySearch(
            `${companyName} ${cleanTicker} risks catalysts opportunities growth headwinds 2025 2026`,
            TAVILY_KEY, 5, 30, "news", 180,
          )
        : Promise.resolve(null),
    ]);

    const dataContext = buildDataContext(
      finnhubData,
      peerData,
      quarterlyHistory,
      geoContext,
      sectorNews,
      tickerNews,
      analystSearch,
      earningsSearch,
      competitiveSearch,
      institutionalSearch,
      missingDataSearch,
      risksCatalystsSearch,
    );

    console.log("Data sources loaded:", {
      finnhub_quote: !!finnhubData?.quote?.c,
      finnhub_profile: !!finnhubData?.profile?.name,
      finnhub_metrics: !!finnhubData?.metrics,
      finnhub_news: finnhubData?.news?.length ?? 0,
      quarterly_history: (quarterlyHistory as any[]).length,
      peer_data: (peerData as any[]).length,
      tavily_geo: !!(geoContext?.answer),
      tavily_ticker_news: tickerNews?.results?.length ?? 0,
      tavily_sector_news: sectorNews?.results?.length ?? 0,
      tavily_analyst: analystSearch?.results?.length ?? 0,
      tavily_earnings: earningsSearch?.results?.length ?? 0,
      tavily_competitive: competitiveSearch?.results?.length ?? 0,
      tavily_institutional: institutionalSearch?.results?.length ?? 0,
      tavily_missing_data: missingDataSearch?.results?.length ?? 0,
      tavily_risks_catalysts: risksCatalystsSearch?.results?.length ?? 0,
    });

    console.log("Calling Groq API...");
    const orResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        max_tokens: 5200,
        messages: [
          { role: "system", content: buildSystemPrompt() },
          {
            role: "user",
            content: `${dataContext}

INSTRUCCIÓN FINAL:
Genera el informe completo sobre ${cleanTicker} (${companyName}) con las 6 secciones obligatorias.
- En ## Finanzas: incluye la tabla de métricas actuales. En ### Evolución Trimestral escribe SOLO el párrafo de análisis de tendencias (las tablas de datos trimestrales se renderizan automáticamente — NO las generes tú).
- En ## Valoración: desarrolla Factores de Riesgo y Catalizadores con noticias concretas. Cita la fuente cuando esté disponible.
- Usa datos de Finnhub. Si un dato es N/D, búscalo en las fuentes adicionales. Si no existe: N/D.
- Si el ticker no existe, indícalo en el Resumen Ejecutivo.`,
          },
        ],
        stream: true,
      }),
    });

    console.log("Groq response status:", orResponse.status);

    if (!orResponse.ok) {
      const errBody = await orResponse.text();
      console.error("Groq API error:", orResponse.status, errBody);
      if (orResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: "Límite de solicitudes excedido. Inténtalo en unos segundos." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (orResponse.status === 402) {
        return new Response(
          JSON.stringify({ error: `Créditos agotados. Detalle: ${errBody.substring(0, 200)}` }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ error: `Groq Error (${orResponse.status}): ${errBody.substring(0, 300)}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!orResponse.body) {
      return new Response(
        JSON.stringify({ error: "Groq returned empty response body" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Streaming response to client...");

    // Build a combined stream: quarterly JSON event first, then Groq SSE
    const encoder = new TextEncoder();
    const quarterlyEvent = encoder.encode(
      `data: ${JSON.stringify({ __quarterly: quarterlyHistory })}\n\n`
    );
    const groqReader = orResponse.body!.getReader();

    const combined = new ReadableStream({
      async start(controller) {
        controller.enqueue(quarterlyEvent);
        try {
          while (true) {
            const { done, value } = await groqReader.read();
            if (done) break;
            controller.enqueue(value);
          }
        } finally {
          controller.close();
        }
      },
      cancel() { groqReader.cancel(); },
    });

    return new Response(combined, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : "";
    console.error("analyze-ticker fatal error:", msg, stack);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
