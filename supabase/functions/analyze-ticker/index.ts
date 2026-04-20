
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
      ? news.slice(0, 3).map((n: any) => ({
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
  const [icRaw, cfRaw] = await Promise.all([
    finnhubGet(`/stock/financials?symbol=${t}&statement=ic&freq=quarterly`, key),
    finnhubGet(`/stock/financials?symbol=${t}&statement=cf&freq=quarterly`, key),
  ]);

  // Finnhub may nest data differently depending on version
  const icList: any[] = icRaw?.data?.financials ?? icRaw?.financials ?? [];
  const cfList: any[] = cfRaw?.data?.financials ?? cfRaw?.financials ?? [];

  if (!icList.length) return [];

  // Build a map period → CF data for quick lookup
  const cfByPeriod = new Map<string, any>(cfList.map((q: any) => [q.period, q]));

  return icList.slice(0, 4).map((q: any) => {
    const cf = cfByPeriod.get(q.period) ?? {};
    const rev = q.revenue ?? null;
    const revGrowth = q.revenueGrowth ?? null; // decimal e.g. 0.056
    const grossProfit = q.grossProfit ?? null;
    const ebit = q.ebit ?? q.operatingIncome ?? null;
    const ebitda = q.ebitda ?? null;
    const netIncome = q.netIncome ?? null;
    const eps = q.eps ?? null;
    const opCF = cf.operatingCashFlow ?? null;
    const fcf = cf.freeCashFlow ?? null;

    return {
      period: q.period ?? "",
      revenue: fmt(rev, "B"),
      revenueGrowth: revGrowth != null ? `${revGrowth >= 0 ? "+" : ""}${(revGrowth * 100).toFixed(1)}%` : "N/D",
      grossMargin: rev && grossProfit ? `${((grossProfit / rev) * 100).toFixed(1)}%` : "N/D",
      ebitda: fmt(ebitda, "B"),
      ebit: fmt(ebit, "B"),
      netIncome: fmt(netIncome, "B"),
      netMargin: rev && netIncome ? `${((netIncome / rev) * 100).toFixed(1)}%` : "N/D",
      eps: eps != null ? `$${Number(eps).toFixed(2)}` : "N/D",
      operatingCF: fmt(opCF, "B"),
      freeCashFlow: fmt(fcf, "B"),
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
      answer: (data.answer ?? "").slice(0, 180),
      results: (data.results ?? []).map((r: any) => ({
        title: r.title,
        content: (r.content ?? "").slice(0, 120),
        published_date: r.published_date ?? "",
      })),
    };
  } catch { return { answer: "", results: [] }; }
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
    `P/E (TTM): ${m?.peBasicExclExtraTTM ?? m?.peTTM ?? "N/D"}`,
    `P/E NTM (Forward): ${m?.peNTM ?? m?.forwardPE ?? "N/D"}`,
    `P/B: ${m?.pbAnnual ?? m?.pbQuarterly ?? "N/D"}`,
    `P/S (TTM): ${m?.psTTM ?? m?.priceToSalesTTM ?? "N/D"}`,
    `EV/EBITDA: ${evEbitda}`,
    `Deuda/Equity: ${debtEquity != null ? Number(debtEquity).toFixed(2) : "N/D"}`,
    `ROE (TTM): ${m?.roeTTM ?? "N/D"}%`,
    `ROA (TTM): ${m?.roaTTM ?? "N/D"}%`,
    `ROI (TTM): ${m?.roiTTM ?? "N/D"}%`,
    `Revenue Growth YoY: ${m?.revenueGrowthTTMYoy ?? "N/D"}%`,
    `EPS Growth YoY: ${m?.epsGrowthTTMYoy ?? "N/D"}%`,
    `EPS (TTM): ${m?.epsTTM ?? "N/D"}`,
    `Dividend Yield: ${m?.dividendYieldIndicatedAnnual ?? "N/D"}%`,
    `Current Ratio: ${m?.currentRatioAnnual ?? m?.currentRatioQuarterly ?? "N/D"}`,
    `Quick Ratio: ${m?.quickRatioAnnual ?? m?.quickRatioQuarterly ?? "N/D"}`,
    `Gross Margin (TTM): ${m?.grossMarginTTM ?? "N/D"}%`,
    `Operating Margin (TTM): ${m?.operatingMarginTTM ?? "N/D"}%`,
    `Net Margin (TTM): ${m?.netProfitMarginTTM ?? "N/D"}%`,
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

  // Quarterly financial history
  if (quarterlyHistory.length > 0) {
    lines.push("", "--- HISTORIAL FINANCIERO TRIMESTRAL (FINNHUB, ÚLTIMOS 6 TRIMESTRES) ---");
    lines.push("Periodo | Revenue | Var.%YoY | Margen Bruto | EBITDA | EBIT | Bfº Neto | Margen Neto | EPS | FCF | Op.CF");
    for (const q of quarterlyHistory) {
      lines.push(
        `${q.period} | ${q.revenue} | ${q.revenueGrowth} | ${q.grossMargin} | ${q.ebitda} | ${q.ebit} | ${q.netIncome} | ${q.netMargin} | ${q.eps} | ${q.freeCashFlow} | ${q.operatingCF}`
      );
    }
  }

  lines.push("", "=== FIN DATOS ===");
  return lines.join("\n");
}

// ── System prompt ──────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  const today = new Date().toISOString().slice(0, 10);
  return `Eres un analista financiero institucional senior especializado en renta variable. Fecha actual: ${today}.

REGLA ABSOLUTA: genera LAS 6 SECCIONES exactas, cada una comenzando con "## " (doble almohadilla + espacio). No omitas ninguna, no las fusiones.

## Resumen Ejecutivo
## Finanzas
## Valoración
## Competidores
## Noticias
## Institucional

══════════════════════════════════════════════
CONTENIDO OBLIGATORIO POR SECCIÓN:
══════════════════════════════════════════════

## Resumen Ejecutivo
- Párrafo 1 (5-7 líneas): situación actual — precio exacto, capitalización, rendimiento reciente vs sector.
- Párrafo 2 (4-5 líneas): posicionamiento competitivo y ventajas diferenciales.
- Párrafo 3 (4-5 líneas): catalizadores y riesgos macro más relevantes (aranceles, tipos, geopolítica).
- ### Perfil de la Empresa: sector, país, exchange, fecha IPO, descripción del negocio (3-4 líneas).
- ### Consenso de Analistas: total analistas, distribución Buy/Hold/Sell, precio objetivo si disponible.

## Finanzas
PARTE 1 — Tabla de métricas actuales con DOS columnas (Métrica | Valor). Incluye TODAS estas filas:
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

Si un dato aparece como N/D en Finnhub, búscalo en "DATOS ADICIONALES PARA COMPLEMENTAR N/D" o en "RIESGOS Y CATALIZADORES — NOTICIAS RECIENTES". NUNCA inventes cifras.

PARTE 2 — ### Evolución Trimestral
Usa los datos de "HISTORIAL FINANCIERO TRIMESTRAL". Genera una tabla Markdown con estas columnas exactas:
| Trimestre | Ingresos | Var.% YoY | M. Bruto | EBITDA | Bfº Neto | M. Neto | EPS | Free Cash Flow |
Si algún valor es N/D, escríbelo tal cual. Ordena de más reciente a más antiguo.
Después de la tabla: párrafo de 3-4 líneas analizando la TENDENCIA (aceleración, desaceleración, mejora/deterioro de márgenes, evolución del FCF).

PARTE 3 — Párrafo de 4-5 líneas sobre los fundamentales actuales más relevantes.

## Valoración
- ### Análisis de Múltiplos: tabla P/E / P/B / EV/EBITDA / P/S de la empresa vs media sectorial. Párrafo de 4-5 líneas: ¿cara, barata o en línea?
- ### Análisis del Sector: 5-6 líneas sobre estado del sector, tendencias estructurales, macro, perspectivas a 12 meses.
- ### Factores de Riesgo (8-10 viñetas):
  * Cada riesgo debe ser ESPECÍFICO y CUANTIFICADO cuando sea posible.
  * Usa los datos de "RIESGOS Y CATALIZADORES — NOTICIAS RECIENTES" y "CONTEXTO GEOPOLÍTICO" para citar noticias concretas.
  * Formato: "**Tipo de riesgo:** descripción detallada con cifras o eventos concretos. Fuente: [nombre del medio si disponible]."
  * Cubre: riesgo regulatorio, competitivo, macro (tipos, aranceles, divisa), operativo, de concentración de ingresos, geopolítico.
- ### Catalizadores Positivos (6-8 viñetas):
  * Divide en: **Corto plazo (0-3 meses)**, **Medio plazo (3-12 meses)**, **Largo plazo (+12 meses)**.
  * Usa noticias recientes para fundamentar cada catalizador.
  * Formato: "**[Plazo] — Catalizador:** descripción concreta con fechas o cifras estimadas si disponibles."

## Competidores
- ### Tabla Comparativa: columnas Empresa | Ticker | Precio | Market Cap | P/E TTM | P/B | EV/EBITDA | ROE | Net Margin | Rev Growth YoY | 52W Return | Beta. Empresa analizada en primera fila marcada con *.
- ### Análisis Competitivo: 5-6 líneas sobre posición relativa en márgenes, crecimiento y valoración.
- ### Cuota de Mercado y Posicionamiento: 3-4 líneas sobre participación de mercado y diferenciación.

## Noticias
- ### Noticias Corporativas Recientes: 5-7 noticias del ticker. Formato por noticia:
  "- **Titular descriptivo:** impacto o contexto en 2-3 líneas. (Fuente: nombre del medio)"
- ### Noticias del Sector: 3-4 noticias relevantes del sector. Mismo formato.
- ### Contexto Macro Relevante: 3-4 líneas sobre entorno macro/geopolítico con impacto directo en esta empresa.

## Institucional
- ### Tenencias Institucionales: principales inversores con % si disponible (Vanguard, BlackRock, Fidelity, etc.).
- ### Consenso de Analistas — Detalle: tabla Strong Buy / Buy / Hold / Sell / Strong Sell con totales. Párrafo de 3-4 líneas interpretando el consenso.
- ### Cambios Recientes en Posiciones: upgrades/downgrades de bancos de inversión, cambios en precio objetivo.
- ### Flujos y Sentimiento: 3-4 líneas sobre flujos institucionales y sentimiento general.

══════════════════════════════════════════════
REGLAS DE FORMATO:
- Markdown estricto. Sin emojis en encabezados.
- Números con unidades claras ($, %, x, B, M).
- Nunca cortes una frase a medias.
- Tono profesional y directo, propio de un informe de research institucional.
- Si un dato no existe en ninguna fuente: escribe "N/D". NUNCA inventes cifras.
══════════════════════════════════════════════`;
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
      TAVILY_KEY
        ? fetchTavilySearch(`${companyName} ${cleanTicker} geopolitico regulatorio riesgo aranceles 2025`, TAVILY_KEY, 2)
        : Promise.resolve(null),
      TAVILY_KEY
        ? fetchTavilySearch(`${companyName} ${cleanTicker} noticias ultimos dias`, TAVILY_KEY, 3, 7, "news")
        : Promise.resolve(null),
      TAVILY_KEY && sector
        ? fetchTavilySearch(`${sector} sector noticias tendencias`, TAVILY_KEY, 2, 7, "news")
        : Promise.resolve(null),
      TAVILY_KEY
        ? fetchTavilySearch(`${companyName} ${cleanTicker} analyst price target rating 2025`, TAVILY_KEY, 2)
        : Promise.resolve(null),
      TAVILY_KEY
        ? fetchTavilySearch(`${companyName} ${cleanTicker} earnings results revenue 2024 2025`, TAVILY_KEY, 3)
        : Promise.resolve(null),
      TAVILY_KEY && peers.length > 0
        ? fetchTavilySearch(
            `${companyName} vs ${peers.slice(0, 2).join(" ")} market share competitive position`,
            TAVILY_KEY,
            2,
          )
        : Promise.resolve(null),
      TAVILY_KEY
        ? fetchTavilySearch(`${companyName} ${cleanTicker} institutional ownership vanguard blackrock 2025`, TAVILY_KEY, 2)
        : Promise.resolve(null),
      TAVILY_KEY
        ? fetchTavilySearch(`${companyName} ${cleanTicker} free cash flow debt equity EBITDA 2024 2025`, TAVILY_KEY, 2)
        : Promise.resolve(null),
      TAVILY_KEY
        ? fetchTavilySearch(
            `${companyName} ${cleanTicker} risks catalysts opportunities 2025 2026`,
            TAVILY_KEY, 4, 30, "news",
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
        max_tokens: 6000,
        messages: [
          { role: "system", content: buildSystemPrompt() },
          {
            role: "user",
            content: `${dataContext}

INSTRUCCIÓN FINAL:
Genera el informe completo sobre ${cleanTicker} (${companyName}) con las 6 secciones obligatorias.
- En ## Finanzas: incluye la tabla de métricas actuales Y la tabla de Evolución Trimestral con los datos de "HISTORIAL FINANCIERO TRIMESTRAL".
- En ## Valoración: desarrolla los Factores de Riesgo y Catalizadores con noticias concretas de "RIESGOS Y CATALIZADORES — NOTICIAS RECIENTES". Cita la fuente (Reuters, FT, WSJ, CNBC, etc.) cuando esté disponible.
- Usa los datos numéricos de Finnhub. Si un dato es N/D, búscalo en "DATOS ADICIONALES PARA COMPLEMENTAR N/D". Si no existe en ninguna fuente: escribe N/D.
- Si el ticker no corresponde a una empresa real, indícalo en el Resumen Ejecutivo.`,
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
    return new Response(orResponse.body, {
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
